import {chromium} from 'playwright';
import assert from 'node:assert/strict';

// Fake public OAuth return without a browser-local PKCE verifier.
// It must fail visibly and safely, without authenticating or leaking ?code.
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({serviceWorkers:'block'});
 const page=await context.newPage();
 let tokenRequests=0;
 page.on('request',request=>{
   try{
     const u=new URL(request.url());
     if(u.hostname==='supabase.neiscircle.site'&&u.pathname==='/auth/v1/token')tokenRequests++;
   }catch(_){}
 });
 await page.goto('https://neiscircle.site/?code=synthetic-missing-verifier-only',{waitUntil:'domcontentloaded',timeout:35000});
 await page.waitForTimeout(9000);
 const snapshot=await page.evaluate(()=>({
   loggedIn:typeof authUser!=='undefined'&&!!authUser,
   reason:String(window.__NEISOAuthRecoveryReason||''),
   pending:!!window.__NEISOAuthCallbackPending,
   urlClean:!location.search.includes('code='),
   errorVisible:!!document.querySelector('#authRoot .form-error') &&
       document.querySelector('#authRoot .form-error').textContent.includes('oauth_')
 }));
 console.log('MISSING_VERIFIER_SIGNED_IN='+snapshot.loggedIn);
 console.log('MISSING_VERIFIER_REASON_PRESENT='+/^oauth_[a-z_]+(?:_[45][0-9]{2})?$/.test(snapshot.reason));
 console.log('MISSING_VERIFIER_CODE_SCRUBBED='+snapshot.urlClean);
 console.log('MISSING_VERIFIER_ERROR_VISIBLE='+snapshot.errorVisible);
 console.log('MISSING_VERIFIER_CALLBACK_PENDING='+snapshot.pending);
 console.log('MISSING_VERIFIER_TOKEN_REQUESTS='+tokenRequests);
 assert.equal(snapshot.loggedIn,false);
 assert.match(snapshot.reason,/^oauth_[a-z_]+(?:_[45][0-9]{2})?$/);
 assert.equal(snapshot.urlClean,true);
 assert.equal(snapshot.errorVisible,true);
 assert.equal(snapshot.pending,false);
 console.log('PKCE_MISSING_VERIFIER_FAILS_SAFELY=PASS');
 await context.close();
}finally{await browser.close()}
