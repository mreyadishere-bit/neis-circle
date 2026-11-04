/* NEIS Circle — continuous bilingual speech dictation.
 * Audio transcription auto-detects Arabic, English and code-switching.
 * Never submits messages, never persists audio, and preserves user edits.
 */
(()=>{
"use strict";
if(window.__neisChatVoiceV1)return;
window.__neisChatVoiceV1=true;
const targets=["liveChatInput","circleChatInput","magnusInput"];
const SUPPORTED=["audio/webm;codecs=opus","audio/webm","audio/mp4","audio/ogg;codecs=opus"];
const clipLength=7000;
let active=null;
const tr=(ar,en)=>document.documentElement.lang?.startsWith("ar")?ar:en;
const formatError=(err)=>String(err?.message||err||"").slice(0,140);
function update(input,value){
 const max=Number(input.maxLength)>0?Number(input.maxLength):10000;
 input.value=value.slice(0,max);
 input.dispatchEvent(new Event("input",{bubbles:true}));
}
function combine(left,right){return [left,right].filter(Boolean).join(" ").trim()}
function stop(s=active){
 if(!s||s.stopped)return;
 s.stopped=true;if(active===s)active=null;
 clearTimeout(s.timer);
 if(s.button?.isConnected){s.button.classList.remove("is-listening");s.button.setAttribute("aria-pressed","false")}
 try{if(s.recorder&&s.recorder.state==="recording")s.recorder.stop()}catch(_){}
 try{s.stream?.getTracks().forEach(t=>t.stop())}catch(_){}
 if(s.status?.isConnected)s.status.textContent=s.pending?tr("بكمل تحويل آخر جزء…","Finishing last audio clip…"):"";
}
async function recognizeClip(s,blob){
 if(blob.size<1500)return;
 if(blob.size>1350000){if(s.status.isConnected)s.status.textContent=tr("المقطع كبير جدًا، حاول مرة تانية.","Audio clip too large; please retry.");return}
 const bytes=await blob.arrayBuffer();
 const a=new Uint8Array(bytes);
 let base64="";
 for(let offset=0;offset<a.length;offset+=16384)
  base64+=String.fromCharCode(...a.subarray(offset,offset+16384));
 base64=btoa(base64);
 const client=(typeof sb!=="undefined"?sb:null)||window.supabaseClient||window.neisSupabase;
 if(!client?.functions?.invoke)throw Error("VOICE_BACKEND_UNAVAILABLE");
 const type=(blob.type||s.mime||"audio/webm").split(";")[0];
 const {data,error}=await client.functions.invoke("chat-voice-transcribe",{body:{mimeType:type,audio:base64}});
 if(error||!data||typeof data.text!=="string"){
  let detail=data?.error||error?.message||"";
  if(error?.context?.json){const payload=await error.context.json().catch(()=>null);detail=payload?.error||detail}
  throw Error(detail||"VOICE_TRANSCRIPTION_FAILED");
 }
 return data.text.trim();
}
function queue(s,blob){
 if(!blob||blob.size<1500)return;
 s.pending++;
 s.chain=s.chain.then(async()=>{
  try{
   const words=await recognizeClip(s,blob);
   if(words&&s.input.isConnected&&!s.discardPending){
    // Respect the user's current edits, rather than replacing the text
    // they typed during an asynchronous transcription.
    update(s.input,combine(s.input.value.trim(),words));
   }
   if(!s.stopped&&s.status.isConnected)s.status.textContent=tr("جاري الاستماع…","Listening…");
  }catch(e){
   if(s.status.isConnected)s.status.textContent=tr("التعرف على الصوت مش متاح حاليًا. حاول مجددًا.","Speech transcription unavailable. Retry.");
   if(!s.stopped){s.failed=true;stop(s)}
  }finally{
   s.pending--;
   if(s.stopped&&s.pending===0&&s.status.isConnected)s.status.textContent="";
  }
 });
}
function nextClip(s){
 if(s.stopped||!s.input.isConnected)return;
 const rec=new MediaRecorder(s.stream,{mimeType:s.mime,audioBitsPerSecond:32000});
 s.recorder=rec;const chunks=[];
 rec.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
 rec.onerror=()=>{if(!s.stopped){s.status.textContent=tr("مشكلة في التسجيل.","Recording error.");stop(s)}};
 rec.onstop=()=>{
  if(chunks.length)queue(s,new Blob(chunks,{type:s.mime}));
  if(!s.stopped&&!s.failed&&s.input.isConnected)nextClip(s);
 };
 rec.start();
 s.timer=setTimeout(()=>{if(rec.state==="recording"){try{rec.stop()}catch(_){stop(s)}}},clipLength);
}
async function start(input,button,status){
 if(active?.input===input){stop();return}
 stop();
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){
  status.textContent=tr("المتصفح مش بيدعم التسجيل الصوتي المطلوب.","This browser does not support audio recording.");return;
 }
 const mime=SUPPORTED.find(x=>MediaRecorder.isTypeSupported(x));
 if(!mime){status.textContent=tr("صيغة الصوت غير مدعومة في المتصفح.","Audio recording format unsupported.");return}
 let stream;
 try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})}
 catch(e){status.textContent=tr("اسمح بالمايك من إعدادات المتصفح.","Allow microphone access in browser settings.");return}
 if(active){stream.getTracks().forEach(t=>t.stop());return}
 const s={input,button,status,stream,mime,recorder:null,timer:null,chain:Promise.resolve(),pending:0,failed:false,stopped:false,discardPending:false};
 active=s;
 button.classList.add("is-listening");button.setAttribute("aria-pressed","true");
 status.textContent=tr("جاري الاستماع للعربي والإنجليزي…","Listening to Arabic and English…");
 stream.getTracks().forEach(t=>t.addEventListener("ended",()=>stop(s),{once:true}));
 try{nextClip(s)}catch(e){status.textContent=tr("تعذر بدء التسجيل.","Could not start recording.");stop(s)}
}
function mount(input){
 const form=input.closest("form");
 if(!form||form.querySelector(".neis-voice-controls"))return;
 const wrap=document.createElement("span");wrap.className="neis-voice-controls";
 const mic=document.createElement("button");mic.type="button";mic.className="neis-voice-mic ttai-mic";
 mic.setAttribute("aria-label",tr("بدء أو إيقاف الإملاء الصوتي العربي والإنجليزي","Start or stop bilingual voice dictation"));
 mic.setAttribute("aria-pressed","false");
 mic.title=tr("إملاء عربي وإنجليزي تلقائي","Automatic Arabic and English dictation");
 mic.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>';
 const status=document.createElement("span");status.className="neis-voice-status";status.setAttribute("role","status");status.setAttribute("aria-live","polite");
 mic.addEventListener("click",()=>{void start(input,mic,status)});
 mic.addEventListener("pointerdown",e=>e.preventDefault());
 wrap.append(mic);
 const send=form.querySelector('button[type=submit],[data-chat-send],#magnusSend');
 if(send)form.insertBefore(wrap,send);else form.append(wrap);
 form.insertAdjacentElement("afterend",status);
 form.addEventListener("submit",()=>{if(active?.input===input){active.discardPending=true;stop()}});
}
function mountTimetable(){
 const panel=document.getElementById("ttAiPanel");
 if(!panel||panel.hidden)return;
 const input=panel.querySelector(".ttai-input");
 const mic=panel.querySelector(".ttai-mic");
 const status=panel.querySelector(".ttai-speech-status");
 if(!input||!mic||!status||mic.dataset.multilingualBound==="1")return;
 mic.dataset.multilingualBound="1";
 // Replace the old single-language Web Speech click handler, without
 // replacing the native Timetable AI composer or changing its save logic.
 mic.onclick=null;
 mic.disabled=false;
 mic.setAttribute("aria-label",tr("إملاء صوتي عربي وإنجليزي تلقائي","Automatic Arabic and English dictation"));
 mic.title=tr("إملاء عربي وإنجليزي تلقائي","Automatic Arabic and English dictation");
 mic.addEventListener("click",()=>{void start(input,mic,status)});
}
function scan(){
 if(active&&!active.input.isConnected)stop();
 for(const id of targets){const input=document.getElementById(id);if(input)mount(input)}
 mountTimetable();
}
let queued=false;
const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;scan()})};
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",scan,{once:true});else scan();
document.addEventListener("visibilitychange",()=>{if(document.hidden)stop()});
window.addEventListener("pagehide",()=>stop());
})();