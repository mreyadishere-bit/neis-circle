import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const origin = 'https://neiscircle.site';
const now = Math.floor(Date.now() / 1000);
const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt = [b64({alg:'HS256',typ:'JWT'}),b64({
  aud:'authenticated',role:'authenticated',iat:now,exp:now+3600,
  sub:'00000000-0000-4000-8000-000000000111',iss:'https://supabase.neiscircle.site/auth/v1'
}),b64({synthetic:true})].join('.');
const fakeUser = {
  id:'00000000-0000-4000-8000-000000000111',aud:'authenticated',role:'authenticated',
  email:'pkce-synthetic@invalid.example',app_metadata:{provider:'google',providers:['google']},
  user_metadata:{full_name:'Synthetic PKCE'},created_at:'2026-10-10T00:00:00.000Z'
};
const fakeResponse = {access_token:jwt,token_type:'bearer',expires_in:3600,
  expires_at:now+3600,refresh_token:'synthetic-neis-nonreal-refresh',user:fakeUser};
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({serviceWorkers:'block'});
  const page=await context.newPage();
  const stats={authorize:0,exchange:0,badUrls:0};
  const errors=[];
  page.on('pageerror',e=>errors.push((e.name||'Error').slice(0,32)));
  await page.route('**/auth/v1/authorize**',async route=>{
    const u=new URL(route.request().url());
    if(!u.searchParams.get('code_challenge')||
       u.searchParams.get('code_challenge_method')!=='S256'||
       u.searchParams.get('provider')!=='google'){
      stats.badUrls++;throw new Error('Missing PKCE code challenge in Google authorize redirect');
    }
    stats.authorize++;
    await route.fulfill({status:302,headers:{location:origin+'/?code=synthetic-neis-pkce-code'}});
  });
  await page.route('**/auth/v1/token**',async route=>{
    const request=route.request();
    const u=new URL(request.url());
    if(u.searchParams.get('grant_type')!=='pkce') {
      stats.badUrls++;
      return route.fulfill({status:400,contentType:'application/json',body:'{"error":"invalid_grant"}'});
    }
    const post=request.postDataJSON();
    if(post.auth_code!=='synthetic-neis-pkce-code'||typeof post.code_verifier!=='string'||post.code_verifier.length<30) {
      stats.badUrls++;
      throw new Error('Missing PKCE code verifier or mismatched authorization code');
    }
    stats.exchange++;
    await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin},body:JSON.stringify(fakeResponse)});
  });
  await page.route('**/auth/v1/user',async route=>{
    await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin},body:JSON.stringify(fakeUser)});
  });
  // Fake user must never mutate real production data.
  await page.route(/https:\/\/supabase\.neiscircle\.site\/(rest|functions|storage)\/v1\//,async route=>{
    await route.fulfill({status:403,contentType:'application/json',body:'{"message":"Synthetic test: writes blocked"}'});
  });
  await page.goto(origin+'/?qa=pkce-20261010',{waitUntil:'domcontentloaded',timeout:35000});
  const button=page.locator('[data-auth-google]').first();
  await button.waitFor({state:'visible',timeout:20000});
  await button.click();
  await page.waitForTimeout(13000);
  const snapshot=await page.evaluate(()=>({
    signedIn:typeof authUser!=='undefined'&&authUser?.id==='00000000-0000-4000-8000-000000000111',
    client:typeof sb!=='undefined'&&!!sb,
    urlCleared:!location.search.includes('code=')&&!location.hash.includes('access_token'),
    pending:!!window.__NEISOAuthCallbackPending
  }));
  console.log('PKCE_AUTHORIZE_REQUEST_COUNT='+stats.authorize);
  console.log('PKCE_CODE_EXCHANGE_COUNT='+stats.exchange);
  console.log('PKCE_BAD_REQUEST_COUNT='+stats.badUrls);
  console.log('PKCE_SYNTHETIC_SESSION_ACCEPTED='+snapshot.signedIn);
  console.log('PKCE_CALLBACK_URL_CLEAN='+snapshot.urlCleared);
  console.log('PKCE_CALLBACK_PENDING='+snapshot.pending);
  console.log('PKCE_BROWSER_ERROR_TYPES='+[...new Set(errors)].join(','));
  assert.equal(stats.authorize,1,'Google OAuth must use one PKCE authorization');
  assert.equal(stats.exchange,1,'Google OAuth code must exchange exactly once');
  assert.equal(stats.badUrls,0,'No malformed PKCE requests');
  assert.equal(snapshot.signedIn,true,'Application must accept a PKCE session');
  assert.equal(snapshot.urlCleared,true,'Authorization code must be removed from URL');
  assert.equal(snapshot.pending,false,'Callback state must complete');
  assert.equal(errors.length,0,'Uncaught JS errors');
  console.log('PKCE_BROWSER_INTEGRATION=PASS_SYNTHETIC_ONLY');
  await context.close();
}finally{
  await browser.close();
}
