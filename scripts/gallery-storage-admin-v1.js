/* NEIS Circle — primary-admin-only live Gallery object storage total. */
(()=>{
'use strict';
if(window.__neisGalleryStorageAdminV1)return;
window.__neisGalleryStorageAdminV1=true;

const OWNER='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd';
const isOwner=()=>typeof authUser!=='undefined'&&authUser?.id===OWNER&&
  typeof state!=='undefined'&&state?.isAdmin===true;
if(typeof admin!=='function')return;

const previousAdmin=admin;
const $=key=>document.getElementById('neisGalleryStorage'+key);
const number=value=>{
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?n:0;
};
const formatBytes=value=>{
  const n=number(value);
  if(n>=1073741824)return (n/1073741824).toFixed(2)+' GiB';
  if(n>=1048576)return (n/1048576).toFixed(2)+' MiB';
  if(n>=1024)return (n/1024).toFixed(2)+' KiB';
  return Math.round(n)+' B';
};

const styles=[
'#neisGalleryStoragePanel{margin-top:18px;padding:22px!important;border:1px solid var(--line);border-radius:17px;background:var(--card);color:var(--ink)}',
'#neisGalleryStoragePanel *{box-sizing:border-box}',
'#neisGalleryStoragePanel .ngs-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:15px}',
'#neisGalleryStoragePanel h2{margin:0;font-size:18px;font-weight:750}',
'#neisGalleryStoragePanel .ngs-muted{font-size:12px;color:var(--muted);line-height:1.6;margin:5px 0}',
'#neisGalleryStoragePanel .ngs-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap}',
'#neisGalleryStoragePanel .ngs-status{font-size:12px;color:var(--muted)}',
'#neisGalleryStoragePanel button{background:var(--card);border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:8px 12px;font-size:12px;cursor:pointer}',
'#neisGalleryStoragePanel button:disabled{opacity:.5;cursor:default}',
'#neisGalleryStoragePanel .ngs-main{background:var(--soft);border:1px solid var(--line);border-radius:13px;padding:19px;min-width:0}',
'#neisGalleryStoragePanel .ngs-label{font-size:12px;color:var(--muted)}',
'#neisGalleryStoragePanel .ngs-value{font-size:clamp(27px,4vw,36px);font-weight:800;line-height:1.25;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;margin:5px 0}',
'#neisGalleryStoragePanel .ngs-meta{display:flex;gap:24px;flex-wrap:wrap;margin-top:13px}',
'#neisGalleryStoragePanel .ngs-meta b{display:block;font-size:16px;font-variant-numeric:tabular-nums}',
'#neisGalleryStoragePanel .ngs-warning{margin-top:12px;padding:10px 12px;border:1px solid #d49a41;border-radius:10px;background:rgba(212,154,65,.08);font-size:12px;line-height:1.6}',
'#neisGalleryStoragePanel .ngs-foot{margin:12px 0 0;font-size:11px;color:var(--muted);line-height:1.6}',
'@media(max-width:520px){#neisGalleryStoragePanel{padding:15px!important}#neisGalleryStoragePanel .ngs-main{padding:15px}#neisGalleryStoragePanel .ngs-meta{gap:16px}}'
].join('');

const markup='<style>'+styles+'</style>'+
'<section id="neisGalleryStoragePanel" class="module-card" aria-label="Gallery file storage usage">'+
'<header class="ngs-head"><div><h2>Gallery Storage</h2>'+
'<p class="ngs-muted">Actual uploaded image files · OVH Storage · Main Admin only</p></div>'+
'<div class="ngs-actions"><span id="neisGalleryStorageStatus" class="ngs-status" role="status">Connecting…</span>'+
'<button type="button" id="neisGalleryStorageRefresh">Refresh</button></div></header>'+
'<div class="ngs-main"><div class="ngs-label">Total Gallery storage (Photograph + Art combined)</div>'+
'<div id="neisGalleryStorageTotal" class="ngs-value" aria-live="polite">—</div>'+
'<div id="neisGalleryStorageExact" class="ngs-muted">Reading actual file sizes…</div>'+
'<div class="ngs-meta"><div><b id="neisGalleryStorageFiles">—</b><span class="ngs-muted">Files in Gallery storage</span></div>'+
'<div><b id="neisGalleryStorageMeasured">—</b><span class="ngs-muted">Files with readable sizes</span></div></div></div>'+
'<div id="neisGalleryStorageWarning" class="ngs-warning" hidden></div>'+
'<p class="ngs-foot">Measured from the actual objects in the existing community-media bucket under users’ /gallery/ folders. This is separate from PostgreSQL database size and is not added to the VPS disk figure.</p>'+
'<p id="neisGalleryStorageUpdated" class="ngs-muted">Refreshes automatically every 60 seconds.</p></section>';

let loading=false,queued=false,lastRoot=null,lastFetch=0,requestNo=0;
admin=function(){
  const html=previousAdmin.apply(this,arguments);
  if(!isOwner())return html;
  queueMicrotask(()=>{if(state?.view==='admin')void load()});
  return html+markup;
};

function set(key,value){
  const node=$(key);
  if(node)node.textContent=String(value);
}
function render(data,root){
  if(!isOwner()||!root?.isConnected||root!==document.getElementById('neisGalleryStoragePanel'))return;
  const total=number(data?.total_bytes);
  const count=number(data?.object_count);
  const measured=number(data?.measured_object_count);
  const unmeasured=number(data?.unmeasured_object_count);
  set('Total',formatBytes(total));
  set('Exact',Math.round(total).toLocaleString()+' bytes counted from Storage metadata');
  set('Files',count.toLocaleString());
  set('Measured',measured.toLocaleString());
  const warning=$('Warning');
  if(warning){
    warning.hidden=unmeasured===0;
    warning.textContent=unmeasured.toLocaleString()+
      ' file(s) do not have a readable size in Storage metadata. The displayed total excludes those files.';
  }
  const checked=new Date(data?.checked_at||Date.now());
  set('Updated','Last checked: '+(Number.isFinite(checked.getTime())?checked.toLocaleString():'now')+
    ' · Automatically refreshes every 60 seconds.');
  set('Status','● Live');
}
async function load(force=false){
  const root=$('Panel');
  if(!root||!isOwner()||typeof sb==='undefined'||!sb)return;
  if(loading){queued=true;return}
  if(!force&&root===lastRoot&&Date.now()-lastFetch<45000)return;
  loading=true;lastRoot=root;
  const current=++requestNo;
  set('Status','● Loading…');
  const button=$('Refresh');if(button)button.disabled=true;
  try{
    const response=await sb.rpc('main_admin_gallery_storage');
    if(response.error)throw response.error;
    if(!response.data||response.data.total_bytes==null)throw new Error('Storage returned no total.');
    if(root.isConnected&&root===$('Panel')&&current===requestNo)render(response.data,root);
  }catch(error){
    if(root.isConnected&&root===$('Panel')){
      set('Status','● Unavailable');
      set('Updated','Could not load Gallery storage: '+String(error?.message||'Try again.').slice(0,180));
    }
  }finally{
    loading=false;lastFetch=Date.now();
    if(button&&button.isConnected)button.disabled=false;
    if(queued){queued=false;void load(true)}
  }
}
document.addEventListener('click',event=>{
  if(!isOwner()||event.target?.closest?.('#neisGalleryStorageRefresh')==null)return;
  void load(true);
});
setInterval(()=>{
  if(typeof state!=='undefined'&&state.view==='admin')void load(true);
},60000);
})();
