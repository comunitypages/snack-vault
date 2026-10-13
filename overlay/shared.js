/* Public overlay adapter. No bot or database credentials are placed in URLs. */
(function(){
 const params=new URLSearchParams(location.search),demo=params.get('demo')==='1';
 const channel=params.get('creator')||params.get('channel')||'underscorepower';
 const api=params.get('api')||('/api/overlay?creator='+encodeURIComponent(channel));
 const poll=Math.max(5000,Number(params.get('poll'))||5000);
 let first=true,seen=new Set(),queue=[],playing=false;
 function normalize(d,feed={}) {return {id:String(d.id||d.event_id||d.pull_id||d.timestamp||''),username:String(d.username||d.user||d.viewer||'Viewer'),snack:String(d.snack?.name||d.snack_name||d.snack||d.item||'Mystery Snack'),emoji:String(d.snack?.emoji||d.emoji||'🍬'),rarity:String(d.rarity||d.snack?.rarity||'Common'),total:Number(feed.total??d.total??0),items:feed.items||d.items||[],leaders:feed.leaders||d.leaders||[],timestamp:d.timestamp||''};}
 function dispatch(d){document.dispatchEvent(new CustomEvent('snackvault:update',{detail:d}));}
 const isAlert=location.pathname.includes('pull-alert');
 function playQueue(){if(playing||!queue.length)return;playing=true;dispatch(queue.shift());setTimeout(()=>{playing=false;playQueue()},8500);}
 function update(d){if(isAlert){queue.push(d);playQueue();}else dispatch(d);}
 if(demo){const sample={id:'demo',username:'DemoViewer',snack:'Doritos Nacho Cheese',emoji:'🌮',rarity:'Legendary',total:12,items:[{name:'Doritos',count:3}],leaders:[{name:'DemoViewer',count:12}]};setTimeout(()=>update(sample),100);return;}
 async function fetchUpdate(){
  try{
   const url=new URL(api,location.href);
   const r=await fetch(url,{credentials:'omit'});if(!r.ok)throw new Error('Feed unavailable');
   const raw=await r.json();
   const events=Array.isArray(raw.events)?raw.events:[raw.event||raw.latest||raw.data||raw].filter(d=>d?.id||d?.timestamp);
   if(first){for(const d of events)seen.add(String(d.id||d.timestamp));if(!isAlert)dispatch(events.length?normalize(events[0],raw):{id:'empty',username:'',snack:'Waiting for a pull',rarity:'Common',emoji:'🍬',total:raw.total||0,items:raw.items||[],leaders:raw.leaders||[]});first=false;}
   else for(const event of events.slice().reverse()){const d=normalize(event,raw);if(d.id&&!seen.has(d.id)){seen.add(d.id);update(d);}}
   if(seen.size>1000)seen=new Set([...seen].slice(-500));
  }catch(e){console.warn('[Snack Vault overlay]',e.message);}
  finally{setTimeout(fetchUpdate,poll);}
 }
 fetchUpdate();window.SnackVaultOverlay={channel,demo,api};
})();
