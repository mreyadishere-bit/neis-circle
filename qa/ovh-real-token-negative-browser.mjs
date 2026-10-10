import { chromium } from 'playwright';

const origins=['https://neiscircle.site','https://www.neiscircle.site'];
const browser=await chromium.launch({headless:true});
let failures=0;
try{
  for(const origin of origins){
    let runtimeKey=null;
    const context=await browser.newContext({serviceWorkers:'block'});
    const page=await context.newPage();
    const http=[],failed=[],cors=[];
    page.on('request',req=>{
      try{
        const url=new URL(req.url());
        if(url.hostname==='supabase.neiscircle.site'&&url.pathname==='/auth/v1/token')
          {
          const headers=req.headers();
          http.push({
            kind:'request',
            method:req.method(),
            apikeyHeader:!!headers.apikey,
            authorizationHeader:!!headers.authorization,
            apikeyMatchesRuntime:!!runtimeKey&&headers.apikey===runtimeKey,
            bearerMatchesRuntime:!!runtimeKey&&headers.authorization==='Bearer '+runtimeKey
          });
        }
      }catch{}
    });
    page.on('response',res=>{
      try{
        const url=new URL(res.url());
        if(url.hostname==='supabase.neiscircle.site'&&url.pathname==='/auth/v1/token')
          http.push({kind:'response',status:res.status(),cors:res.headers()['access-control-allow-origin']||'absent'});
      }catch{}
    });
    page.on('requestfailed',req=>{
      try{
        const url=new URL(req.url());
        if(url.hostname==='supabase.neiscircle.site'&&url.pathname==='/auth/v1/token')
          failed.push((req.failure()?.errorText||'unknown').replace(/[^A-Za-z0-9_:.-]/g,'').slice(0,70));
      }catch{}
    });
    page.on('console',m=>{
      if(m.type()==='error'&&/cross.origin|cors|networkerror|failed to fetch/i.test(m.text()))
        cors.push(/cors|cross.origin/i.test(m.text())?'CORS':'FETCH');
    });
    try{
      await page.goto(origin+'/?qa=real-token-negative',{waitUntil:'domcontentloaded',timeout:35000});
      await page.waitForFunction(()=>typeof sb!=='undefined'&&!!sb?.auth?.storageKey,{timeout:18000});
      await page.waitForTimeout(1000);
      const runtime=await page.evaluate(()=>({
        hasPageConfig:!!window.NEIS_CONFIG?.supabaseAnonKey,
        keyMatchesClient:!!sb?.supabaseKey&&sb.supabaseKey===window.NEIS_CONFIG?.supabaseAnonKey,
        apiUrlMatches:sb?.supabaseUrl==='https://supabase.neiscircle.site',
        publicKey:window.NEIS_CONFIG?.supabaseAnonKey||null
      }));
      runtimeKey=runtime.publicKey;
      console.log('RUNTIME_CLIENT_EQUALS_CONFIG='+runtime.keyMatchesClient);
      console.log('RUNTIME_API_URL_MATCH='+runtime.apiUrlMatches);
      const result=await page.evaluate(async()=>{
        const auth=sb.auth;
        const key=auth.storageKey+'-code-verifier';
        // Let the actual SDK generate and store the verifier, without navigating to Google.
        const safeError=e=>({
          name:String(e?.name||'none').replace(/[^A-Za-z0-9_]/g,'').slice(0,50),
          code:String(e?.code||'none').replace(/[^A-Za-z0-9_]/g,'').slice(0,65),
          status:Number(e?.status)||0
        });
        let result={error:{name:'not_run',code:'none',status:0}};
        try{
          const started=await auth.signInWithOAuth({provider:'google',options:{
            redirectTo:location.origin+location.pathname,skipBrowserRedirect:true
          }});
          if(started?.error)throw started.error;
          const saved=await auth.storage.getItem(key);
          result.verifierStored=typeof saved==='string'&&saved.length>=43;
          const live=await Promise.race([
            auth.exchangeCodeForSession('synthetic-invalid-non-user-test-only'),
            new Promise((_,reject)=>setTimeout(()=>reject(new Error('probe_timeout')),14000))
          ]);
          result={error:safeError(live?.error),hasUser:!!live?.data?.user};
        }catch(e){result={error:safeError(e),hasUser:false}}
        finally{try{await auth.storage.removeItem(key)}catch{}}
        return result;
      });
      console.log('ORIGIN='+new URL(origin).hostname);
      console.log('VERIFIER_STORED_BY_SDK='+String(result.verifierStored===true));
      console.log('SDK_ERROR='+JSON.stringify(result.error));
      console.log('TOKEN_NETWORK='+JSON.stringify(http));
      console.log('TOKEN_REQUEST_FAILED='+JSON.stringify(failed));
      console.log('BROWSER_ERROR_CLASSES='+JSON.stringify([...new Set(cors)]));
      console.log('UNEXPECTED_SYNTHETIC_LOGIN='+!!result.hasUser);
      if(result.hasUser||http.filter(e=>e.kind==='request').length===0)failures++;
    }catch(e){
      console.log('ORIGIN='+new URL(origin).hostname);
      console.log('PROBE_FAILED_CLASS='+String(e?.name||'unknown').slice(0,40));
      failures++;
    }finally{await context.close()}
  }
}finally{await browser.close()}
console.log('REAL_TOKEN_NEGATIVE_PROBES_COMPLETED='+String(2-failures)+'/2');
if(failures)process.exitCode=1;
