import { owner, db, origin, scopes, report, fail } from "../../../lib/server.js";
import { creatorStateCookie } from "../../../lib/oauth-state.js";

import { randomBytes } from "node:crypto";

function browserOrigin(req) {
  // Vercel may forward an internal deployment Host even when the browser
  // is using the public alias. Browser Origin identifies the cookie site.
  const headers = req.headers || {};
  if (typeof headers.origin === 'string') {
    try { return new URL(headers.origin).origin; } catch { return null; }
  }
  if (typeof headers.referer === 'string') {
    try { return new URL(headers.referer).origin; } catch { return null; }
  }
  const host = headers['x-forwarded-host'] || headers.host;
  const protocol = headers['x-forwarded-proto'] || 'https';
  if (typeof host !== 'string' || typeof protocol !== 'string') return null;
  try { return new URL(`${protocol.split(',')[0].trim()}://${host.split(',')[0].trim()}`).origin; }
  catch { return null; }
}

export default async function handler(req, res) {
  if (req.method === "POST") return startCreator(req, res);
  if (req.method !== "GET") {
    return res.status(405).send("Method not allowed");
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const redirectUri = process.env.TWITCH_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).send("Twitch is not configured.");
  }

  const state = randomBytes(32).toString("hex");

  res.setHeader("Cache-Control", "no-store");

  res.setHeader("Set-Cookie", [
    `twitch_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/twitch; Max-Age=600`,
    "twitch_oauth_flow=channel; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/twitch; Max-Age=600"
  ]);

  const url = new URL("https://id.twitch.tv/oauth2/authorize");

  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "channel:bot");
  url.searchParams.set("state", state);
  url.searchParams.set("force_verify", "true");

  return res.redirect(302, url.toString());
}

async function startCreator(req,res) {
  res.setHeader('Cache-Control','no-store');
  try {
    const canonical = origin();
    if (browserOrigin(req) !== canonical) {
      throw fail(409, `Open ${canonical}/admin and sign in there, then click Connect Twitch. Twitch must return to the same website that started your connection.`);
    }
    if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) throw fail(503, 'Twitch server configuration is incomplete.');
    const creator=await owner(req);
    const state='svcreator_'+randomBytes(32).toString('hex');
    await db('bot_oauth_nonces',{method:'POST',body:{nonce:state,creator_id:creator.id,created_at:new Date().toISOString()}});
    res.setHeader('Set-Cookie',[
      `${creatorStateCookie(state)}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
    ]);
    const url=new URL('https://id.twitch.tv/oauth2/authorize');
    for(const [k,v] of Object.entries({client_id:process.env.TWITCH_CLIENT_ID,redirect_uri:process.env.TWITCH_REDIRECT_URI,response_type:'code',scope:scopes.join(' '),state,force_verify:'true'})) url.searchParams.set(k,v);
    return res.json({url:url.toString()});
  } catch(error) { return report(res,error); }
}
