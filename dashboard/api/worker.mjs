import { randomUUID,timingSafeEqual } from 'node:crypto';
import { head } from '@vercel/blob';
import { updateIndex } from '../lib/store.mjs';
const equal=(a,b)=>{const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!process.env.ATLAS_WORKER_SECRET||!equal(String(req.headers.authorization||''),`Bearer ${process.env.ATLAS_WORKER_SECRET}`))return res.status(401).json({message:'Worker authentication required.'});
 if(req.method!=='POST')return res.status(405).json({message:'Method not supported.'});
 try{
  const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
  if(body?.action==='claim'){
   const lease=randomUUID(),now=Date.now();
   const job=await updateIndex(data=>{
    if(data.jobs.some(j=>j.Status==='working'&&j.LeaseUntil>now))return{unchanged:true,result:null};
    data.WorkerSeenAt=now;
    for(const j of data.jobs.filter(j=>j.Status==='working'&&j.LeaseUntil<=now)){j.Status=j.Attempts>=3?'failed':'pending';j.Error=j.Status==='failed'?'Worker stopped repeatedly. Duplicate this search to retry.':undefined;}
    const job=[...data.jobs].reverse().find(j=>j.Status==='pending');if(!job)return null;
    job.Status='working';job.Lease=lease;job.LeaseUntil=now+180000;job.Attempts=(job.Attempts||0)+1;delete job.Error;return job;
   });
   return res.status(200).json({job});
  }
  if(!['heartbeat','finish','release'].includes(body?.action)||typeof body.id!=='string'||typeof body.lease!=='string')return res.status(422).json({message:'Invalid worker action.'});
  let output;
  if(body.action==='finish'&&body.hasResults){output=`atlas/results/${body.id}/${body.lease}.csv`;await head(output);}
  const result=await updateIndex(data=>{
   const job=data.jobs.find(j=>j.ID===body.id&&j.Lease===body.lease&&j.Status==='working');
   if(!job)return{unchanged:true,result:false};
   if(body.action==='heartbeat'){data.WorkerSeenAt=Date.now();job.LeaseUntil=Date.now()+180000;return true;}
   if(body.action==='release'){job.Status='pending';delete job.Lease;delete job.LeaseUntil;return true;}
   job.Status=body.status==='ok'?'ok':'failed';job.CompletedAt=new Date().toISOString();job.ResultPath=output;
   job.Error=typeof body.error==='string'?body.error.slice(0,300):undefined;
   // Remove private proxy credentials once the worker no longer needs them.
   job.Data.proxies=[];delete job.Lease;delete job.LeaseUntil;return true;
  });
  return res.status(result?200:409).json({ok:result});
 }catch(error){console.error('Worker operation failed:',error.name);return res.status(500).json({message:'Worker operation could not be completed.'});}
}
