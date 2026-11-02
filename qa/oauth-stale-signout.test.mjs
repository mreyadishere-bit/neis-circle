import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const script = readFileSync("scripts/identity-v15.js", "utf8");
assert(script.includes("window.__NEISOAuthRecoveryFailed===true"), "Only actual failed callback should display banner");
assert(script.includes("window.__NEISOAuthRecoveryReason=''"), "Explicit logout must clear old OAuth error");
const browser=await chromium.launch({headless:true});
async function context(signedIn, failed, reason) {
  const page=await browser.newPage();
  const exceptions=[];
  page.on("pageerror",e=>exceptions.push(String(e.name)));
  // A real-origin browser document is required: about:blank denies localStorage.
  // Serve only synthetic HTML through Playwright, never reach production.
  await page.route("https://neis-auth-qa.invalid/**",route=>route.fulfill({
    status:200,contentType:"text/html",
    body:'<!DOCTYPE html><html><body><main id="authRoot"></main></body></html>'
  }));
  await page.goto("https://neis-auth-qa.invalid/");
  await page.evaluate(({signedIn,failed,reason})=>{
    window.state={lang:"en",theme:"light",identityVerification:{},onboardingComplete:true,profile:{name:"Student"}};
    window.authUser=signedIn?{id:"00000000-0000-4000-8000-000000000111"}:null;
    window.__NEISOAuthRecoveryFailed=failed;
    window.__NEISOAuthRecoveryReason=reason;
    window.loadLiveData=async()=>{};
    window.render=()=>{};
    window.signOut=async()=>{window.authUser=null};
    window.esc=x=>String(x).replaceAll("<","&lt;");
    window.applyPrefs=()=>{};
    window.toast=()=>{};
  },{signedIn,failed,reason});
  await page.addScriptTag({path:"scripts/identity-v15.js"});
  return {page,exceptions};
}
try {
  // Old failure from a previous attempt after a successful login must not appear on logout.
  {
    const {page,exceptions}=await context(true,false,"oauth_verifier_missing");
    await page.evaluate(async()=>window.signOut());
    assert.equal(await page.locator("#authRoot .form-error").count(),0,
      "Stale verifier_missing cannot reappear after signed-out screen");
    assert.equal(await page.locator("[data-auth-google]").count(),1);
    assert.deepEqual(await page.evaluate(()=>({
      failed:window.__NEISOAuthRecoveryFailed,
      reason:window.__NEISOAuthRecoveryReason
    })),{failed:false,reason:""});
    assert.deepEqual(exceptions,[]);
    await page.close();
  }
  // Real rejected callback should continue showing the useful, sanitized failure reason.
  {
    const {page,exceptions}=await context(false,true,"oauth_verifier_missing");
    await page.locator("#authRoot .form-error").waitFor();
    assert.match(await page.locator("#authRoot .form-error").innerText(),/oauth_verifier_missing/);
    assert.deepEqual(exceptions,[]);
    await page.close();
  }
  // A reset flag means a previously handled failure should not become a permanent alert.
  {
    const {page,exceptions}=await context(false,false,"oauth_verifier_missing");
    await page.locator("[data-auth-google]").waitFor();
    assert.equal(await page.locator("#authRoot .form-error").count(),0);
    assert.deepEqual(exceptions,[]);
    await page.close();
  }
  console.log("OAUTH_STALE_SIGNOUT_REGRESSION=PASS");
}finally{await browser.close()}
