import { createHmac } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { db,eventSecret,equal,report,sendChat,fail } from '../../lib/server.js';
import { deliver } from '../../lib/delivery.js';
export const config={api:{bodyParser:false}};
const REWARD='channel.channel_points_custom_reward_redemption.add';
const CHAT='channel.chat.message';
export function verify(headers,raw,now=Date.now()) {
  const id=headers['twitch-eventsub-message-id'],timestamp=headers['twitch-eventsub-message-timestamp'],signature=headers['twitch-eventsub-message-signature'];
  const t=Date.parse(timestamp);
  if(typeof id!=='string'||!Number.isFinite(t)||Math.abs(now-t)>600000||typeof signature!=='string') return false;
  const expected='sha256='+createHmac('sha256',eventSecret()).update(id+timestamp).update(raw).digest('hex');
  return equal(expected,signature);
}
function safeText(s,max=80) { return String(s||'').replace(/[\r\n\u0000-\u001f]/g,' ').trim().slice(0,max); }
export async function processChatEvent(subscription,event) {
  if(!event?.broadcaster_user_id||!event?.chatter_user_login||!event?.message?.text) return;
  if(event.chatter_user_login.toLowerCase()==='afterhoursai') return;
  if(event.message_type==='reply'||event.message?.text.length>500) return;
  const command=event.message.text.trim().split(/\s+/,1)[0];
  if(!/^![a-zA-Z0-9_]{1,24}$/.test(command)) return;
  const matches=await db(`creator_twitch_bots?twitch_user_id=eq.${encodeURIComponent(event.broadcaster_user_id)}&enabled=eq.true&select=creator_id`);
  if(matches.length!==1) return;
  const claimed=await db('rpc/sv_claim_command',{method:'POST',body:{p_creator:matches[0].creator_id,p_command:command.slice(1).toLowerCase()}});
  if(!claimed||claimed.status!=='matched') return;
  const output=safeText(claimed.response,450)
    .replaceAll('{user}',safeText(event.chatter_user_name||event.chatter_user_login,60))
    .replaceAll('{channel}',safeText(event.broadcaster_user_name||event.broadcaster_user_login,60))
    .replaceAll('{command}',`!${claimed.command}`);
  if(output) await sendChat({creator_id:matches[0].creator_id,twitch_user_id:event.broadcaster_user_id,enabled:true},output);
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).end();
  try {
    const chunks=[];let length=0;
    for await(const chunk of req) {const b=Buffer.from(chunk);length+=b.length;if(length>262144) return res.status(413).end();chunks.push(b);}
    const raw=Buffer.concat(chunks);
    if(!verify(req.headers,raw)) return res.status(403).end();
    let payload;try{payload=JSON.parse(raw.toString('utf8'));}catch{return res.status(400).end();}
    const type=req.headers['twitch-eventsub-message-type'],sub=payload.subscription;
    if(![REWARD,CHAT].includes(sub?.type)||sub?.version!=='1') return res.status(204).end();
    if(type==='webhook_callback_verification') {
      if(typeof payload.challenge!=='string') return res.status(400).end();
      const col=sub.type===CHAT?'eventsub_chat_id':'eventsub_id',status=sub.type===CHAT?'eventsub_chat_status':'eventsub_status';
      waitUntil(db(`creator_twitch_bots?${col}=eq.${encodeURIComponent(sub.id)}`,{method:'PATCH',body:{[status]:'enabled'}}).catch(()=>{}));
      res.setHeader('Content-Type','text/plain');res.setHeader('Content-Length',Buffer.byteLength(payload.challenge));
      return res.status(200).send(payload.challenge);
    }
    const col=sub.type===CHAT?'eventsub_chat_id':'eventsub_id',status=sub.type===CHAT?'eventsub_chat_status':'eventsub_status';
    if(type==='revocation') {
      await db(`creator_twitch_bots?${col}=eq.${encodeURIComponent(sub.id)}`,{method:'PATCH',body:{[status]:sub.status}});
      return res.status(204).end();
    }
    if(type!=='notification') return res.status(204).end();
    const event=payload.event;
    if(!event||event.broadcaster_user_id!==sub.condition?.broadcaster_user_id) return res.status(400).end();
    if(sub.type===CHAT) {
      waitUntil(Promise.all([
        processChatEvent(sub,event),
        db(`creator_twitch_bots?${col}=eq.${encodeURIComponent(sub.id)}`,{method:'PATCH',body:{[status]:'enabled'}})
      ]).catch(error=>console.error('Chat command processing failed',error.status||500)));
      return res.status(204).end();
    }
    if(!event.id||!event.user_login||!event.reward?.id) return res.status(400).end();
    if(event.status==='CANCELED') return res.status(204).end();
    const receipt=await db('rpc/sv_process_redemption',{method:'POST',body:{p_redemption:event.id,p_channel:event.broadcaster_user_id,p_reward:event.reward.id,p_login:event.user_login}});
    if(receipt) waitUntil(Promise.all([
      deliver(receipt),
      db(`creator_twitch_bots?${col}=eq.${encodeURIComponent(sub.id)}`,{method:'PATCH',body:{[status]:'enabled'}})
    ]).catch(()=>console.error('Redemption delivery needs dashboard retry')));
    return res.status(204).end();
  } catch(error) {return report(res,error);}
}
