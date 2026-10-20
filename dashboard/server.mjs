import express from 'express';
import {fileURLToPath} from 'node:url';
import session from './api/session.mjs';
import scraper from './api/scraper.mjs';
import worker from './api/worker.mjs';
const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'100kb'}));
const request=(req,path)=>({method:req.method,headers:req.headers,body:req.body,query:{path}});
app.all('/api/session',session);
app.all('/api/worker',worker);
app.all('/api/docs',(req,res)=>scraper(request(req,'docs'),res));
app.use('/api/v1',(req,res)=>scraper(request(req,req.path.slice(1)),res));
// Local development uses express.static; Vercel serves public/ through its CDN.
app.use(express.static(fileURLToPath(new URL('./public/',import.meta.url))));
app.use((error,req,res,next)=>{if(res.headersSent)return next(error);res.status(error.type==='entity.too.large'?413:500).json({message:error.type==='entity.too.large'?'Request is too large.':'The request could not be completed.'});});
export default app;
