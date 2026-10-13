import { deliver } from '../../lib/delivery.js';
import { db, owner, connection, patchConnection, sendChat, fail, report } from '../../lib/server.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store'); res.setHeader('Allow','GET, POST');
  if(!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Use GET or POST.'});
  try {
    const creator=await owner(req), conn=await connection(creator.id);
    if(req.method==='GET') {
      // Explicit safe projection: encrypted and plaintext credentials never leave the server.
      const safe=conn?{twitch_login:conn.twitch_login,enabled:conn.enabled,connected_at:conn.connected_at,last_test_at:conn.last_test_at,reward_id:conn.reward_id,eventsub_status:conn.eventsub_status,eventsub_chat_status:conn.eventsub_chat_status}:null;
      const summary=await db('rpc/sv_bot_summary',{method:'POST',body:{p_creator:creator.id}});
      return res.json({connection:safe,summary});
    }
    if(!conn) throw fail(409,'Connect your Twitch channel first.');
    const action=req.body?.action;
    if(action==='enabled') {
      if(typeof req.body.enabled!=='boolean') throw fail(400,'enabled must be true or false.');
      await patchConnection(creator.id,{enabled:req.body.enabled});
      return res.json({success:true});
    }
    if(action==='retry') {
      if(!conn.enabled) throw fail(409,'Enable the bot before retrying delivery.');
      const id=req.body.redemption_id;
      if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)) throw fail(400,'Invalid redemption ID.');
      const path=`sv_redemptions?creator_id=eq.${creator.id}&redemption_id=eq.${encodeURIComponent(id)}`;
      const receipt=(await db(path))[0];
      if(!receipt) throw fail(404,'Redemption not found in your vault.');
      if(receipt.chat_status==='sending' && Date.now()-Date.parse(receipt.updated_at)<60000) throw fail(409,'Delivery is still running. Wait a minute.');
      if(['uncertain','sending'].includes(receipt.chat_status)) {
        await db(path,{method:'PATCH',body:{chat_status:'pending'}});
        receipt.chat_status='pending';
      }
      await deliver(receipt);
      return res.json({success:true});
    }
    if(action==='test') {
      if(!conn.enabled) throw fail(409,'Enable the bot first.');
      const allowed=await db('rpc/sv_claim_test',{method:'POST',body:{p_creator:creator.id}});
      if(!allowed) throw fail(429,'Wait 30 seconds between test messages.');
      const s=await db('rpc/sv_bot_summary',{method:'POST',body:{p_creator:creator.id}});
      const id=await sendChat(conn,`AfterHoursAI is connected to ${creator.name}! Snack Vault: ${s.total_pulls} pulls, ${s.collectors} collectors, ${s.total_copies} snacks collected. 🍿`);
      return res.json({success:true,message_id:id});
    }
    throw fail(400,'Unknown bot action.');
  } catch(error) { return report(res,error); }
}
