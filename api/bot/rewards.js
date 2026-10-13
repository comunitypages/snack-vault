import { owner,connection,patchConnection,channelAPI,helix,appAccess,eventSecret,origin,fail,report } from '../../lib/server.js';
const REWARD_TYPE='channel.channel_points_custom_reward_redemption.add';
const CHAT_TYPE='channel.chat.message';
async function ensureSubscription(conn,type,condition,columns) {
  const token=await appAccess(), callback=`${origin()}/api/twitch/eventsub`;
  let cursor; const stale=[];
  do {
    const page=await helix(`eventsub/subscriptions?type=${type}${cursor?'&after='+encodeURIComponent(cursor):''}`,token);
    for(const sub of page.data||[]) {
      if(sub.transport?.callback!==callback||Object.entries(condition).some(([k,v])=>sub.condition?.[k]!==v)) continue;
      if(['enabled','webhook_callback_verification_pending'].includes(sub.status)) {
        await patchConnection(conn.creator_id,{[columns.id]:sub.id,[columns.status]:sub.status});
        return sub;
      }
      stale.push(sub.id);
    }
    cursor=page.pagination?.cursor;
  } while(cursor);
  for(const id of stale) await helix(`eventsub/subscriptions?id=${encodeURIComponent(id)}`,token,{method:'DELETE'});
  const d=await helix('eventsub/subscriptions',token,{method:'POST',body:{type,version:'1',condition,transport:{method:'webhook',callback,secret:eventSecret()}}});
  const subscription=d.data?.[0];
  if(!subscription) throw fail(502,`Twitch did not return the ${type} subscription.`);
  await patchConnection(conn.creator_id,{[columns.id]:subscription.id,[columns.status]:subscription.status});
  return subscription;
}
async function subscribe(conn) {
  const botRows=await db('private_twitch_bot_tokens?id=eq.afterhoursai&select=twitch_user_id,twitch_login');
  const bot=botRows[0];
  if(!bot||bot.twitch_login.toLowerCase()!=='afterhoursai') throw fail(503,'The existing AfterHoursAI connection was not found.');
  const [reward,chat]=await Promise.all([
    ensureSubscription(conn,REWARD_TYPE,{broadcaster_user_id:conn.twitch_user_id},{id:'eventsub_id',status:'eventsub_status'}),
    ensureSubscription(conn,CHAT_TYPE,{broadcaster_user_id:conn.twitch_user_id,user_id:bot.twitch_user_id},{id:'eventsub_chat_id',status:'eventsub_chat_status'})
  ]);
  return {reward,chat,status:reward.status,chat_status:chat.status};
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');res.setHeader('Allow','GET, POST');
  if(!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Use GET or POST.'});
  try {
    const c=await owner(req),conn=await connection(c.id);
    if(!conn) throw fail(409,'Connect Twitch first.');
    const path=`channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(conn.twitch_user_id)}`;
    if(req.method==='GET') {
      const all=await channelAPI(conn,path), managed=await channelAPI(conn,path+'&only_manageable_rewards=true');
      const ids=new Set(managed.data.map(r=>r.id));
      return res.json({rewards:all.data.map(r=>({id:r.id,title:r.title,cost:r.cost,managed:ids.has(r.id)}))});
    }
    const action=req.body?.action;
    if(action==='subscribe') { const s=await subscribe(conn);return res.json({success:true,status:s.status,chat_status:s.chat_status}); }
    let reward,managed;
    if(action==='create') {
      const title=req.body.title,cost=req.body.cost;
      if(typeof title!=='string'||!title.trim()||title.length>45||!Number.isSafeInteger(cost)||cost<1||cost>1000000000) throw fail(400,'Use a title of 1–45 characters and a whole-number cost of at least 1.');
      const d=await channelAPI(conn,path,{method:'POST',body:{title:title.trim(),cost,prompt:'Open a Snack Vault bag!',is_user_input_required:false,should_redemptions_skip_request_queue:false}});
      reward=d.data[0];managed=true;
    } else if(action==='select') {
      const id=req.body.reward_id;
      if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)) throw fail(400,'Choose a reward.');
      reward=(await channelAPI(conn,path+'&id='+encodeURIComponent(id))).data?.[0];
      if(!reward) throw fail(404,'That reward does not belong to this channel.');
      managed=(await channelAPI(conn,path+'&only_manageable_rewards=true')).data.some(r=>r.id===id);
    } else throw fail(400,'Unknown reward action.');
    await patchConnection(c.id,{reward_id:reward.id,reward_managed:managed});
    // Save the reward even if subscription creation fails; the dashboard provides a retry button.
    const s=await subscribe(conn);
    return res.json({success:true,status:s.status,chat_status:s.chat_status,managed});
  } catch(error) {return report(res,error);}
}
