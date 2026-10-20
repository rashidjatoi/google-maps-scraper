import test from 'node:test';import assert from 'node:assert/strict';
import {BlobPreconditionFailedError} from '@vercel/blob';
import {createStore,cleanJob} from '../lib/store.mjs';import {parseSettings} from '../lib/cloud-jobs.mjs';
test('concurrent queue updates retry conditional writes without losing jobs',async()=>{
 let content=null,version=0,conflicts=0;
 const storage=createStore({get:async()=>content===null?null:{stream:new Blob([content]).stream(),blob:{etag:String(version)}},put:async(path,value,options)=>{
  if(content!==null&&options.ifMatch!==String(version)){conflicts++;throw new BlobPreconditionFailedError();}
  content=value;version++;
 }});
 await Promise.all(['first','second','third'].map(ID=>storage.updateIndex(data=>{data.jobs.push({ID});return ID;})));
 const result=await storage.readIndex();assert.deepEqual(result.data.jobs.map(j=>j.ID).sort(),['first','second','third']);assert.ok(conflicts>0);
});
test('public job responses omit private worker state and proxy credentials',()=>{
 const result=cleanJob({ID:'one',Lease:'secret',LeaseUntil:1,ResultPath:'private.csv',Attempts:1,Data:{keywords:['coffee'],proxies:['http://user:password@proxy.test']}});
 assert.equal(result.Lease,undefined);assert.equal(result.ResultPath,undefined);assert.deepEqual(result.Data.proxies,[]);
});
test('cloud search settings enforce coordinates, duration and queue-size bounds',()=>{
 const input={name:'Berlin',keywords:['Dentists in Berlin'],lang:'en',depth:1,zoom:15,radius:1000,max_time:180};
 assert.equal(parseSettings(input).data.max_time,180e9);
 assert.throws(()=>parseSettings({...input,fast_mode:true}),/coordinates/);
 assert.throws(()=>parseSettings({...input,max_time:99999}),/between/);
 assert.throws(()=>parseSettings({...input,keywords:Array(11).fill('coffee')}),/1–10/);
 assert.throws(()=>parseSettings({...input,proxies:['file:///etc/passwd']}),/proxy/);
});
