import { spawn } from 'node:child_process';
import { mkdtemp,writeFile,stat,rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { put } from '@vercel/blob';
const origin=process.env.ATLAS_APP_URL,secret=process.env.ATLAS_WORKER_SECRET;
if(!origin||!secret)throw Error('Worker configuration is missing.');
let stopping=false,current=null;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(body){const response=await fetch(new URL('/api/worker',origin),{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error(`Worker API returned ${response.status}`);return response.json();}
process.on('SIGTERM',()=>{stopping=true;current?.kill('SIGTERM');});process.on('SIGINT',()=>{stopping=true;current?.kill('SIGTERM');});
async function run(job){
 const folder=await mkdtemp(join(tmpdir(),'atlas-')),input=join(folder,'queries.txt'),output=join(folder,'results.csv');
 let heartbeat,timeout,killTimer;const d=job.Data;
 try{
  await writeFile(input,d.keywords.join('\n'),{mode:0o600});
  const args=['-input',input,'-results',output,'-lang',d.lang,'-depth',String(d.depth),'-c','1','-zoom',String(d.zoom),'-radius',String(d.radius),'-exit-on-inactivity','30s'];
  if(d.lat&&d.lon)args.push('-geo',`${d.lat},${d.lon}`);
  if(d.email)args.push('-email');if(d.extra_reviews)args.push('-extra-reviews');if(d.fast_mode)args.push('-fast-mode');
  if(d.proxies?.length){const proxyFile=join(folder,'proxies.txt');await writeFile(proxyFile,d.proxies.join('\n'),{mode:0o600});args.push('-proxies-file',proxyFile);}
  console.log(`Starting search ${job.ID}`);
  let timedOut=false,leaseLost=false,diagnostic='';
  const exit=await new Promise((resolve,reject)=>{
   current=spawn('google-maps-scraper',args,{env:{...process.env,DISABLE_TELEMETRY:'1'},stdio:['ignore','ignore','pipe']});
   current.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk.toString()).slice(-4000);});
   heartbeat=setInterval(async()=>{try{await api({action:'heartbeat',id:job.ID,lease:job.Lease});}catch{leaseLost=true;current?.kill('SIGTERM');}},30000);
   timeout=setTimeout(()=>{timedOut=true;current?.kill('SIGTERM');killTimer=setTimeout(()=>current?.kill('SIGKILL'),10000);},d.max_time/1e6);
   current.once('error',reject);current.once('exit',(code,signal)=>resolve({code,signal}));
  });
  if(stopping){await api({action:'release',id:job.ID,lease:job.Lease});return;}
  if(exit.code!==0){console.error(`Scraper exit code ${exit.code}, signal ${exit.signal}`);console.error(diagnostic.replace(/(https?:\/\/)[^\s@]+@/g,'$1[redacted]@'));}
  if(leaseLost)throw Error('Worker lease was lost.');
  let hasResults=false;try{hasResults=(await stat(output)).size>0;}catch{}
  if(hasResults)await put(`atlas/results/${job.ID}/${job.Lease}.csv`,createReadStream(output),{access:'private',addRandomSuffix:false,allowOverwrite:true,multipart:true,contentType:'text/csv'});
  await api({action:'finish',id:job.ID,lease:job.Lease,status:exit.code===0&&!timedOut?'ok':'failed',hasResults,error:timedOut?'Search reached its time limit. Partial results may be available.':exit.code!==0?'Scraper did not finish successfully. Try a smaller search or a proxy.':undefined});
  console.log(`Finished search ${job.ID}`);
 }catch(error){console.error(`Search ${job.ID} failed: ${error.message}`);try{await api({action:'finish',id:job.ID,lease:job.Lease,status:'failed',hasResults:false,error:'The worker could not complete this search. Duplicate it to retry.'});}catch{}}
 finally{clearInterval(heartbeat);clearTimeout(timeout);clearTimeout(killTimer);current=null;await rm(folder,{recursive:true,force:true});}
}
console.log('Atlas scraper worker is ready.');
while(!stopping){try{const {job}=await api({action:'claim'});if(job){await run(job);continue;}}catch(error){console.error(error.message);}for(let i=0;i<60&&!stopping;i++)await wait(1000);}
