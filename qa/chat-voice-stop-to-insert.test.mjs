import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync('scripts/chat-voice-v1.js','utf8');
const css=readFileSync('styles/chat-voice-v1.css','utf8');
assert.match(script,/function startMeter\(s\)/);
assert.match(script,/function finalize\(s\)/);
assert.match(script,/s\.transcript=combine\(s\.transcript,result\.words\)/);
assert.doesNotMatch(script,/update\(s\.input,combine\(s\.input\.value\.trim\(\),result\.words\)\)/);
assert.match(css,/neis-voice-wave/);
assert.match(css,/neis-voice-stop/);

const source=script.replace(/\}\)\(\);\s*$/, 'window.__voiceTest={stop,flushResults,finalize};})();');
assert.notEqual(source,script);
const context={
 window:{addEventListener(){}},
 document:{documentElement:{lang:'en'},readyState:'loading',addEventListener(){}},
 MutationObserver:class{observe(){}},
 clearTimeout(){},
 cancelAnimationFrame(){},
 Event:class{constructor(type){this.type=type}},
 console
};
vm.createContext(context);
vm.runInContext(source,context);
const {stop,flushResults,finalize}=context.window.__voiceTest;
const input={value:'Existing draft',isConnected:true,dispatchEvent(){}};
const status={textContent:'Listening...',isConnected:true};
const sample={
 input,status,button:{isConnected:false},recorder:{state:'inactive'},stream:{getTracks(){return[]}},
 timer:null,results:new Map([[1,{words:'second sentence'}],[0,{words:'first sentence'}]]),
 pending:0,sequence:2,nextCommit:0,transcript:'',failedClips:0,totalFailed:0,stopped:false,
 finalized:false,recorderEnded:false,discardPending:false,meterFrame:0
};
flushResults(sample);
assert.equal(input.value,'Existing draft','speech must not appear while recording');
assert.equal(sample.transcript,'first sentence second sentence','transcription must preserve speech order');
stop(sample);
assert.equal(input.value,'Existing draft','Stop must wait for the final MediaRecorder.onstop event');
sample.recorderEnded=true;
finalize(sample);
assert.equal(input.value,'Existing draft first sentence second sentence','speech inserted only after Stop and final chunk');
finalize(sample);
assert.equal(input.value,'Existing draft first sentence second sentence','commit occurs exactly once');
console.log('VOICE_STOP_TO_INSERT_CONTRACT=PASS');
