import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync('scripts/chat-voice-v1.js','utf8');
const css=readFileSync('styles/chat-voice-v1.css','utf8');
assert.match(script,/recorder\.start\(1000\)/,'one uninterrupted recorder with timeslice buffers');
assert.match(script,/new Blob\(s\.chunks,\{type:s\.mime\}\)/,'send entire recording as one blob');
assert.doesNotMatch(script,/clipLength=4000|function nextClip\(|function pumpClips\(/,'no word-cutting four-second segments');
assert.match(script,/function startMeter\(s\)/);
assert.match(script,/function finalize\(s\)/);
assert.match(script,/function showRetry\(s\)/);
assert.match(css,/neis-voice-wave/);
assert.match(css,/neis-voice-stop/);

const source=script.replace(/\}\)\(\);\s*$/, 'window.__voiceTest={stop,finalize,inputSessions};})();');
assert.notEqual(source,script);
let calls=0;
let fail=false;
const context={
 Blob,
 window:{
  addEventListener(){},
  supabaseClient:{functions:{async invoke(name,{body}){
    calls++;
    assert.equal(name,'chat-voice-transcribe');
    assert.ok(body.audio.length>1500,'complete audio is submitted in one request');
    if(fail)return {data:{error:'Temporary failure'},error:{message:'unavailable'}};
    return {data:{text:'Just checking on you. Tell me how you are.'}};
  }}}
 },
 document:{documentElement:{lang:'en'},readyState:'loading',addEventListener(){},createElement(){
  return {type:'',className:'',textContent:'',onclick:null,disabled:false};
 }},
 MutationObserver:class{observe(){}},
 clearTimeout(){},
 cancelAnimationFrame(){},
 Event:class{constructor(type){this.type=type}},
 btoa:buf=>Buffer.from(buf,'binary').toString('base64'),
 console
};
vm.createContext(context);
vm.runInContext(source,context);
const {stop,finalize,inputSessions}=context.window.__voiceTest;
const tick=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve))};
function fixture(){
 const input={value:'Existing draft',isConnected:true,maxLength:2000,dispatchEvent(){}};
 const retryControls=[];
 const status={
  textContent:'Listening...',isConnected:true,
  querySelector(){return retryControls.find(el=>el.className==='neis-voice-retry')||null},
  append(_,button){retryControls.push(button)}
 };
 const state={
  input,status,button:{isConnected:false},
  recorder:{state:'inactive'},stream:{getTracks(){return[]}},
  mime:'audio/webm',chunks:[new Blob([new Uint8Array(2100)])],
  stopped:false,discardPending:false,recorderEnded:false,
  finalized:false,processing:false,retryAudio:null,meterFrame:0
 };
 inputSessions.set(input,state);
 return {state,input,status,retryControls};
}
{
 const {state,input}=fixture();
 stop(state);
 assert.equal(input.value,'Existing draft','stopping does not append text before the final data event');
 state.recorderEnded=true;
 finalize(state);
 assert.equal(input.value,'Existing draft','transcription remains hidden until provider finishes');
 await tick();
 assert.equal(input.value,'Existing draft Just checking on you. Tell me how you are.');
 finalize(state);
 await tick();
 assert.equal(calls,1,'only one request for the complete speech recording');
}
{
 fail=true;
 const {state,input,retryControls}=fixture();
 stop(state);
 state.recorderEnded=true;finalize(state);
 await tick();
 assert.equal(input.value,'Existing draft','failed audio never inserts incomplete text');
 assert.equal(retryControls.length,1,'failed recording offers retry without rerecording');
 fail=false;
 retryControls[0].onclick();
 await tick();
 assert.equal(input.value,'Existing draft Just checking on you. Tell me how you are.','retry recovers original audio');
}
{
 const {state,input}=fixture();
 stop(state,{discard:true});
 state.recorderEnded=true;finalize(state);
 await tick();
 assert.equal(input.value,'Existing draft','submitted composer does not gain late speech');
}
console.log('VOICE_FULL_RECORDING_STOP_AND_RETRY=PASS');
