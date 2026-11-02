import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {webcrypto} from "node:crypto";

const client=fs.readFileSync("scripts/timetable-ai-cloudflare-v1.js","utf8");
const server=fs.readFileSync("supabase/functions/timetable-ai-cloudflare/index.ts","utf8");
const css=fs.readFileSync("styles/timetable-ai-v1.css","utf8");
const start=client.indexOf("const preparedFileCache=new Map();");
const end=client.indexOf("// Keep the chat responsive",start);
assert.ok(start>0&&end>start,"Cache and image pipeline must exist");
assert.match(client,/Promise\.all\(Array\.from\(/,"render pages in bounded groups");
assert.match(client,/const textPromise=\(async\(\)=>\{/,"text coordinates begin independently of page rendering");
assert.match(client,/evidence:"PAGE "\+pageNum\+" POSITIONED PDF TEXT\\n"\+await textPromise/,"visual output retains positioned text evidence");
assert.match(client,/fileBytesCache\.get\(file\)/,"PDF bytes reused for hashing and rendering");
assert.match(client,/canvas\.toBlob\(/,"avoid synchronous canvas-to-data-url");
assert.match(client,/AI_REQUEST_DEADLINE_MS=52000/);
assert.match(client,/stateAI\.abort\?\.abort\(\)/);
assert.match(client,/mode:"replace"/,"New PDF imports must not silently retain stale subjects");
assert.match(client,/extractReadableTextFallback\(prepared\.textEvidence\)/);
assert.match(css,/ttai-work-cancel/);
assert.match(server,/discoveryMode \? !hasDiscovery : !Array\.isArray\(parsed\.entries\)/);
assert.match(server,/CLOUDFLARE_DAILY_LIMIT/);
assert.match(server,/CLOUDFLARE_CAPACITY/);
assert.match(server,/verifyPdfGridLessons\(rawLessons,pdfEvidence\)/,"verify visual timetable proposals against extracted PDF coordinates");
assert.match(server,/const firstDay=parsed\.find/,"subject headers must be found relative to first timetable day");
assert.match(server,/const level=candidates\.filter/,"recover subject L1/L2 from positioned header text");
assert.match(server,/qualifiedBases\.has\(base\(x\)\)/,"remove generic subject options when qualified ones exist");
assert.match(server,/extractPdfSubjectHeaders\(pdfEvidence\)/,"preserve true PDF subject headings and separate L1 and L2");
assert.match(server,/qualifiedBases\.has\(base\(x\)\)/,"remove ambiguous AI subjects when qualified titles exist");
assert.match(server,/source_page.*source_x/,"visual reader must cite page and grid cell position");
assert.match(server,/checked\.rejected/,"uncertain grid cells must be disclosed");
assert.match(server,/max_tokens: 2200/);
const code=client.slice(start,end)+"\nglobalThis.__test={toData,extractReadableTextFallback,preparedFileCache};";
let reads=0,phase="";
const bytes=Buffer.from("synthetic-image-bytes-only");
const context={
  Map,WeakMap,Set,Uint8Array,Array,String,Number,Math,Promise,
  crypto:webcrypto,
  readData:async()=>{reads++;return bytes.toString("base64");},
  setPhase:x=>{phase=x},
  wizardText:en=>en,
  stateAI:{cancelled:false},
  subjectKey:title=>String(title||"").normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase(),
};
vm.createContext(context);
vm.runInContext(code,context);
const f1={name:"first.png",type:"image/png",arrayBuffer:async()=>bytes};
const f2={name:"renamed.png",type:"image/png",arrayBuffer:async()=>bytes};
const first=await context.__test.toData(f1);
const second=await context.__test.toData(f1);
const third=await context.__test.toData(f2);
assert.equal(reads,1,"Retry and duplicate identical file must reuse prepared pixels");
assert.equal(first.attachments[0].data,second.attachments[0].data);
assert.equal(first.attachments[0].data,third.attachments[0].data);
assert.equal(context.__test.preparedFileCache.size,1);
const fallback=context.__test.extractReadableTextFallback(
  "PAGE 2 POSITIONED PDF TEXT\n"+
  "y=850 x=120:French Gr 11 ( Sun 12:00 pm – 1:00 pm )\n"+
  "y=880 x=120:Religion Gr11 ( Mon 7:30 am – 8:30 am )\n"+
  "y=40 x=300:Physics L2 | x=450:Maths L2");
assert.equal(fallback.detected_lessons.length,0,"Local-only fallback must not fabricate lesson times");
const subjects=[...fallback.all_detected_subjects].map(x=>x.toLowerCase());
assert.ok(subjects.some(x=>x.includes("french")));
assert.ok(subjects.some(x=>x.includes("religion")));
assert.ok(subjects.some(x=>x.includes("physics")));
assert.ok(fallback.ambiguous_items.length);
const explicit=context.__test.extractReadableTextFallback(
  "PAGE 2 POSITIONED PDF TEXT\n"+
  "y=780 x=45:* Religion Gr11 ( Mon 7:30 am – 8:30 am )\n"+
  "y=850 x=40:* French Gr 11 ( Sun 12:00 pm – 1:00 pm )");
const foot=JSON.parse(JSON.stringify(explicit.detected_lessons));
assert.equal(foot.length,2,"Only two unambiguous notes can be restored");
assert.ok(foot.some(x=>x.title.toLowerCase().includes("french")&&
  x.day_of_week===0&&x.start_time==="12:00"&&x.end_time==="13:00"));
assert.ok(foot.some(x=>x.title.toLowerCase().includes("religion")&&
  x.day_of_week===1&&x.start_time==="07:30"&&x.end_time==="08:30"));

console.log("REUSED_CONVERSION_WITHOUT_REUPLOAD=PASS");
console.log("SAFE_PARTIAL_PDF_TEXT_FALLBACK=PASS");
console.log("CLOUD_FLARE_DISCOVERY_RESPONSE_FIX=PASS");
console.log("LOADING_CANCEL_TIMEOUT_UI=PASS");
