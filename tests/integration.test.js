import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { encrypt,decrypt,owner } from '../lib/server.js';
import dashboard from '../api/bot/dashboard.js';
import rewards from '../api/bot/rewards.js';
import overlay from '../api/overlay.js';
import channelStart from '../api/auth/twitch/channel-start.js';
import { finishCreatorOAuth } from '../lib/creator-oauth.js';
import webhook,{verify,processChatEvent} from '../api/twitch/eventsub.js';
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
test('enabling the cloud bot registers chat and redemption EventSub before activating it',async()=>{
 const created=[];let activated=false;
 global.fetch=async(u,o={})=>{
  if(u==='https://id.twitch.tv/oauth2/token')return response({access_token:'app-token',expires_in:3600});
  if(u.includes('/private_twitch_bot_tokens?'))return response([{twitch_user_id:'12345',twitch_login:'afterhoursai'}]);
  if(u.includes('/eventsub/subscriptions?type='))return response({data:[]});
  if(u.endsWith('/eventsub/subscriptions')&&o.method==='POST'){
   const body=JSON.parse(o.body);created.push(body.type);
   return response({data:[{id:`sub-${created.length}`,type:body.type,status:'webhook_callback_verification_pending'}]});
  }
  if(o.method==='PATCH'&&u.includes('/creator_twitch_bots?creator_id=')){
   if(JSON.parse(o.body).enabled===true)activated=true;
   return new Response(null,{status:204});
  }
  return baseFetch(u);
 };
 const r=res();await dashboard(request({action:'enabled',enabled:true}),r);
 assert.equal(r.statusCode,200,JSON.stringify(r.body));assert.equal(activated,true);
 assert.deepEqual(created.sort(),['channel.channel_points_custom_reward_redemption.add','channel.chat.message'].sort());
 assert.equal(r.body.chat_status,'webhook_callback_verification_pending');
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
test('creator can save a one-second per-viewer redemption cooldown',async()=>{
 let patched;
 global.fetch=async(u,o)=>{
  if(o?.method==='PATCH'&&u.includes('/creator_twitch_bots?creator_id=')){patched=JSON.parse(o.body);return new Response(null,{status:204});}
  return baseFetch(u);
 };
 const r=res();await rewards(request({action:'cooldown',viewer_cooldown_seconds:1}),r);
 assert.equal(r.statusCode,200);assert.equal(r.body.viewer_cooldown_seconds,1);assert.deepEqual(patched,{redemption_user_cooldown_seconds:1});
 const invalid=res();await rewards(request({action:'cooldown',viewer_cooldown_seconds:0}),invalid);assert.equal(invalid.statusCode,400);
});
test('!snack command pulls one snack and announces the database result',async()=>{
 let chat;
 global.fetch=async(u,o)=>{
  if(u.includes('/creator_twitch_bots?'))return response([{creator_id:creatorId}]);
  if(u.includes('/rpc/sv_claim_command'))return response({status:'matched',command:'snack',command_type:'pull'});
  if(u.includes('/rpc/do_pull'))return response({success:true,message:'Viewer pulled Chips! NEW snack discovered!'});
  if(u.includes('/private_twitch_bot_tokens?'))return response([{twitch_user_id:'12345',twitch_login:'afterhoursai'}]);
  if(u==='https://id.twitch.tv/oauth2/token')return response({access_token:'app-token',expires_in:3600});
  if(u.endsWith('/chat/messages')){chat=JSON.parse(o.body);return response({data:[{is_sent:true,message_id:'chat-1'}]});}
  throw Error('Unexpected chat-command fetch: '+u);
 };
 await processChatEvent({}, {broadcaster_user_id:'67890',broadcaster_user_login:'secondstreamer',chatter_user_id:'777',chatter_user_login:'viewer',chatter_user_name:'Viewer',message_type:'text',message:{text:'!snack'}});
 assert.equal(chat.broadcaster_id,'67890');assert.equal(chat.sender_id,'12345');assert.equal(chat.message,'Viewer pulled Chips! NEW snack discovered!');
});
test('custom chat replies support percent, Twitch-style and dollar placeholders',async()=>{
 let chat;
 global.fetch=async(u,o)=>{
  if(u.includes('/creator_twitch_bots?'))return response([{creator_id:creatorId}]);
  if(u.includes('/rpc/sv_claim_command'))return response({status:'matched',command:'hello',command_type:'response',response:'Hi %user%! Welcome to $(channel); use $command%.'});
  if(u.includes('/private_twitch_bot_tokens?'))return response([{twitch_user_id:'12345',twitch_login:'afterhoursai'}]);
  if(u==='https://id.twitch.tv/oauth2/token')return response({access_token:'app-token',expires_in:3600});
  if(u.endsWith('/chat/messages')){chat=JSON.parse(o.body);return response({data:[{is_sent:true,message_id:'chat-2'}]});}
  throw Error('Unexpected placeholder fetch: '+u);
 };
 await processChatEvent({}, {broadcaster_user_id:'67890',broadcaster_user_login:'secondstreamer',broadcaster_user_name:'Second Streamer',chatter_user_login:'viewer',chatter_user_name:'Viewer',message_type:'text',message:{text:'!hello'}});
 assert.equal(chat.message,'Hi Viewer! Welcome to Second Streamer; use !hello.');
});
test('public overlay feed returns pull activity and collection data without credentials',async()=>{
 const feed={events:[{id:'pull-1',username:'Viewer',snack_name:'Chips',rarity:'Rare'}],total:4,items:[{name:'Chips',count:4}],leaders:[{name:'Viewer',count:4}],snacks:[{name:'Chips',image_url:null,rarity:'Rare'}]};
 global.fetch=async u=>u.includes('/rpc/sv_overlay_feed')?response(feed):baseFetch(u);
 const r=res();await overlay({method:'GET',query:{creator:'creator-two'}},r);
 assert.equal(r.statusCode,200);assert.equal(r.body.events[0].snack_name,'Chips');
 assert.equal(r.body.latest.total,4);assert.deepEqual(r.body.latest.items,feed.items);
 assert.match(r.headers['Cache-Control'],/s-maxage=5/);
 assert.ok(!JSON.stringify(r.body).includes('test-server-only-key'));
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
