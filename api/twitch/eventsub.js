import { createHmac } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { db,eventSecret,equal,report } from '../../lib/server.js';
import { deliver } from '../../lib/delivery.js';
export const config={api:{bodyParser:false}};
export function verify(headers,raw,now=Date.now()) {
  const id=headers['twitch-eventsub-message-id'],timestamp=headers['twitch-eventsub-message-timestamp'],signature=headers['twitch-eventsub-message-signature'];
  const t=Date.parse(timestamp);
  if(typeof id!=='string'||!Number.isFinite(t)||Math.abs(now-t)>600000||typeof signature!=='string') return false;
  const expected='sha256='+createHmac('sha256',eventSecret()).update(id+timestamp).update(raw).digest('hex');
  return equal(expected,signature);
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
    const type=req.headers['twitch-eventsub-message-type'],s=payload.subscription;
    if(s?.type!=='channel.channel_points_custom_reward_redemption.add'||s?.version!=='1') return res.status(204).end();
    if(type==='webhook_callback_verification') {
      if(typeof payload.challenge!=='string') return res.status(400).end();
      res.setHeader('Content-Type','text/plain');res.setHeader('Content-Length',Buffer.byteLength(payload.challenge));
      return res.status(200).send(payload.challenge);
    }
    if(type==='revocation') {
      await db(`creator_twitch_bots?eventsub_id=eq.${encodeURIComponent(s.id)}`,{method:'PATCH',body:{eventsub_status:s.status}});
      return res.status(204).end();
    }
    if(type!=='notification') return res.status(204).end();
    const e=payload.event;
    if(!e?.id||!e.user_login||!e.reward?.id||e.broadcaster_user_id!==s.condition?.broadcaster_user_id) return res.status(400).end();
    if(e.status==='CANCELED') return res.status(204).end();
    const receipt=await db('rpc/sv_process_redemption',{method:'POST',body:{p_redemption:e.id,p_channel:e.broadcaster_user_id,p_reward:e.reward.id,p_login:e.user_login}});
    // The transaction above has durably stored the pull before acknowledgment.
    // waitUntil keeps chat/fulfillment alive after returning Twitch's acknowledgment.
    if(receipt) waitUntil(Promise.all([deliver(receipt), db(`creator_twitch_bots?eventsub_id=eq.${encodeURIComponent(s.id)}`,{method:'PATCH',body:{eventsub_status:'enabled'}})]).catch(()=>console.error('Delivery needs dashboard retry')));
    return res.status(204).end();
  } catch(error) {return report(res,error);}
}
