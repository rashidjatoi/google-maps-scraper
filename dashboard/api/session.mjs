import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const equal = (a,b) => { const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right); };
const sign = value => createHmac('sha256',process.env.DASHBOARD_PASSWORD).update(value).digest('base64url');
export function authenticated(req) {
  if(!process.env.DASHBOARD_PASSWORD)return false;
  const cookie=String(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith('atlas_session='))?.slice(14);
  if(!cookie)return false;
  const [expires,nonce,signature]=cookie.split('.');
  return Boolean(expires&&nonce&&signature&&Number(expires)>Date.now()&&equal(signature,sign(`${expires}.${nonce}`)));
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method==='GET')return res.status(200).json({required:Boolean(process.env.DASHBOARD_PASSWORD),authenticated:authenticated(req)});
  if(!['POST','DELETE'].includes(req.method))return res.status(405).json({message:'Method not allowed.'});
  if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return res.status(403).json({message:'Cross-origin requests are not allowed.'});}catch{return res.status(403).json({message:'Invalid origin.'});}}
  if(req.method==='DELETE'){res.setHeader('Set-Cookie','atlas_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');return res.status(200).json({ok:true});}
  if(!process.env.DASHBOARD_PASSWORD)return res.status(503).json({message:'Set DASHBOARD_PASSWORD in Vercel before connecting your scraper.'});
  let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{return res.status(400).json({message:'Invalid request.'});}
  const password=String(body?.password||'');
  if(password.length>512||!equal(password,process.env.DASHBOARD_PASSWORD))return res.status(401).json({message:'The workspace password is incorrect.'});
  const value=`${Date.now()+12*60*60*1000}.${randomBytes(16).toString('base64url')}`;
  res.setHeader('Set-Cookie',`atlas_session=${value}.${sign(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`);
  return res.status(200).json({ok:true});
}
