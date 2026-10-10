import { chromium } from 'playwright';

const jwt=process.env.NEIS_BROWSER_TEST_TOKEN||'';
if(!/^eyJ[A-Za-z0-9_\-.]+$/.test(jwt))throw new Error('SYNTHETIC_JWT_MISSING');
const fakeId='00000000-0000-4000-8000-000000000000';
const browser=await chromium.launch({headless:true});
let failures=0;
try{
 for(const origin of ['https://neiscircle.site','https://www.neiscircle.site']){
  const context=await browser.newContext({serviceWorkers:'block'});
  const page=await context.newPage();
  const api=[];
  const headersSeen=[];
  let pageKey='';
  page.on('request',req=>{
   try{
    const u=new URL(req.url());
    if(u.hostname!=='supabase.neiscircle.site'||!u.pathname.startsWith('/rest/v1/'))return;
    const h=req.headers();
    headersSeen.push({table:u.pathname.split('/').pop(),method:req.method(),apikeyPresent:!!h.apikey,apikeyMatchesPageKey:!!pageKey&&h.apikey===pageKey,authorizationPresent:!!h.authorization,authorizationMatchesSynthetic:h.authorization==='Bearer '+jwt,authorizationIsAnon:!!pageKey&&h.authorization==='Bearer '+pageKey,headers:Object.keys(h).filter(x=>/api|authoriz|client|origin|accept|prefer|content-type|supabase/i.test(x)).sort()});
   }catch{}
  });
  page.on('response',res=>{
   try{
    const u=new URL(res.url());
    if(u.hostname!=='supabase.neiscircle.site'||!u.pathname.startsWith('/rest/v1/'))return;
    const table=u.pathname.split('/').pop();
    if(!['posts','profiles','comments','reactions'].includes(table))return;
    api.push({table,status:res.status()});
   }catch{}
  });
  page.on('requestfailed',req=>{
   try{
    const u=new URL(req.url());
    if(u.hostname==='supabase.neiscircle.site'&&u.pathname.startsWith('/rest/v1/'))
     api.push({table:u.pathname.split('/').pop(),failed:true});
   }catch{}
  });
  try{
   await page.goto(origin,{waitUntil:'domcontentloaded',timeout:30000});
   await page.waitForFunction(()=>typeof window.NEISHydrateCore==='function'&&typeof sb!=='undefined'&&!!sb?.auth?.getSession,{timeout:25000});
   pageKey=await page.evaluate(()=>window.NEIS_CONFIG?.supabaseAnonKey||'');
   console.log('BROWSER_PUBLIC_KEY_CONFIGURED='+String(!!pageKey));
   const result=await page.evaluate(async({jwt,fakeId})=>{
    const user={id:fakeId,user_metadata:{full_name:'Synthetic diagnostic'},app_metadata:{provider:'google'},aud:'authenticated'};
    const session={access_token:jwt,expires_at:Math.floor(Date.now()/1000)+100,user,token_type:'bearer'};
    sb.auth.getSession=async()=>({data:{session},error:null});
    authUser=user;
    state.onboardingComplete=true;
    state.view='home';
    state.members=[];
    state.posts=[];
    try{window.NEISProfileCache?.clear?.(fakeId)}catch{}
    let hydration=false;
    try{
     hydration=await Promise.race([
      window.NEISHydrateCore({force:true,reason:'synthetic-browser-readonly'}),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('HYDRATION_TIMEOUT')),25000))
     ]);
    }catch(e){return{status:'ERROR',errorClass:String(e?.name||'unknown').replace(/[^a-z]/gi,''),members:state.members?.length||0,posts:state.posts?.length||0}};
    return {status:hydration?'OK':'FAILED',members:state.members?.length||0,posts:state.posts?.length||0};
   },{jwt,fakeId});
   console.log('BROWSER_ORIGIN='+new URL(origin).hostname);
   console.log('BROWSER_HYDRATION='+JSON.stringify(result));
   console.log('BROWSER_REST_NETWORK='+JSON.stringify(api.slice(-18)));
   console.log('BROWSER_REST_REQUEST_HEADERS='+JSON.stringify(headersSeen.slice(-10)));
   const direct=await page.evaluate(async(jwt)=>{
    try{
     const key=sb?.supabaseKey||window.NEIS_CONFIG?.supabaseAnonKey;
     const response=await fetch('https://supabase.neiscircle.site/rest/v1/profiles?select=id&limit=1',{
      method:'GET',headers:{apikey:key,Authorization:'Bearer '+jwt,'Prefer':'count=exact'}
     });
     return {status:response.status,type:(response.headers.get('content-type')||'').split(';')[0],visible:(response.headers.get('content-range')||'').split('/').pop()||'none'};
    }catch(e){return{errorClass:String(e?.name||'unknown').replace(/[^a-z]/gi,'')}}
   },jwt);
   console.log('BROWSER_DIRECT_REST='+JSON.stringify(direct));
   if(result.members<200||result.posts<100)failures++;
  }catch(e){
   console.log('BROWSER_ORIGIN='+new URL(origin).hostname);
   console.log('BROWSER_PROBE_FAILED='+String(e?.name||'unknown').replace(/[^a-z]/gi,''));
   failures++;
  }finally{await context.close()}
 }
}finally{await browser.close()}
console.log('BROWSER_PUBLIC_DATA_HYDRATION_PASS='+String(failures===0));
if(failures)process.exitCode=1;
