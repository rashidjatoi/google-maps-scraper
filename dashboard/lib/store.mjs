import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
const INDEX='atlas/workspace.json';
// Conditional writes keep independent API invocations from losing queued jobs.
export function createStore(adapter){
 async function readIndex(){const result=await adapter.get(INDEX,{access:'private',useCache:false});if(!result)return{data:{jobs:[]},etag:null};return{data:await new Response(result.stream).json(),etag:result.blob.etag};}
 async function updateIndex(change){
  for(let attempt=0;attempt<6;attempt++){
   const {data,etag}=await readIndex();const value=await change(data);
   if(value?.unchanged)return value.result;
   try{await adapter.put(INDEX,JSON.stringify(data),{access:'private',addRandomSuffix:false,allowOverwrite:Boolean(etag),ifMatch:etag||undefined,contentType:'application/json',cacheControlMaxAge:60});return value;}
   catch(error){if(!(error instanceof BlobPreconditionFailedError || ['BlobPreconditionFailedError','BlobAlreadyExistsError'].includes(error.name) || String(error.message).toLowerCase().includes('already exists'))||attempt===5)throw error;}
  }
 }
 return{readIndex,updateIndex};
}
export const {readIndex,updateIndex}=createStore({get,put});
export const cleanJob=job=>{const {Lease,LeaseUntil,ResultPath,Attempts,...publicJob}=job;return {...publicJob,Data:{...job.Data,proxies:[]}};};
