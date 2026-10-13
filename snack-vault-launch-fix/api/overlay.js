import { db, fail, report } from '../lib/server.js';
export default async function handler(req,res) {
  if(req.method!=='GET') return res.status(405).json({error:'Use GET.'});
  try {
    const slug=req.query.creator || req.query.channel;
    if(typeof slug!=='string'||! /^[a-z0-9_-]{1,100}$/i.test(slug)) throw fail(400,'A creator slug is required.');
    const d=await db('rpc/sv_overlay_feed',{method:'POST',body:{p_slug:slug}});
    if(!d) throw fail(404,'Creator not found.');
    // All five overlay variants share this URL and Vercel's cached public response.
    res.setHeader('Cache-Control','public, max-age=0, s-maxage=5, stale-while-revalidate=5');
    return res.json({...d,latest:{...d.events[0],total:d.total,items:d.items,leaders:d.leaders}});
  } catch(error) {res.setHeader('Cache-Control','no-store');return report(res,error);}
}
