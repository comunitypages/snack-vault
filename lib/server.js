import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
export function fail(status, message) { return Object.assign(new Error(message), { status }); }
export function report(res, error) {
  // Never log credentials, fetch bodies or upstream token responses.
  console.error('Snack Vault request failed', error.status || 500);
  return res.status(error.status || 500).json({ error: error.status ? error.message : 'Server request failed. Check configuration and the new SQL migration.' });
}
export function equal(a, b) { const x=Buffer.from(a || ''), y=Buffer.from(b || ''); return x.length === y.length && timingSafeEqual(x,y); }
export function encrypt(value) {
  const key=Buffer.from(process.env.TWITCH_TOKEN_ENCRYPTION_KEY || '', 'base64');
  if(key.length!==32) throw fail(503,'Token encryption is not configured.');
  const iv=randomBytes(12), c=createCipheriv('aes-256-gcm',key,iv);
  const valueEnc=Buffer.concat([c.update(value,'utf8'),c.final()]);
  return ['v1',iv.toString('base64'),c.getAuthTag().toString('base64'),valueEnc.toString('base64')].join('.');
}
export function decrypt(value) {
  const [version,iv,tag,body]=String(value).split('.');
  if(version!=='v1') throw fail(503,'Reconnect Twitch to refresh saved credentials.');
  const c=createDecipheriv('aes-256-gcm',Buffer.from(process.env.TWITCH_TOKEN_ENCRYPTION_KEY || '','base64'),Buffer.from(iv,'base64'));
  c.setAuthTag(Buffer.from(tag,'base64')); return Buffer.concat([c.update(Buffer.from(body,'base64')),c.final()]).toString('utf8');
}
export async function db(path, { method='GET', body, prefer }={}) {
  const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw fail(503,'Database server configuration is missing.');
  const r=await fetch(`${url.replace(/\/$/,'')}/rest/v1/${path}`,{method,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(8000)});
  if(!r.ok) { if(r.status===409) throw fail(409,'This Twitch account is already connected, or the request conflicts with an existing connection.'); throw fail(502,'Database request failed. Confirm the integration migration has been run.'); }
  const text=await r.text(); return text ? JSON.parse(text) : null;
}
export async function owner(req) {
  const token=(req.headers.authorization || '').match(/^Bearer (\S+)$/)?.[1];
  if(!token) throw fail(401,'Sign in to your creator dashboard first.');
  const r=await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(8000)});
  if(!r.ok) throw fail(401,'Your session expired. Sign in again.');
  const user=await r.json();
  if(!user.id || !/^[0-9a-f-]{36}$/i.test(user.id)) throw fail(401,'Invalid session.');
  const rows=await db(`creators?owner_id=eq.${user.id}&select=id,slug,name&limit=2`);
  if(rows.length!==1) throw fail(403,'A single owned creator vault is required.');
  return rows[0];
}
export async function connection(creatorId) { return (await db(`creator_twitch_bots?creator_id=eq.${creatorId}&select=*`))[0] || null; }
export async function patchConnection(id, values) { return db(`creator_twitch_bots?creator_id=eq.${id}`,{method:'PATCH',body:values}); }
export function origin() {
  const url=new URL(process.env.TWITCH_REDIRECT_URI);
  if(url.protocol!=='https:') throw fail(503,'Twitch redirect URI must use HTTPS.');
  return url.origin;
}
export const scopes=['channel:bot','channel:manage:redemptions'];
export function eventSecret() {
  if(!process.env.BOT_API_SECRET) throw fail(503,'Bot server secret is missing.');
  return createHmac('sha256',process.env.BOT_API_SECRET).update('snack-vault:eventsub:v1').digest('hex');
}
let appToken;
export async function appAccess() {
  if(appToken?.expires>Date.now()+60000) return appToken.value;
  const r=await fetch('https://id.twitch.tv/oauth2/token',{method:'POST',body:new URLSearchParams({client_id:process.env.TWITCH_CLIENT_ID,client_secret:process.env.TWITCH_CLIENT_SECRET,grant_type:'client_credentials'}),signal:AbortSignal.timeout(8000)});
  if(!r.ok) throw fail(502,'Could not authorize the existing Twitch application.');
  const d=await r.json(); appToken={value:d.access_token,expires:Date.now()+d.expires_in*1000}; return appToken.value;
}
export async function helix(path,token,{method='GET',body}={}) {
  const r=await fetch(`https://api.twitch.tv/helix/${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Client-Id':process.env.TWITCH_CLIENT_ID,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(8000)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw Object.assign(fail(r.status===401?401:502,`Twitch request failed (${r.status}). Check the connected account and permissions.`),{twitchStatus:r.status});
  return d;
}
export async function channelAPI(conn,path,options) {
  let token=decrypt(conn.access_token_enc);
  try { return await helix(path,token,options); } catch(error) { if(error.twitchStatus!==401) throw error; }
  const r=await fetch('https://id.twitch.tv/oauth2/token',{method:'POST',body:new URLSearchParams({client_id:process.env.TWITCH_CLIENT_ID,client_secret:process.env.TWITCH_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:decrypt(conn.refresh_token_enc)}),signal:AbortSignal.timeout(8000)});
  if(!r.ok) throw fail(401,'Twitch authorization expired. Reconnect your channel.');
  const d=await r.json(); if(!d.access_token||!d.refresh_token) throw fail(502,'Twitch token refresh failed.');
  await patchConnection(conn.creator_id,{access_token_enc:encrypt(d.access_token),refresh_token_enc:encrypt(d.refresh_token)});
  conn.access_token_enc=encrypt(d.access_token); conn.refresh_token_enc=encrypt(d.refresh_token);
  return helix(path,d.access_token,options);
}
export async function sendChat(conn,message) {
  if(!conn?.enabled) throw fail(409,'Enable the bot before sending messages.');
  const rows=await db('private_twitch_bot_tokens?id=eq.afterhoursai&select=twitch_user_id,twitch_login');
  if(rows.length!==1||rows[0].twitch_login.toLowerCase()!=='afterhoursai') throw fail(503,'The existing AfterHoursAI connection was not found.');
  const d=await helix('chat/messages',await appAccess(),{method:'POST',body:{broadcaster_id:conn.twitch_user_id,sender_id:rows[0].twitch_user_id,message:message.slice(0,500)}});
  if(!d.data?.[0]?.is_sent) throw fail(422,'Twitch did not send the message. Check channel moderation and bot permissions.');
  return d.data[0].message_id;
}
