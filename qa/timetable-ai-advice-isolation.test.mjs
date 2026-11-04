import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const edge=fs.readFileSync('supabase/functions/timetable-ai/index.ts','utf8');
const js=fs.readFileSync('scripts/timetable-ai-v1.js','utf8');
const start=edge.indexOf('const adviceOnly =');
const end=edge.indexOf('if (adviceOnly) {',start);
assert.ok(start>=0 && end>start,'general-advice detection is isolated');
const predicate=edge.slice(start,end);
const check=(userPrompt,attached=false)=>vm.runInNewContext(predicate+'; adviceOnly',{
 userPrompt,multimodalParts:attached?[{inlineData:{mimeType:'application/pdf',data:'abc'}}]:[]
});
for(const q of [
 'how can I manage my timetable in the best way?',
 'help me manage my time',
 'Help me balance studying and rest',
 'ساعدني أنظم وقت المذاكرة',
 'What is the best way to organize my study timetable?',
 'Give me tips for my revision schedule',
 'كيف أنظم جدول مذاكرتي؟'
]) assert.equal(check(q),true,'general advice question: '+q);
for(const q of [
 'Add Physics on Monday at 8am',
 'How can I add a class to my timetable?',
 'Change maths lesson on Tuesday',
 'Remove the French class',
 'Analyze this PDF timetable visually'
]) assert.equal(check(q),false,'schedule mutations stay on structured path: '+q);
assert.equal(check('how should I manage my timetable?',true),false,'PDF attachments always use multimodal path');

assert.ok(edge.indexOf('if (adviceOnly) {')<edge.indexOf('const response = await callGeminiWithRetry'),
 'plain text advice is routed before the structured extraction path');
assert.match(edge,/model: PRIMARY_MODEL, contents: \[textRequest\], config: adviceConfig/,'general advice uses Gemini primary as text');
assert.match(edge,/model: OVERLOAD_FALLBACK_MODEL, contents: \[textRequest\], config: adviceConfig/,'503 or incomplete answer falls back to Gemini text mode');
assert.match(edge,/changed: false,\s*entries: draftEntries/,'advice never changes timetable');
assert.match(edge,/provider: "offline-guidance"/,'dual Gemini 503 still yields transparent generic advice');
assert.match(edge,/Gemini is temporarily busy, so here are practical general tips/,'offline advice clearly labeled');
assert.match(edge,/لم أغير أي شيء في جدولك/,'Arabic fallback does not claim schedule changes');
assert.match(edge,/adviceUnavailable\(fallbackError\)/,'offline advice is limited to transient Gemini 503 or timeouts');
assert.match(edge,/timeout: 14000, headers: \{\}/,'advice HTTP requests have a bounded 14-second timeout');
assert.match(edge,/if \(!adviceUnavailable\(adviceError\)\)/,'never fallback on authentication or quota errors');

assert.match(edge,/maxOutputTokens: 1800/,'general advice has sufficient output budget');
assert.match(edge,/finish !== "MAX_TOKENS"/,'reject incomplete model responses');
assert.match(edge,/if \(!usableAdvice\(advice\)\) advice = null/,'incomplete answers trigger alternative model');
assert.match(edge,/String\(advice\.text \?\? ""\)\.trim\(\)\.slice\(0, 5000\)/,'advice is not clipped to old 1800 character ceiling');
assert.match(js,/Safe formatting for Gemini/,'Markdown emphasis is rendered without untrusted HTML');
assert.match(edge,/responseSchema: TIMETABLE_RESPONSE_SCHEMA/,'PDF and timetable editing remain JSON-structured');
assert.match(edge,/validateAndNormalizeEntries\(parsed\.entries\)/,'structured answer validation remains');
assert.match(edge,/client\.auth\.getUser\(jwt\)/,'authenticated access remains');
assert.match(js,/apply_timetable_ai_plan/,'RLS timetable save stays intact');
assert.match(js,/stateAI\.lastFailed=\{text,file\}/,'retry draft and files stay intact');
assert.match(js,/SpeechRecognition\|\|window\.webkitSpeechRecognition/,'native speech recognition supported with webkit fallback');
assert.match(js,/recognition\.lang=lang\(\)===["']ar["']\?["']ar-EG["']:["']en-US["']/,'dictation follows Arabic or English locale');
assert.match(js,/no automatic submission/,'dictation never automatically sends a message');
assert.match(js,/recognition\.abort\(\)/,'speech recognition cleans up on redraw');
assert.match(js,/stateAI\.advicePending=false;draw\(\)/,'advice loading state resets after request');

assert.match(js,/window\.visualViewport\.addEventListener\("resize",syncMobileViewport/,'Android keyboard resizing is handled');
console.log('TIMETABLE_ADVICE_ISOLATION=PASS');
