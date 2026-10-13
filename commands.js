import { owner,db,fail,report } from '../../lib/server.js';
function validate(body) {
  const name=typeof body?.command_name==='string'?body.command_name.trim().replace(/^!/,'').toLowerCase():'';
  const response=typeof body?.response==='string'?body.response.trim():'';
  const cooldown=Number(body?.cooldown_seconds);
  if(!/^[a-z0-9_]{1,24}$/.test(name)) throw fail(400,'Command name must be 1–24 letters, numbers, or underscores.');
  if(!response||response.length>450||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(response)) throw fail(400,'Response must be 1–450 characters.');
  if(!Number.isInteger(cooldown)||cooldown<1||cooldown>3600) throw fail(400,'Cooldown must be 1–3600 seconds.');
  return {command_name:name,response,cooldown_seconds:cooldown};
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');res.setHeader('Allow','GET, POST, PUT, DELETE');
  if(!['GET','POST','PUT','DELETE'].includes(req.method)) return res.status(405).json({error:'Use GET, POST, PUT, or DELETE.'});
  try {
    const creator=await owner(req);
    if(req.method==='GET') return res.json({commands:await db(`sv_commands?creator_id=eq.${creator.id}&select=id,command_name,response,enabled,cooldown_seconds,created_at&order=command_name`)});
    if(req.method==='POST') {
      const data=validate(req.body);
      const rows=await db('sv_commands',{method:'POST',body:{creator_id:creator.id,...data,enabled:true},prefer:'return=representation'});
      return res.status(201).json({command:rows[0]});
    }
    const id=req.body?.id;
    if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)) throw fail(400,'Invalid command ID.');
    const path=`sv_commands?id=eq.${id}&creator_id=eq.${creator.id}`;
    const existing=await db(path);
    if(!existing.length) throw fail(404,'Command not found in your vault.');
    if(req.method==='DELETE') {await db(path,{method:'DELETE'});return res.json({success:true});}
    const data=validate(req.body);
    const rows=await db(path,{method:'PATCH',body:{...data,enabled:req.body.enabled===true,updated_at:new Date().toISOString()},prefer:'return=representation'});
    return res.json({command:rows[0]});
  } catch(error) {return report(res,error);}
}
