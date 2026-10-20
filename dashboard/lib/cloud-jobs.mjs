import { randomUUID } from 'node:crypto';
import { del, get } from '@vercel/blob';
import { readIndex,updateIndex,cleanJob } from './store.mjs';
const send=(res,status,message)=>res.status(status).json({message});
function parseSettings(body){
 const d=typeof body==='string'?JSON.parse(body):body;
 if(!d||typeof d.name!=='string'||!d.name.trim()||d.name.length>160)throw Error('Enter a search name of up to 160 characters.');
 if(!Array.isArray(d.keywords)||!d.keywords.length||d.keywords.length>10||d.keywords.some(k=>typeof k!=='string'||!k.trim()||k.length>1000))throw Error('Enter 1–10 queries, each up to 1,000 characters.');
 if(!/^[a-z]{2}$/.test(d.lang))throw Error('Select a two-letter results language.');
 const ranges={depth:[1,50],zoom:[1,21],radius:[1,500000],max_time:[180,3600]};
 for(const [key,[min,max]] of Object.entries(ranges))if(!Number.isInteger(d[key])||d[key]<min||d[key]>max)throw Error(`${key.replace('_',' ')} must be between ${min} and ${max}.`);
 const lat=String(d.lat??'').trim(),lon=String(d.lon??'').trim();
 if(Boolean(lat)!==Boolean(lon)||d.fast_mode&&(!lat||!lon))throw Error('Enter both coordinates for a location or fast-mode search.');
 if(lat&&(!Number.isFinite(Number(lat))||Math.abs(Number(lat))>90||!Number.isFinite(Number(lon))||Math.abs(Number(lon))>180))throw Error('Invalid latitude or longitude.');
 const proxies=d.proxies||[];if(!Array.isArray(proxies)||proxies.length>20||proxies.some(p=>{if(typeof p!=='string'||p.length>2048)return true;try{const u=new URL(p);return !['http:','https:','socks5:','socks5h:'].includes(u.protocol)||!u.hostname;}catch{return true;}}))throw Error('Use up to 20 valid HTTP or SOCKS5 proxy URLs.');
 return{name:d.name.trim(),data:{keywords:[...new Set(d.keywords.map(k=>k.trim()))],lang:d.lang,depth:d.depth,zoom:d.zoom,radius:d.radius,max_time:d.max_time*1e9,lat,lon,email:Boolean(d.email),extra_reviews:Boolean(d.extra_reviews),fast_mode:Boolean(d.fast_mode),proxies}};
}
export { parseSettings };
export default async function cloudJobs(req,res,path){
 try{
  if(path==='jobs'&&req.method==='GET'){const {data}=await readIndex();res.setHeader('X-Atlas-Worker-Status',Date.now()-Number(data.WorkerSeenAt||0)<180000?'ready':'unavailable');return res.status(200).json(data.jobs.map(cleanJob));}
  if(path==='jobs'&&req.method==='POST'){
   let input;try{input=parseSettings(req.body);}catch(error){return send(res,422,error.message);}
   const job={ID:randomUUID(),Name:input.name,Date:new Date().toISOString(),Status:'pending',Data:input.data,Attempts:0};
   const created=await updateIndex(data=>{if(data.jobs.filter(j=>['pending','working'].includes(j.Status)).length>=10)throw Error('The queue is full. Wait for existing searches to finish.');if(data.jobs.length>=200)throw Error('Workspace limit reached. Delete old searches before creating more.');data.jobs.unshift(job);return job;});
   return res.status(201).json({id:created.ID});
  }
  const id=path.split('/')[1],{data}=await readIndex(),job=data.jobs.find(j=>j.ID===id);
  if(!job)return send(res,404,'Search not found.');
  if(path.endsWith('/download')){
   if(!job.ResultPath)return send(res,404,job.Error||'No result file yet. Wait for the search to complete.');
   const result=await get(job.ResultPath,{access:'private',useCache:false});if(!result)return send(res,404,'The result file is unavailable.');
   res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${id}.csv"`);res.status(200);
   for await(const chunk of result.stream)res.write(Buffer.from(chunk));return res.end();
  }
  if(req.method==='GET')return res.status(200).json(cleanJob(job));
  if(req.method==='DELETE'){
   const removed=await updateIndex(data=>{const current=data.jobs.find(j=>j.ID===id);if(!current)return{unchanged:true,result:null};if(['pending','working'].includes(current.Status))throw Error('Active searches cannot be deleted.');data.jobs=data.jobs.filter(j=>j.ID!==id);return current;});
   if(removed?.ResultPath)await del(removed.ResultPath);return res.status(200).json({ok:true});
  }
  return send(res,405,'Method not supported.');
 }catch(error){console.error('Cloud job operation failed:',error.name);if(res.headersSent)return res.end();return send(res,500,['The queue is full. Wait for existing searches to finish.','Workspace limit reached. Delete old searches before creating more.','Active searches cannot be deleted.'].includes(error.message)?error.message:'Unable to read or update workspace storage. Please retry.');}
}
