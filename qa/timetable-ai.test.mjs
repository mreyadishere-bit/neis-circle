import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const FRONT = "scripts/timetable-ai-v1.js";
const EDGE = "supabase/functions/timetable-ai/index.ts";
const source = readFileSync(FRONT, "utf8");
const freePlanQuota = readFileSync("supabase/migrations/20261102100000_timetable_ai_quota.sql","utf8");
assert(freePlanQuota.includes("timetable_ai_global_usage"),"Project-wide free-plan limit must exist");
assert(freePlanQuota.includes("global_daily >= 600"),"Global daily cap must be below free-plan 1000 RPD");
assert(freePlanQuota.includes("global_minute >= 15"),"Global minute cap must be below free-plan 30 RPM");
assert(freePlanQuota.includes("usage.requests < 25"),"Per-user limit required");
const server = readFileSync(EDGE, "utf8");
assert(!/GROQ_API_KEY/.test(source), "API key must never be in the browser script");
for (const required of ["sb.functions.invoke", "apply_timetable_ai_plan", "stateAI.history", "stateAI.source",
  "diff()", "window.confirm", "file.size>5*1024*1024"]) {
  assert(source.includes(required), "Missing timetable AI invariant: "+required);
}
for (const required of ["client.auth.getUser", "consume_timetable_ai_quota", "outputSchema",
  "MAX_FILE_BYTES", "GROQ_API_KEY"]) {
  assert(server.includes(required), "Missing server protection: "+required);
}

const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage({viewport:{width:420,height:850}});
  await page.setContent('<!doctype html><html><body><main id="view">'+
    '<section class="tt-head"><div class="tt-head-actions">'+
    '<button class="primary">Add class</button></div></section></main></body></html>');
  await page.evaluate(()=>{
    window.state={lang:"en",view:"timetable",onboardingComplete:true,timetable:{ready:true,rows:[]}};
    window.authUser={id:"73d87dc8-150e-4d73-bf3a-249a661635ff"};
    window.__calls=[];
    window.__saves=[];
    window.toast=()=>{};
    window.render=()=>{
      document.querySelector("#view").innerHTML='<section class="tt-head"><div class="tt-head-actions">'+
        '<button class="primary">Add class</button></div></section>';
    };
    window.sb={
      functions:{invoke:async(name,{body})=>{
        window.__calls.push({name,body});
        const msg=(body.message||"").toLowerCase();
        const course={key:"",title:"Physics",day_of_week:1,start_time:"09:00",
          end_time:"10:00",location:"School",notes:"",category:"Class"};
        if(body.images?.length)return {data:{reply:"I found Physics and Chemistry. Which do you take?",
          changed:false,entries:body.draft,extracted:[course,{...course,title:"Chemistry",start_time:"10:00",end_time:"11:00"}]},error:null};
        if(msg.includes("cancel"))return {data:{reply:"Okay, canceled.",changed:true,
          entries:[],extracted:body.source},error:null};
        return {data:{reply:"Added Physics to your draft.",changed:true,
          entries:[course],extracted:body.source},error:null};
      }},
      rpc:async(name,args)=>{
        window.__saves.push({name,args});
        return {error:null,data:args.p_plan.map(x=>({...x,
          id:"d07045f6-10e4-494a-afdb-95648b0012f2",updated_at:"2026-11-02T00:00:00Z"}))};
      }
    };
  });
  await page.addStyleTag({path:"styles/timetable-ai-v1.css"});
  await page.addScriptTag({path:FRONT});
  await page.locator("#ttAiOpen").waitFor({timeout:4000});
  await page.locator("#ttAiOpen").click();
  assert(await page.locator("#ttAiPanel").isVisible(), "Chat should open");
  // File analysis must ask a question rather than overwrite the empty timetable.
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL7FAAAAABJRU5ErkJggg==","base64");
  await page.locator("#ttAiPanel input[type=file]").setInputFiles({
    name:"school.png",mimeType:"image/png",buffer:png
  });
  await page.locator(".ttai-compose button[type=submit]").click();
  await page.getByText("I found Physics and Chemistry. Which do you take?").waitFor();
  assert.equal(await page.locator(".ttai-apply").count(),0,
    "Uploading alone must never save/import classes automatically");
  await page.locator(".ttai-input").fill("Only Physics Monday at 9 at School");
  await page.locator(".ttai-compose button[type=submit]").click();
  await page.getByText("Added Physics to your draft.").waitFor();
  assert(await page.locator(".ttai-apply").isVisible(), "Proposed class must offer a save button");
  const calls=await page.evaluate(()=>window.__calls);
  assert.equal(calls[0].body.images.length,1,"Image should be passed as inline vision input");
  assert.equal(calls[1].body.source.length,2,"Next turn must retain document extraction");
  assert.equal(calls[1].body.history.length,2,"Next turn must retain conversational context");
  // User can undo previous plan without affecting saved rows.
  await page.locator(".ttai-input").fill("Cancel that Physics class");
  await page.locator(".ttai-compose button[type=submit]").click();
  await page.getByText("Okay, canceled.").waitFor();
  assert.equal(await page.locator(".ttai-apply").count(),0,"Undo should remove unsaved changes");
  // Create again and verify only an explicit confirmation performs the DB RPC.
  await page.locator(".ttai-input").fill("Add Physics Monday 9 to 10 at School");
  await page.locator(".ttai-compose button[type=submit]").click();
  await page.getByText("Added Physics to your draft.").last().waitFor();
  assert.equal((await page.evaluate(()=>window.__saves)).length,0,"No premature writes");
  page.once("dialog",dialog=>dialog.accept());
  await page.locator(".ttai-apply").click();
  await page.getByText("Your timetable was updated.").waitFor();
  const saves=await page.evaluate(()=>window.__saves);
  assert.equal(saves.length,1,"Save must call atomic RPC exactly once");
  assert.equal(saves[0].name,"apply_timetable_ai_plan");
  assert.equal(saves[0].args.p_plan.length,1);
  assert.equal(saves[0].args.p_expected.length,0);
  assert.equal((await page.evaluate(()=>window.state.timetable.rows)).length,1);
  // A native timetable rerender must restore the small AI button.
  await page.evaluate(()=>window.render());
  await page.locator("#ttAiOpen").waitFor({timeout:4000});
  assert(await page.locator("#ttAiPanel").isVisible(),"Conversation should survive native re-render");
  await page.close();
  console.log("TIMETABLE_AI_BROWSER=PASS (image, context, undo, review, atomic save, rerender)");
} finally {
  await browser.close();
}
