import { chromium } from 'playwright';

const origins=['https://neiscircle.site','https://www.neiscircle.site'];
const browser=await chromium.launch({headless:true});
let failures=0;
try{
  for(const origin of origins){
    const context=await browser.newContext({serviceWorkers:'block'});
    const page=await context.newPage();
    const http=[],failed=[],cors=[];
    page.on('request',req=>{
      try{
        const url=new URL(req.url());
        if(url.hostname==='supabase.neiscircle.site'&&url.pathname==='/auth/v1/token')
          http.push({kind:'request',method:req.method()});
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
      const result=await page.evaluate(async()=>{
        const auth=sb.auth;
        const key=auth.storageKey+'-code-verifier';
        const verifier='abcdefghijklmnopqrstuvwxABCDEFGHIJKLMNOPQRSTUVWX0123456789-._~';
        const safeError=e=>({
          name:String(e?.name||'none').replace(/[^A-Za-z0-9_]/g,'').slice(0,50),
          code:String(e?.code||'none').replace(/[^A-Za-z0-9_]/g,'').slice(0,65),
          status:Number(e?.status)||0
        });
        let result={error:{name:'not_run',code:'none',status:0}};
        try{
          await auth.storage.setItem(key,verifier);
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
