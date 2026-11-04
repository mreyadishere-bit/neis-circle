import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const frontend = fs.readFileSync('scripts/timetable-ai-v1.js','utf8');
const edge = fs.readFileSync('supabase/functions/timetable-ai/index.ts','utf8');
const start=frontend.indexOf('const AI_REQUEST_DEADLINE_MS=');
const end=frontend.indexOf('async function submit(',start);
assert.ok(start>=0 && end>start,'deadline helper missing');
const helper=frontend.slice(start,end);
assert.match(helper,/Promise\.race/,'network must be bounded even if AbortSignal is ignored');
assert.match(helper,/controller\.abort\(\)/,'timeout should abort remote request');
assert.match(frontend,/const \{data,error\}=await invokeWithDeadline\(body\)/);
assert.match(frontend,/stateAI\.lastFailed=\{text,file\}/,'retry must preserve PDF');
assert.match(frontend,/stateAI\.busy=false;stateAI\.advicePending=false;draw\(\)/,'loading state must always clear');
assert.match(edge,/httpOptions:\s*\{\s*timeout:\s*80000,/,'backend must have network timeout');
assert.match(edge,/maxRetries = 1,/,'backend permits one fast primary 503 retry');
assert.match(edge,/OVERLOAD_FALLBACK_MODEL = "gemini-3\.6-flash"/,'backend uses only verified secondary model');
assert.match(edge,/Date\.now\(\) - startedAt >= 9000/,'late errors must not launch additional 80s requests');
assert.match(edge,/fallback \|\| Date\.now\(\)/,'fallback must never retry recursively');

async function runScenario({language='en',network='hang'}){
  let pendingTimeout=null, cleared=false, capturedSignal=null;
  const context={
    lang:()=>language,
    AbortController,
    setTimeout:(callback)=>{pendingTimeout=callback;return 1},
    clearTimeout:()=>{cleared=true},
    sb:{functions:{invoke:(name,opts)=>{
      assert.equal(name,'timetable-ai');
      capturedSignal=opts.signal;
      if(network==='hang')return new Promise(()=>{});
      return Promise.resolve({data:{reply:'OK',entries:[]}});
    }}},
  };
  vm.createContext(context);
  vm.runInContext(helper+';globalThis.invokeTest=invokeWithDeadline;',context);
  const promise=context.invokeTest({message:'Physics L2'});
  if(network==='hang'){
    assert.equal(typeof pendingTimeout,'function');
    pendingTimeout();
    await assert.rejects(promise,new RegExp(language==='ar'?'استغرق':'timed out'));
    assert.equal(capturedSignal.aborted,true,'fetch must be aborted');
  }else{
    const result=await promise;
    assert.equal(result.data.reply,'OK');
    assert.equal(capturedSignal.aborted,false);
  }
  assert.equal(cleared,true,'timer must be cleared');
}
await runScenario({network:'hang'});
await runScenario({language:'ar',network:'hang'});
await runScenario({network:'respond'});
console.log('TIMETABLE_AI_TIMEOUT_REGRESSION=PASS (English, Arabic, successful response, abort+timer cleanup)');
