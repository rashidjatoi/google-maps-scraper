import test from 'node:test';import assert from 'node:assert/strict';
import handler from '../api/scraper.mjs';import sessionHandler from '../api/session.mjs';
function response(){return{statusCode:200,headers:{},headersSent:false,body:'',setHeader(k,v){this.headers[k]=v;},status(c){this.statusCode=c;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;},write(v){this.headersSent=true;this.body+=v.toString();},end(){return this;}};}
const req=(method,path,body)=>({method,query:{path},body,headers:{host:'atlas.test'}});
test('proxy validates paths, setup and authenticated access',async()=>{
  delete process.env.SCRAPER_API_URL;delete process.env.DASHBOARD_PASSWORD;
  let r=response();await handler(req('GET','https://evil.test'),r);assert.equal(r.statusCode,405);
  r=response();await handler(req('GET','jobs'),r);assert.equal(r.statusCode,503);
  process.env.SCRAPER_API_URL='https://scraper.example.com';r=response();await handler(req('GET','jobs'),r);assert.equal(r.statusCode,503);
  process.env.DASHBOARD_PASSWORD='a-long-test-password';r=response();await handler(req('GET','jobs'),r);assert.equal(r.statusCode,401);
});
test('login, forwarding, expired/tampered cookies and cross-origin protection',async()=>{
  process.env.DASHBOARD_PASSWORD='a-long-test-password';process.env.SCRAPER_API_URL='https://scraper.example.com';process.env.SCRAPER_API_TOKEN='server-only-token';
  let r=response();await sessionHandler(req('POST','',{password:'wrong'}),r);assert.equal(r.statusCode,401);
  r=response();await sessionHandler(req('POST','',{password:process.env.DASHBOARD_PASSWORD}),r);assert.equal(r.statusCode,200);const cookie=r.headers['Set-Cookie'].split(';')[0];assert.ok(r.headers['Set-Cookie'].includes('HttpOnly; Secure; SameSite=Strict'));
  const originalFetch=globalThis.fetch;let received;
  globalThis.fetch=async(url,options)=>{received={url:String(url),options};return new Response('[]',{headers:{'Content-Type':'application/json'}});};
  try{
    const request=req('POST','jobs',{name:'Berlin',keywords:['Dentists in Berlin']});request.headers.cookie=cookie;
    r=response();await handler(request,r);assert.equal(r.statusCode,200);assert.equal(received.url,'https://scraper.example.com/api/v1/jobs');assert.equal(received.options.headers.Authorization,'Bearer server-only-token');assert.equal(JSON.parse(received.options.body).name,'Berlin');
    request.headers.origin='https://evil.test';r=response();await handler(request,r);assert.equal(r.statusCode,403);
    request.headers.origin='https://atlas.test';request.headers.cookie=cookie+'tampered';r=response();await handler(request,r);assert.equal(r.statusCode,401);
    request.headers.cookie=cookie;request.body={name:'Berlin',keywords:[]};r=response();await handler(request,r);assert.equal(r.statusCode,422);
  }finally{globalThis.fetch=originalFetch;delete process.env.SCRAPER_API_TOKEN;}
});
