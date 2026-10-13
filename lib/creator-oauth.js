import { equal, db, encrypt, connection, scopes, origin } from './server.js';
export async function finishCreatorOAuth(req,res,cookies) {
  res.setHeader('Set-Cookie',[
    'twitch_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/twitch; Max-Age=0',
    'twitch_oauth_flow=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/twitch; Max-Age=0'
  ]);
  const {state,code,error}=req.query;
  if(typeof state!=='string'||!cookies.twitch_oauth_state||!equal(state,cookies.twitch_oauth_state)) return res.status(403).send('Invalid or expired connection request. Return to the dashboard and try again.');
  try {
    // DELETE ... RETURNING atomically consumes the nonce, even on denied consent.
    const creatorId=await db('rpc/sv_consume_nonce',{method:'POST',body:{p_nonce:state}});
    if(!creatorId) return res.status(403).send('Connection request expired or was already used.');
    if(error||typeof code!=='string') return res.redirect(302,`${origin()}/admin?bot=cancelled#bot`);
    const r=await fetch('https://id.twitch.tv/oauth2/token',{method:'POST',body:new URLSearchParams({client_id:process.env.TWITCH_CLIENT_ID,client_secret:process.env.TWITCH_CLIENT_SECRET,code,grant_type:'authorization_code',redirect_uri:process.env.TWITCH_REDIRECT_URI}),signal:AbortSignal.timeout(8000)});
    if(!r.ok) throw new Error('token exchange');
    const tokens=await r.json();
    if(!tokens.access_token||!tokens.refresh_token||!scopes.every(s=>tokens.scope?.includes(s))) return res.status(403).send('Required channel permissions were not granted. Return to the dashboard to reconnect.');
    const u=await fetch('https://api.twitch.tv/helix/users',{headers:{Authorization:`Bearer ${tokens.access_token}`,'Client-Id':process.env.TWITCH_CLIENT_ID},signal:AbortSignal.timeout(8000)});
    if(!u.ok) throw new Error('account lookup');
    const account=(await u.json()).data?.[0];
    if(!account?.id||!account.login||account.login.toLowerCase()==='afterhoursai') return res.status(403).send('Connect your streaming channel, not the AfterHoursAI bot account.');
    const old=await connection(creatorId);
    if(old && old.twitch_user_id!==account.id) return res.status(409).send('This vault is already linked to a different Twitch channel. Sign in with the originally connected channel.');
    await db('creator_twitch_bots?on_conflict=creator_id',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{creator_id:creatorId,twitch_user_id:account.id,twitch_login:account.login,access_token_enc:encrypt(tokens.access_token),refresh_token_enc:encrypt(tokens.refresh_token),connected_at:new Date().toISOString(),...(old?{}:{enabled:false})}});
    return res.redirect(302,`${origin()}/admin?bot=connected#bot`);
  } catch(error) {
    console.error('Creator connection failed',error.status||500);
    return res.status(error.status===409?409:502).send(error.status===409?'That Twitch channel is already linked to a vault.':'Could not save the channel connection. Check the migration and server configuration, then retry from the dashboard.');
  }
}
