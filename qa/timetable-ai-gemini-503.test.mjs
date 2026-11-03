import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const edge=fs.readFileSync('supabase/functions/timetable-ai/index.ts','utf8');
const client=fs.readFileSync('scripts/timetable-ai-v1.js','utf8');
const start=edge.indexOf('async function callGeminiWithRetry(');
const end=edge.indexOf('Deno.serve(',start);
assert.ok(start>=0&&end>start,'Gemini retry helper must exist');
const source=edge.slice(start,end)
 .replace('ai: GoogleGenAI','ai')
 .replace('contents: Array<Record<string, unknown>>','contents')
 .replace('let lastError: unknown','let lastError')
 .replace('(err as { status?: number })?.status','err?.status')
 .replace(/catch \(err: unknown\)/g,'catch (err)');

assert.match(edge,/const PRIMARY_MODEL = "gemini-3\.8-flash"/);
assert.match(edge,/const OVERLOAD_FALLBACK_MODEL = "gemini-3\.6-flash"/);
assert.match(edge,/responseMimeType: "application\/json"/);
assert.match(edge,/responseSchema: TIMETABLE_RESPONSE_SCHEMA/);
assert.match(edge,/client\.auth\.getUser\(jwt\)/,'authoritative auth unchanged');
assert.match(edge,/inlineData:\s*\{/,'raw multimodal PDFs/images unchanged');
assert.match(edge,/GEMINI_SERVICE_UNAVAILABLE_503/);
assert.match(edge,/retryAfterSeconds: 20/);
assert.match(edge,/httpOptions: \{ timeout: 80000/);
assert.match(edge,/maxRetries = 1/);
assert.match(client,/stateAI\.lastFailed=\{text,file\}/,'failed PDF and prompt preserved for user Retry');
assert.match(client,/apply_timetable_ai_plan/,'original private save RPC retained');
assert.match(client,/const AI_REQUEST_DEADLINE_MS=95000/,'frontend deadline unchanged');

const unavailable=Object.assign(new Error('model currently experiencing high demand'),{status:503});
const quota=Object.assign(new Error('Quota exhausted'),{status:429});
const badDocument=Object.assign(new Error('Invalid argument'),{status:400});
const transient=Object.assign(new Error('Upstream error'),{status:500});

function harness(sequence,{atTime=()=>0}={}){
 const requests=[];
 let tick=0;
 const context={
  PRIMARY_MODEL:'gemini-3.8-flash',
  OVERLOAD_FALLBACK_MODEL:'gemini-3.6-flash',
  SYSTEM_INSTRUCTION:'native multimodal visual timetable understanding',
  TIMETABLE_RESPONSE_SCHEMA:{type:'object',required:['reply','changed','entries','extracted']},
  Date:{now:()=>atTime(tick,requests.length)},
  Math:{random:()=>0,floor:Math.floor},
  setTimeout:(cb)=>{cb();return 1},
  Promise,Error,Number,String,
 };
 const ai={models:{generateContent:async request=>{
  requests.push(request);
  const event=sequence[tick++];
  if(event instanceof Error)throw event;
  return event;
 }}};
 const fn=vm.runInNewContext(source+'; callGeminiWithRetry',context);
 return {ai,fn,requests};
}
const contents=[{role:'user',parts:[
 {inlineData:{mimeType:'application/pdf',data:'UERG'}},
 {inlineData:{mimeType:'image/png',data:'UE5H'}},
 {text:'Physics L2, Maths L2; keep previous changes'}
]}];

{
 const h=harness([{text:'original success'}]);
 assert.equal((await h.fn(h.ai,contents)).text,'original success');
 assert.deepEqual(h.requests.map(r=>r.model),['gemini-3.8-flash'],'first attempt remains 3.8');
}
{
 const h=harness([unavailable,{text:'primary retry success'}]);
 assert.equal((await h.fn(h.ai,contents)).text,'primary retry success');
 assert.deepEqual(h.requests.map(r=>r.model),['gemini-3.8-flash','gemini-3.8-flash']);
}
{
 const h=harness([unavailable,unavailable,{text:'fallback success',modelVersion:'gemini-3.6-flash'}]);
 const r=await h.fn(h.ai,contents);
 assert.equal(r.text,'fallback success');
 assert.deepEqual(h.requests.map(r=>r.model),['gemini-3.8-flash','gemini-3.8-flash','gemini-3.6-flash']);
 // PDF/image parts, multi-turn conversation, system prompt and schema must
 // pass through without losing information or changing the save contract.
 assert.ok(h.requests.every(req=>req.contents===contents),'same multimodal/context payload passed through');
 assert.ok(h.requests.every(req=>req.config.responseMimeType==='application/json'));
 assert.ok(h.requests.every(req=>req.config.responseSchema===h.requests[0].config.responseSchema));
 assert.ok(h.requests.every(req=>req.config.systemInstruction===h.requests[0].config.systemInstruction));
}
{
 const h=harness([unavailable,unavailable,unavailable]);
 await assert.rejects(h.fn(h.ai,contents),err=>err.status===503);
 assert.equal(h.requests.length,3,'bounded: one primary retry and one fallback only');
}
for(const bad of [quota,badDocument,transient]){
 const h=harness([bad]);
 await assert.rejects(h.fn(h.ai,contents),err=>err.status===bad.status);
 assert.equal(h.requests.length,1,'never retry or switch on '+bad.status);
}
{
 const h=harness([unavailable,unavailable],{atTime:()=>9500});
 await assert.rejects(h.fn(h.ai,contents),err=>err.status===503);
 assert.equal(h.requests.length,1,'late 503 cannot start another request beyond 95s UI deadline');
}
{
 const h=harness([unavailable,unavailable],{atTime:(tick)=>tick>=2?9500:0});
 await assert.rejects(h.fn(h.ai,contents),err=>err.status===503);
 assert.equal(h.requests.length,2,'late second 503 cannot launch a third 80s call');
}
console.log('TIMETABLE_GEMINI_503_FALLBACK=PASS; original 3.8 primary, native PDF/image, unchanged schema/auth/save, bounded 503-only failover');
