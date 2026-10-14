import { owner, db, origin, scopes, report, fail } from "../../../lib/server.js";
import { creatorStateCookie } from "../../../lib/oauth-state.js";

import { randomBytes } from "node:crypto";

const CONNECT_VERSION = '20261014-multicreator-v4';

export default async function handler(req, res) {
  res.setHeader('X-Snack-Vault-Connect-Version', CONNECT_VERSION);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.query?.status === '1') {
    try { return res.json({ version: CONNECT_VERSION, dashboard_url: `${origin()}/admin`, creator_connections: 'per-creator' }); }
    catch (error) { return report(res, error); }
  }
  if (req.method === "POST") return startCreator(req, res);
  if (req.method !== "GET") {
    return res.status(405).send("Method not allowed");
  }

  // Visiting the old link must not start an unowned, single-channel login.
  // Every streamer starts the authenticated per-creator flow in their vault.
  try { return res.redirect(302, `${origin()}/admin#bot`); }
  catch (error) { return report(res, error); }
}

async function startCreator(req,res) {
  res.setHeader('Cache-Control','no-store');
  try {
    const canonical = origin();
    // Proxy Host/Origin headers do not reliably identify the browser's site.
    // The page reports its location for routing. Authorization is enforced
    // by the owner session, browser state cookie, and single-use DB nonce.
    if (req.body?.dashboard_origin !== undefined) {
      let dashboardOrigin;
      try { dashboardOrigin = new URL(req.body.dashboard_origin).origin; } catch {}
      if (dashboardOrigin !== canonical) {
        throw fail(409, `Connection setup v3: this dashboard is using a different address. Sign in at ${canonical}/admin to connect Twitch.`);
      }
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
    return res.json({url:url.toString(), version:CONNECT_VERSION});
  } catch(error) { return report(res,error); }
}
