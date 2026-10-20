import { authenticated } from './session.mjs';
import cloudJobs from '../lib/cloud-jobs.mjs';
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const item = new RegExp(`^jobs/${UUID}$`);
const download = new RegExp(`^jobs/${UUID}/download$`);
const allowed = (path, method) => path === 'jobs' ? ['GET', 'POST'].includes(method) : item.test(path) ? ['GET', 'DELETE'].includes(method) : download.test(path) && method === 'GET';
const json = (res, status, message) => res.status(status).json({ message });
// Requests only reach the configured scraper origin; callers cannot choose a URL.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const path = typeof req.query?.path === 'string' ? req.query.path : '';
  if(path === 'docs' && req.method === 'GET') {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    return res.status(200).send('<!doctype html><html lang="en"><meta charset="utf-8"><title>Atlas API</title><h1>Atlas job API</h1><p>Same-origin API proxy connected to your scraper server.</p><ul><li>GET /api/v1/jobs — list searches</li><li>POST /api/v1/jobs — create search</li><li>GET /api/v1/jobs/{id} — search details</li><li>DELETE /api/v1/jobs/{id} — delete search</li><li>GET /api/v1/jobs/{id}/download — results as CSV</li></ul><p>CSV, Excel, JSON, TSV, and GeoJSON exports are generated locally by the dashboard.</p><a href="/">Back to dashboard</a></html>');
  }
  if (!allowed(path, req.method)) return json(res, 405, 'This API route or method is not supported.');
  if (process.env.ATLAS_BACKEND === 'vercel') {
    if (!process.env.DASHBOARD_PASSWORD) return json(res,503,'Set a workspace password to enable searches.');
    if (!authenticated(req)) return json(res,401,'Sign in to your workspace to continue.');
    if (['POST','DELETE'].includes(req.method) && req.headers.origin) {
      try {if(new URL(req.headers.origin).host!==req.headers.host)return json(res,403,'Cross-origin requests are not allowed.');}catch{return json(res,403,'Invalid request origin.');}
    }
    return cloudJobs(req,res,path);
  }
  if (!process.env.SCRAPER_API_URL) return json(res, 503, 'Backend not configured. Add SCRAPER_API_URL in Vercel project settings and redeploy.');
  if (!process.env.DASHBOARD_PASSWORD) return json(res,503,'Set DASHBOARD_PASSWORD in Vercel to protect your workspace before using the scraper.');
  if (!authenticated(req)) return json(res,401,'Sign in to your workspace to continue.');
  let origin;
  try { origin = new URL(process.env.SCRAPER_API_URL); if (!['http:','https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash) throw new Error(); }
  catch { return json(res, 503, 'The backend URL is invalid. Set SCRAPER_API_URL to your scraper server origin.'); }
  // Prevent other sites from using an authenticated proxy to create or delete jobs.
  if (['POST','DELETE'].includes(req.method) && req.headers.origin) {
    try { const requestOrigin=new URL(req.headers.origin);if(requestOrigin.host!==req.headers.host) return json(res,403,'Cross-origin requests are not allowed.'); }
    catch { return json(res,403,'Invalid request origin.'); }
  }
  const headers = { Accept: download.test(path) ? 'text/csv' : 'application/json' };
  if (process.env.SCRAPER_API_TOKEN) headers.Authorization = `Bearer ${process.env.SCRAPER_API_TOKEN}`;
  let body;
  if(req.method==='POST') {
    headers['Content-Type']='application/json';
    try { const data=typeof req.body==='string'?JSON.parse(req.body):req.body;
      if(!data || !Array.isArray(data.keywords) || !data.keywords.length || !String(data.name||'').trim()) return json(res,422,'Enter a search name and at least one query.');
      if(data.keywords.length>100 || data.keywords.some(k=>typeof k!=='string'||k.length>2000)) return json(res,422,'Use at most 100 queries, each up to 2,000 characters.');
      body=JSON.stringify(data);if(body.length>100000) return json(res,413,'Search settings are too large.');
    }catch { return json(res,422,'Invalid search JSON.'); }
  }
  try {
    const response = await fetch(new URL(`/api/v1/${path}`,origin),{method:req.method,headers,body,redirect:'error',signal:AbortSignal.timeout(25000)});
    res.status(response.status);
    res.setHeader('Content-Type',response.headers.get('content-type')||'application/json');
    if(response.headers.has('content-disposition'))res.setHeader('Content-Disposition',response.headers.get('content-disposition'));
    // Forward chunks rather than buffering large CSV results in the function.
    if(response.body) for await (const chunk of response.body) res.write(Buffer.from(chunk));
    return res.end();
  } catch(error) {
    if(res.headersSent) return res.end();
    return json(res,error.name==='TimeoutError'?504:502,'Unable to reach the scraper backend. Check its URL, access token, and server status.');
  }
}
