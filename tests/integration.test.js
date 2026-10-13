import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { encrypt,decrypt,owner } from '../lib/server.js';
import dashboard from '../api/bot/dashboard.js';
import channelStart from '../api/auth/twitch/channel-start.js';
import { finishCreatorOAuth } from '../lib/creator-oauth.js';
import webhook,{verify} from '../api/twitch/eventsub.js';
process.env.SUPABASE_URL='https://database.test';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-server-only-key';
process.env.TWITCH_TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
process.env.TWITCH_CLIENT_ID='test-client';
process.env.TWITCH_CLIENT_SECRET='test-client-secret';
process.env.BOT_API_SECRET='test-bot-secret';
process.env.TWITCH_REDIRECT_URI='https://snackvault.vercel.app/api/auth/twitch/callback';
const creatorId='11111111-1111-4111-8111-111111111111';
const userId='22222222-2222-4222-8222-222222222222';
const creator={id:creatorId,slug:'creator-two',name:'Creator Two'};
const conn={creator_id:creatorId,twitch_user_id:'67890',twitch_login:'secondstreamer',enabled:true,access_token_enc:'NEVER_PUBLIC_ACCESS',refresh_token_enc:'NEVER_PUBLIC_REFRESH',eventsub_status:'enabled',eventsub_chat_status:'enabled'};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
function res(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},json(d){this.body=d;return this;},send(d){this.body=d;return this;},end(){return this;},redirect(s,u){this.statusCode=s;this.url=u;return this;}};}
function request(body,method='POST'){return {method,body,headers:{authorization:'Bearer owner-session'},query:{}};}
function baseFetch(url){if(url.endsWith('/auth/v1/user'))return response({id:userId});if(url.includes('/creators?'))return response([creator]);if(url.includes('/creator_twitch_bots?'))return response([conn]);if(url.includes('rpc/sv_bot_summary'))return response({total_pulls:12,collectors:3,total_copies:12,deliveries:[]});throw Error('Unexpected test fetch: '+url);}

test('encrypted tokens round-trip and tampered ciphertext is rejected',()=>{
 const value=encrypt('test-access-token');assert.equal(decrypt(value),'test-access-token');assert.ok(!value.includes('test-access-token'));
 const parts=value.split('.');parts[3]=Buffer.alloc(17).toString('base64');assert.throws(()=>decrypt(parts.join('.')));
});
test('owner authorization requires a bearer session before querying anything',async()=>{
 let fetched=false;global.fetch=async()=>{fetched=true;throw Error('unexpected')};
 await assert.rejects(()=>owner({headers:{}}),{status:401});assert.equal(fetched,false);
});
test('invalid Supabase session cannot use server database privileges',async()=>{
 let calls=0;global.fetch=async()=>{calls++;return response({},401)};
 await assert.rejects(()=>owner(request({})),{status:401});assert.equal(calls,1);
});
test('dashboard exposes EventSub state without returning credentials',async()=>{
 global.fetch=async u=>baseFetch(u);const r=res();await dashboard(request(null,'GET'),r);
 assert.equal(r.statusCode,200);assert.equal(r.body.connection.twitch_login,'secondstreamer');
 assert.equal(r.body.connection.eventsub_chat_status,'enabled');
 const serialized=JSON.stringify(r.body);assert.ok(!serialized.includes('NEVER_PUBLIC'));assert.ok(!serialized.includes('test-server-only-key'));
});
test('enable action ignores a caller-supplied creator ID and updates the authenticated owner only',async()=>{
 let patched='';global.fetch=async(u,o)=>{if(o?.method==='PATCH'){patched=u;return new Response(null,{status:204});}return baseFetch(u)};
 const r=res();await dashboard(request({action:'enabled',enabled:false,creator_id:'someone-else'}),r);
 assert.equal(r.statusCode,200);assert.ok(patched.includes(creatorId));assert.ok(!patched.includes('someone-else'));
});
test('test messages use the connected second channel and the existing AfterHoursAI identity',async()=>{
 let chat;global.fetch=async(u,o)=>{
  if(u.includes('rpc/sv_claim_test'))return response(true);
  if(u.includes('private_twitch_bot_tokens'))return response([{twitch_user_id:'12345',twitch_login:'afterhoursai'}]);
  if(u==='https://id.twitch.tv/oauth2/token')return response({access_token:'app-token',expires_in:3600});
  if(u.endsWith('/chat/messages')){chat=JSON.parse(o.body);return response({data:[{is_sent:true,message_id:'msg-1'}]});}
  return baseFetch(u);
 };
 const r=res();await dashboard(request({action:'test',message:'IGNORE ME',channel:'underscorepower'}),r);
 assert.equal(r.statusCode,200);assert.equal(chat.broadcaster_id,'67890');assert.equal(chat.sender_id,'12345');assert.match(chat.message,/12 pulls/);assert.ok(!chat.message.includes('IGNORE ME'));
});
test('atomic cooldown prevents another test chat request',async()=>{
 global.fetch=async u=>u.includes('rpc/sv_claim_test')?response(false):baseFetch(u);
 const r=res();await dashboard(request({action:'test'}),r);assert.equal(r.statusCode,429);
});
test('creator OAuth start binds nonce to the authenticated creator and keeps the registered callback',async()=>{
 let saved;global.fetch=async(u,o)=>{if(u.endsWith('/bot_oauth_nonces')){saved=JSON.parse(o.body);return new Response(null,{status:201});}return baseFetch(u)};
 const r=res();await channelStart(request({creator_id:'someone-else'}),r);assert.equal(r.statusCode,200);
 const url=new URL(r.body.url);assert.equal(url.searchParams.get('redirect_uri'),process.env.TWITCH_REDIRECT_URI);assert.equal(saved.creator_id,creatorId);assert.equal(saved.nonce,url.searchParams.get('state'));assert.match(url.searchParams.get('scope'),/channel:manage:redemptions/);assert.ok(r.headers['Set-Cookie'].every(c=>c.includes('HttpOnly')&&c.includes('Secure')));
});
test('callback rejects mismatched browser state without exchanging a token',async()=>{
 global.fetch=async()=>{throw Error('must not fetch')};const r=res();await finishCreatorOAuth({query:{state:'wrong',code:'x'}},r,{twitch_oauth_state:'right'});assert.equal(r.statusCode,403);
});
test('callback rejects used or expired nonce',async()=>{
 global.fetch=async u=>{assert.ok(u.endsWith('rpc/sv_consume_nonce'));return response(null)};
 const r=res();await finishCreatorOAuth({query:{state:'right',code:'x'}},r,{twitch_oauth_state:'right'});assert.equal(r.statusCode,403);
});
test('creator callback accepts a second streamer and stores only encrypted tokens',async()=>{
 let stored;global.fetch=async(u,o)=>{
  if(u.endsWith('rpc/sv_consume_nonce'))return response(creatorId);
  if(u==='https://id.twitch.tv/oauth2/token')return response({access_token:'new-token',refresh_token:'new-refresh',scope:['channel:bot','channel:manage:redemptions']});
  if(u.endsWith('/helix/users'))return response({data:[{id:'9999',login:'streamer_three'}]});
  if(u.includes('creator_twitch_bots?creator_id='))return response([]);
  if(u.includes('creator_twitch_bots?on_conflict=')){stored=JSON.parse(o.body);return new Response(null,{status:201});}
  throw Error('unexpected');
 };
 const r=res();await finishCreatorOAuth({query:{state:'right',code:'x'}},r,{twitch_oauth_state:'right'});
 assert.equal(r.statusCode,302);assert.equal(stored.creator_id,creatorId);assert.equal(stored.enabled,false);assert.equal(stored.twitch_login,'streamer_three');assert.equal(decrypt(stored.access_token_enc),'new-token');assert.equal(r.url,'https://snackvault.vercel.app/admin?bot=connected#bot');
});
function signed(raw,timestamp=new Date().toISOString()){
 const secret=createHmac('sha256',process.env.BOT_API_SECRET).update('snack-vault:eventsub:v1').digest('hex');
 return {'twitch-eventsub-message-id':'event-1','twitch-eventsub-message-timestamp':timestamp,'twitch-eventsub-message-signature':'sha256='+createHmac('sha256',secret).update('event-1'+timestamp).update(raw).digest('hex')};
}
test('EventSub verifies the raw body and rejects modification and replay outside ten minutes',()=>{
 const raw=Buffer.from('{"challenge":"abc"}');const headers=signed(raw);assert.equal(verify(headers,raw),true);assert.equal(verify(headers,Buffer.from('{}')),false);assert.equal(verify(signed(raw,new Date(Date.now()-660000).toISOString()),raw),false);assert.equal(verify({},raw),false);
});
test('EventSub challenge returns exact plaintext, with no database write',async()=>{
 global.fetch=async()=>{throw Error('no fetch expected')};
 const raw=Buffer.from(JSON.stringify({subscription:{type:'channel.channel_points_custom_reward_redemption.add',version:'1'},challenge:'challenge-text'}));
 const req=Readable.from([raw]);req.method='POST';req.headers={...signed(raw),'twitch-eventsub-message-type':'webhook_callback_verification'};
 const r=res();await webhook(req,r);assert.equal(r.statusCode,200);assert.equal(r.body,'challenge-text');assert.equal(r.headers['Content-Type'],'text/plain');
});
test('EventSub unsigned request cannot award a snack',async()=>{
 global.fetch=async()=>{throw Error('no fetch expected')};const req=Readable.from([Buffer.from('{}')]);req.method='POST';req.headers={};const r=res();await webhook(req,r);assert.equal(r.statusCode,403);
});
