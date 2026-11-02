import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const edge = fs.readFileSync('supabase/functions/timetable-ai/index.ts', 'utf8');
const start = edge.indexOf('async function callGeminiWithRetry(');
const end = edge.indexOf('Deno.serve(', start);
assert.ok(start >= 0 && end > start, 'Retry function not found');
const source = edge.slice(start, end)
  .replace('ai: GoogleGenAI', 'ai')
  .replace('contents: Array<Record<string, unknown>>', 'contents')
  .replace('let lastError: unknown', 'let lastError')
  .replace('(err as { status?: number })?.status', 'err?.status')
  .replace(/catch \(err: unknown\)/g, 'catch (err)');

assert.match(edge, /GEMINI_SERVICE_UNAVAILABLE_503/);
assert.match(edge, /retryAfterSeconds: 20/);
assert.match(edge, /httpOptions: \{ timeout: 80000/);
assert.match(edge, /maxRetries = 1/);

function getCaller(now=0) {
  const context = {
    Date: {now: () => now},
    Math: {random: () => 0},
    setTimeout: callback => {callback(); return 1},
    Promise,
    Error,
    Number,
    String,
  };
  return vm.runInNewContext(source + '; callGeminiWithRetry', context);
}

function apiWith(sequence) {
  let calls=0;
  return {
    api: {models: {generateContent: async () => {
      const event=sequence[calls++];
      if (event instanceof Error) throw event;
      return event;
    }}},
    count: () => calls,
  };
}

const unavailable = Object.assign(new Error('This model is currently experiencing high demand'), {status:503});
const quota = Object.assign(new Error('Quota exhausted'), {status:429});

{
  const fake=apiWith([unavailable,{text:'ok'}]);
  const reply=await getCaller()(fake.api,[{role:'user',parts:[{text:'test'}]}]);
  assert.equal(reply.text,'ok');
  assert.equal(fake.count(),2,'one fast 503 must be retried once');
}
{
  const fake=apiWith([unavailable,unavailable,unavailable]);
  await assert.rejects(getCaller()(fake.api,[]),err => err.status===503);
  assert.equal(fake.count(),2,'no unbounded 503 retries');
}
{
  const fake=apiWith([quota]);
  await assert.rejects(getCaller()(fake.api,[]),err => err.status===429);
  assert.equal(fake.count(),1,'quota failure must not be retried');
}
{
  let now=0;
  const context={Date:{now:()=>now},Math:{random:()=>0},setTimeout:cb=>{cb();return 1},Promise,Error,Number,String};
  const fn=vm.runInNewContext(source + '; callGeminiWithRetry',context);
  let calls=0;
  const api={models:{generateContent:async () => {calls++;now=11000;throw unavailable}}};
  await assert.rejects(fn(api,[]),err=>err.status===503);
  assert.equal(calls,1,'slow 503 must not trigger another 80s request');
}
console.log('GEMINI_503_BACKOFF_TESTS=PASS: quick retry, bounded repeat, no 429 retry, deadline protection');
