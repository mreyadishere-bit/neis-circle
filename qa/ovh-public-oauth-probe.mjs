import {chromium} from 'playwright';
const b64=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt=[b64({alg:'HS256',typ:'JWT'}),b64({iss:'https://supabase.neiscircle.site/auth/v1',aud:'authenticated',role:'authenticated',sub:'00000000-0000-4000-8000-000000000001',iat:1791640000,exp:1891640000}),b64({fake:true})].join('.');
const pageUrl='https://neiscircle.site/#access_token='+jwt+'&refresh_token=invalid-test-only&expires_in=3600&token_type=bearer';
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({serviceWorkers:'block'});
 const page=await context.newPage();
 const reqEvents=[];
 const errors=[];
 const checks=[];
 page.on('request',req=>{
  const url=new URL(req.url());
  if(url.hostname==='supabase.neiscircle.site'&&url.pathname.startsWith('/auth/v1/'))reqEvents.push('REQUEST_'+url.pathname.split('/').slice(0,5).join('/')+'_'+req.method());
 });
 page.on('response',res=>{
  const url=new URL(res.url());
  if(url.hostname==='supabase.neiscircle.site'&&url.pathname.startsWith('/auth/v1/'))reqEvents.push('RESPONSE_'+url.pathname.split('/').slice(0,5).join('/')+'_'+res.status());
 });
 page.on('pageerror',e=>{errors.push((e.name||'Error').slice(0,32))});
 const t=Date.now();
 await page.goto(pageUrl,{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForTimeout(18000);
 const p=await page.evaluate(()=>({
  pending:!!window.__NEISOAuthCallbackPending,
  failed:!!window.__NEISOAuthRecoveryFailed,
  reason:typeof window.__NEISOAuthRecoveryReason==='string'?window.__NEISOAuthRecoveryReason:'NONE',
  hasTokensInUrl:location.hash.includes('access_token='),
  authScreen:!!document.querySelector('[data-auth-google]'),
  loginPrompt:document.querySelector('#authRoot')?.textContent?.includes('Google sign-in could not be completed')||false,
  sbAvailable:typeof sb!=='undefined'&&!!sb,
  stateUser:typeof authUser!=='undefined'&&!!authUser,
  sdkLoaded:typeof window.supabase?.createClient==='function'
 }));
 console.log('PROBE_DURATION_SECONDS='+((Date.now()-t)/1000).toFixed(1));
 console.log('PROBE_SDK_LOADED='+p.sdkLoaded);
 console.log('PROBE_CLIENT_AVAILABLE='+p.sbAvailable);
 console.log('PROBE_CALLBACK_PENDING='+p.pending);
 console.log('PROBE_SESSION_FAILED='+p.failed);
 console.log('PROBE_REASON='+p.reason.replace(/[^a-z0-9_]/g,'').slice(0,80));
 console.log('PROBE_URL_TOKENS_SCRUBBED='+!p.hasTokensInUrl);
 console.log('PROBE_AUTH_SCREEN='+p.authScreen);
 console.log('PROBE_LOGIN_PROMPT='+p.loginPrompt);
 console.log('PROBE_NETWORK_PATHS='+[...new Set(reqEvents)].join(','));
 console.log('PROBE_PAGE_ERROR_TYPES='+[...new Set(errors)].join(','));
 // A fake token MUST NOT authenticate a user
 if(p.stateUser)throw new Error('Synthetic invalid token unexpectedly authenticated');
 await context.close();
} finally {await browser.close()}
