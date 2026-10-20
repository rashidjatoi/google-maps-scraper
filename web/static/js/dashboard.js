import { parseCSV, exportFile } from './exports.mjs';
const $ = id => document.getElementById(id);
const state = { jobs:[], selected:null, fields:[], rows:[], page:1, sort:false, deleteJob:null, loadToken:0, connected:false };
const statusLabels={pending:'Queued',working:'Running',ok:'Completed',failed:'Failed'};
const escapeHTML = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const pretty = field => field.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
let toastTimer;
function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,4000); }
function showError(id,message) { $(id).textContent=message; $(id).hidden=!message; }
async function request(url,options={}) {
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});
  if (response.status===401 && !$('login-dialog').open) $('login-dialog').showModal();
  if (!response.ok) {
    const text=await response.text(); let message;
    try { message=JSON.parse(text).message; } catch { message=text.length<250 && !text.includes('<') ? text : null; }
    throw new Error(message || `Request failed (${response.status}). Please try again.`);
  }
  return response;
}
async function refreshJobs() {
  $('refresh').disabled=true;
  try {
    const data=await (await request('/api/v1/jobs')).json();
    if (data!==null && !Array.isArray(data)) throw new Error('The server returned an unexpected jobs response.');
    state.jobs=(data||[]).sort((a,b)=>new Date(b.Date)-new Date(a.Date)); state.connected=true;
    $('connection').textContent='Scraper connected'; $('connection').className='connection online'; showError('error-banner',''); renderJobs();
  } catch(error) {
    state.connected=false; $('connection').textContent='Connection unavailable'; $('connection').className='connection';
    showError('error-banner',`Cannot reach your scraper. ${error.message} Your form has been kept.`);
    if (!state.jobs.length) $('jobs').innerHTML='<div class="empty-state"><span class="empty-icon">↻</span><h3>Connect your scraper</h3><p>Start the application server, then refresh to load your searches.</p></div>';
  } finally { $('refresh').disabled=false; }
}
function renderJobs() {
  const query=$('history-filter').value.toLowerCase(), status=$('status-filter').value;
  const filtered=state.jobs.filter(job=>(status==='all'||job.Status===status)&&`${job.Name} ${(job.Data?.keywords||[]).join(' ')}`.toLowerCase().includes(query));
  $('stat-total').textContent=state.jobs.length; $('stat-running').textContent=state.jobs.filter(j=>['working','pending'].includes(j.Status)).length;
  $('stat-complete').textContent=state.jobs.filter(j=>j.Status==='ok').length;
  $('nav-count').textContent=state.jobs.length; $('history-count').textContent=state.jobs.length;
  $('history-summary').textContent=`${filtered.length} of ${state.jobs.length} searches`;
  if (!filtered.length) {
    $('jobs').innerHTML=`<div class="empty-state"><span class="empty-icon">⌕</span><h3>${state.jobs.length?'No matching searches':'Your next discovery starts here'}</h3><p>${state.jobs.length?'Try another search term or status.':'Create your first search. Your business results and downloads will appear here.'}</p></div>`; return;
  }
  $('jobs').innerHTML=filtered.map(job=>{
    const known=Object.hasOwn(statusLabels,job.Status)?job.Status:'pending';
    return `<article class="job-card"><div class="job-top"><div><h3 class="job-title">${escapeHTML(job.Name)}</h3><div class="job-query">${escapeHTML((job.Data?.keywords||[]).join(' · '))}</div></div><span class="status ${known}">${statusLabels[job.Status]||'Unknown'}</span></div><div class="job-bottom"><span class="job-meta">${escapeHTML(new Date(job.Date).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}))} · ${job.Data?.keywords?.length||0} queries${job.Data?.email?' · Email search':''}</span><div class="job-actions"><button class="secondary" data-action="view" data-id="${escapeHTML(job.ID)}" ${['pending','working'].includes(job.Status)?'disabled':''}>${job.Status==='failed'?'Check results':'View results'} ↗</button><button class="icon-button" data-action="duplicate" data-id="${escapeHTML(job.ID)}" aria-label="Duplicate ${escapeHTML(job.Name)}">⧉</button><button class="icon-button" data-action="delete" data-id="${escapeHTML(job.ID)}" aria-label="Delete ${escapeHTML(job.Name)}" ${['pending','working'].includes(job.Status)?'disabled':''}>×</button></div></div></article>`;
  }).join('');
}
$('search-form').addEventListener('submit',async event=>{
  event.preventDefault(); showError('form-error','');
  const form=event.currentTarget, values=new FormData(form), lat=String(values.get('lat')).trim(),lon=String(values.get('lon')).trim();
  const keywords=[...new Set(String(values.get('keywords')).split('\n').map(s=>s.trim()).filter(Boolean))];
  if(!keywords.length) return showError('form-error','Enter at least one search query.');
  if(!String(values.get('name')).trim()) return showError('form-error','Give your search a name.');
  if((lat&&!lon)||(!lat&&lon)) return showError('form-error','Enter both latitude and longitude, or leave both empty.');
  if(values.has('fast_mode')&&(!lat||!lon)) return showError('form-error','Fast mode needs both latitude and longitude in Advanced options.');
  const proxies=String(values.get('proxies')).split('\n').map(s=>s.trim()).filter(Boolean);
  if(proxies.some(p=>{try {const u=new URL(p);return !['http:','https:','socks5:','socks5h:'].includes(u.protocol)||!u.hostname;}catch{return true;}})) return showError('form-error','Use valid HTTP, HTTPS or SOCKS5 proxy URLs, one per line.');
  const payload={name:String(values.get('name')).trim(),keywords,lang:values.get('lang'),max_time:Number(values.get('max_time')),depth:Number(values.get('depth')),zoom:Number(values.get('zoom')),radius:Number(values.get('radius')),lat,lon,email:values.has('email'),fast_mode:values.has('fast_mode'),extra_reviews:values.has('extra_reviews'),proxies};
  $('start-search').disabled=true; $('start-search').textContent='Creating search…';
  try {
    await request('/api/v1/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    // Credentials are intentionally never persisted in browser storage.
    $('proxies').value=''; toast('Search queued. We’ll update its status automatically.'); await refreshJobs();
  } catch(error) { showError('form-error',error.message); }
  finally { $('start-search').disabled=false; $('start-search').innerHTML='<span>⌕</span> Start search <span>→</span>'; }
});
document.querySelectorAll('[data-query]').forEach(button=>button.addEventListener('click',()=>{$('keywords').value=button.dataset.query;$('job-name').value=button.dataset.query;$('keywords').focus();}));
function showTab(history) {
  $('work-grid').classList.toggle('history-only',history); $('nav-history').classList.toggle('active',history);$('nav-search').classList.toggle('active',!history);
  $('page-label').textContent=history?'Search history':'Search & extract';
}
$('nav-search').onclick=()=>showTab(false);$('nav-history').onclick=()=>showTab(true);
$('refresh').onclick=refreshJobs;$('history-filter').oninput=renderJobs;$('status-filter').onchange=renderJobs;
$('jobs').addEventListener('click',event=>{
  const button=event.target.closest('button[data-action]'); if(!button) return;
  const job=state.jobs.find(j=>j.ID===button.dataset.id); if(!job) return;
  if(button.dataset.action==='view') openResults(job);
  if(button.dataset.action==='duplicate') {
    showTab(false); const form=$('search-form'); const d=job.Data||{};
    $('job-name').value=`${job.Name} (copy)`; $('keywords').value=(d.keywords||[]).join('\n');
    for(const name of ['lang','zoom','depth','radius','lat','lon']) if(d[name]!==undefined) form.elements.namedItem(name).value=d[name];
    for(const name of ['email','extra_reviews','fast_mode']) form.elements.namedItem(name).checked=Boolean(d[name]);
    const seconds=Math.round(Number(d.max_time)/1e9); // Go encodes JobData durations in nanoseconds in job responses.
    if(![...$('max-time').options].some(o=>Number(o.value)===seconds)&&seconds>=180) $('max-time').add(new Option(`${seconds} seconds`,seconds));
    $('max-time').value=String(seconds>=180?seconds:600);$('proxies').value='';$('search-panel').scrollIntoView({behavior:'smooth'});toast('Search settings copied. Review them before starting.');
  }
  if(button.dataset.action==='delete') {state.deleteJob=job;$('delete-description').textContent=`“${job.Name}” will be deleted.`;$('delete-dialog').showModal();}
});
$('cancel-delete').onclick=()=>$('delete-dialog').close();
$('confirm-delete').onclick=async()=>{
  const job=state.deleteJob;if(!job)return;$('confirm-delete').disabled=true;
  try {await request(`/api/v1/jobs/${encodeURIComponent(job.ID)}`,{method:'DELETE'});$('delete-dialog').close();if(state.selected?.ID===job.ID) closeResults();toast('Search deleted.');await refreshJobs();}
  catch(error){$('delete-dialog').close();showError('error-banner',error.message);}
  finally{$('confirm-delete').disabled=false;state.deleteJob=null;}
};
async function openResults(job) {
  const token=++state.loadToken;state.selected=job;state.rows=[];state.fields=[];state.page=1;
  $('results-panel').hidden=false;$('results-title').textContent=job.Name;$('results-subtitle').textContent='';$('results-body').replaceChildren();$('results-message').textContent='Loading your results…';$('result-count').textContent='';$('open-export').disabled=true;
  $('result-filter').value='';$('emails-only').checked=false;$('rating-filter').value='0';state.sort=false;
  $('prev-page').disabled=true;$('next-page').disabled=true;$('page-count').textContent='';
  $('results-panel').scrollIntoView({behavior:'smooth',block:'start'});
  try {
    const response=await request(`/api/v1/jobs/${encodeURIComponent(job.ID)}/download`);const parsed=parseCSV(await response.text());
    if(token!==state.loadToken)return;state.rows=parsed.rows;state.fields=parsed.fields;
    $('results-subtitle').textContent=`${state.rows.length.toLocaleString()} businesses · ${(job.Data?.keywords||[]).join(' · ')}`;
    $('results-message').textContent=state.rows.length?'':'No businesses were found in this result file. Try a broader query.';
    $('open-export').disabled=!state.rows.length;renderResults();
  } catch(error) {if(token!==state.loadToken)return;$('results-message').textContent=job.Status==='failed'?`This search failed and its results could not be loaded. ${error.message}`:error.message;}
}
function closeResults(){state.loadToken++;state.selected=null;$('results-panel').hidden=true;}
$('close-results').onclick=closeResults;
function filteredRows(){
  const query=$('result-filter').value.toLowerCase(),rating=Number($('rating-filter').value);
  let rows=state.rows.filter(row=>Object.values(row).join(' ').toLowerCase().includes(query)&&(!$('emails-only').checked||String(row.emails||'').replace(/[\[\]"\s]/g,'')!=='')&&Number(row.review_rating||0)>=rating);
  if(state.sort) rows.sort((a,b)=>Number(b.review_rating||0)-Number(a.review_rating||0));return rows;
}
function safeLink(value,label) {try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol))return '';return `<a href="${escapeHTML(u.href)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`;}catch{return '';}}
function renderResults(){
  const rows=filteredRows(),pages=Math.max(1,Math.ceil(rows.length/20));state.page=Math.min(state.page,pages);
  $('results-body').innerHTML=rows.slice((state.page-1)*20,state.page*20).map(row=>`<tr><td><strong>${escapeHTML(row.title||'Unnamed business')}</strong><small>${escapeHTML(row.category)}</small></td><td>${escapeHTML(row.phone||'—')}<br><small>${escapeHTML(row.emails||'')}</small></td><td>${escapeHTML(row.address||'—')}</td><td><span class="rating">★ ${escapeHTML(row.review_rating||'—')}</span><br><small>${escapeHTML(row.review_count||0)} reviews</small></td><td>${safeLink(row.website,'Website')}${safeLink(row.link,'Maps')}</td></tr>`).join('');
  $('result-count').textContent=`${rows.length.toLocaleString()} of ${state.rows.length.toLocaleString()} businesses`;$('page-count').textContent=`${state.page} / ${pages}`;$('prev-page').disabled=state.page<=1;$('next-page').disabled=state.page>=pages;
  $('open-export').disabled=!rows.length;
  if(state.rows.length)$('results-message').textContent=rows.length?'':'No businesses match these filters.';
}
for(const id of ['result-filter','emails-only','rating-filter']) $(id).addEventListener(id==='result-filter'?'input':'change',()=>{state.page=1;renderResults();});
$('sort-rating').onclick=()=>{state.sort=!state.sort;state.page=1;$('sort-rating').textContent=state.sort?'Rating ↓':'Rating ↕';renderResults();};
$('prev-page').onclick=()=>{state.page--;renderResults();};$('next-page').onclick=()=>{state.page++;renderResults();};
$('open-export').onclick=()=>{
  $('select-fields').textContent='Clear all';showError('export-error','');$('export-count').textContent=`Export ${filteredRows().length.toLocaleString()} matching businesses. GeoJSON omits rows without valid coordinates.`;
  $('export-fields').replaceChildren();
  state.fields.forEach(field=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=field;input.checked=true;label.append(input,document.createTextNode(pretty(field)));$('export-fields').append(label);});
  $('export-dialog').showModal();
};
$('close-export').onclick=()=>$('export-dialog').close();
$('select-fields').onclick=()=>{const inputs=[...$('export-fields').querySelectorAll('input')],all=inputs.every(i=>i.checked);inputs.forEach(i=>i.checked=!all);$('select-fields').textContent=all?'Select all':'Clear all';};
$('download').onclick=()=>{
  const fields=[...$('export-fields').querySelectorAll('input:checked')].map(i=>i.value);if(!fields.length)return showError('export-error','Select at least one field.');
  try {
    const format=$('export-format').value,blob=exportFile(format,filteredRows(),fields),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`${state.selected.Name.replace(/[^\p{L}\p{N}_-]+/gu,'-').slice(0,90)||'places'}.${format}`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);$('export-dialog').close();toast(`${format.toUpperCase()} export downloaded.`);
  }catch(error){showError('export-error',error.message);}
};
$('login-form').addEventListener('submit',async event=>{
  event.preventDefault();$('login-submit').disabled=true;showError('login-error','');
  try{await request('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('workspace-password').value})});$('workspace-password').value='';$('login-dialog').close();$('logout').hidden=false;await refreshJobs();}
  catch(error){showError('login-error',error.message);}finally{$('login-submit').disabled=false;}
});
$('logout').onclick=async()=>{try{await request('/api/session',{method:'DELETE'});state.jobs=[];state.rows=[];closeResults();renderJobs();$('logout').hidden=true;$('login-dialog').showModal();}catch(error){showError('error-banner',error.message);}};
async function start(){try{const response=await fetch('/api/session');if(response.ok){const session=await response.json();$('logout').hidden=!session.authenticated;if(session.required&&!session.authenticated){$('login-dialog').showModal();return;}}}catch{}await refreshJobs();}
start();setInterval(()=>{if(!document.hidden&&!$('login-dialog').open)refreshJobs();},5000);
