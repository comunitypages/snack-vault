import { db,connection,sendChat,channelAPI } from './server.js';
export async function deliver(receipt) {
  if(!receipt) return;
  const conn=await connection(receipt.creator_id);
  if(!conn) return;
  const path=`sv_redemptions?redemption_id=eq.${encodeURIComponent(receipt.redemption_id)}`;
  if(receipt.result.success && conn.enabled) {
    // Claim before sending: duplicate EventSub deliveries do not duplicate chat messages.
    // An ambiguous network result remains 'uncertain'; manual retry may duplicate a message, never a pull.
    const claimed=await db(path+'&chat_status=eq.pending',{method:'PATCH',body:{chat_status:'sending',updated_at:new Date().toISOString()},prefer:'return=representation'});
    if(claimed.length) {
      try {await sendChat(conn,receipt.result.message);await db(path,{method:'PATCH',body:{chat_status:'sent',updated_at:new Date().toISOString()}});}
      catch(error) { await db(path,{method:'PATCH',body:{chat_status:'uncertain',updated_at:new Date().toISOString()}}); }
    }
  }
  if(receipt.fulfilled) return;
  if(!conn.reward_managed || conn.reward_id!==receipt.reward_id) {
    await db(path,{method:'PATCH',body:{fulfillment_status:'manual'}}); return;
  }
  const status=receipt.result.success?'FULFILLED':'CANCELED';
  const url=`channel_points/custom_rewards/redemptions?broadcaster_id=${encodeURIComponent(conn.twitch_user_id)}&reward_id=${encodeURIComponent(receipt.reward_id)}&id=${encodeURIComponent(receipt.redemption_id)}`;
  try {
    // First reconcile, so retrying an already completed Twitch update is safe.
    const current=(await channelAPI(conn,url)).data?.[0];
    if(current?.status==='UNFULFILLED') await channelAPI(conn,url,{method:'PATCH',body:{status}});
    if(!current) throw new Error('missing redemption');
    await db(path,{method:'PATCH',body:{fulfilled:true,fulfillment_status:current.status==='CANCELED'?'canceled':current.status==='FULFILLED'?'fulfilled':status.toLowerCase()}});
  } catch(error) {await db(path,{method:'PATCH',body:{fulfillment_status:'retry_needed'}});}
}
