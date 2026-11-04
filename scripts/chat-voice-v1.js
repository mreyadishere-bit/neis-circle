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
// Keep one uninterrupted recording. Four-second cuts lose words at their edges.
const MAX_RECORDING_BYTES=1_350_000;
let active=null;
const tr=(ar,en)=>document.documentElement.lang?.startsWith("ar")?ar:en;
const formatError=(err)=>String(err?.message||err||"").slice(0,140);
function update(input,value){
 const max=Number(input.maxLength)>0?Number(input.maxLength):10000;
 input.value=value.slice(0,max);
 input.dispatchEvent(new Event("input",{bubbles:true}));
}
function combine(left,right){return [left,right].filter(Boolean).join(" ").trim()}
function stopMeter(s){
 if(s.meterFrame)cancelAnimationFrame(s.meterFrame);
 try{s.meterSource?.disconnect()}catch(_){}
 try{s.meterContext?.close()}catch(_){}
 s.meterFrame=0;
}
function startMeter(s){
 const bars=s.button?.closest(".neis-voice-controls")?.querySelectorAll(".neis-voice-wave i");
 const AudioClass=window.AudioContext||window.webkitAudioContext;
 if(!bars?.length||!AudioClass)return;
 try{
  s.meterContext=new AudioClass();
  if(s.meterContext.state==="suspended")void s.meterContext.resume().catch(()=>{});
  s.meterSource=s.meterContext.createMediaStreamSource(s.stream);
  const analyser=s.meterContext.createAnalyser();
  analyser.fftSize=256;
  s.meterSource.connect(analyser);
  const samples=new Uint8Array(analyser.fftSize);
  let previous=0;
  const render=now=>{
   if(s.stopped)return;
   if(now-previous>65){
    previous=now;
    analyser.getByteTimeDomainData(samples);
    let sum=0;
    for(const sample of samples){const value=(sample-128)/128;sum+=value*value}
    const level=Math.min(1,Math.sqrt(sum/samples.length)*5.5);
    bars.forEach((bar,i)=>{
     const factor=.55+.45*Math.abs(Math.sin(now/230+i*1.7));
     bar.style.height=(4+Math.round(19*level*factor))+"px";
    });
   }
   s.meterFrame=requestAnimationFrame(render);
  };
  s.meterFrame=requestAnimationFrame(render);
 }catch(_){stopMeter(s)}
}
function setVoiceStatus(s,ar,en){
 if(s.status?.isConnected)s.status.textContent=tr(ar,en);
}
function finalize(s){
 if(!s.stopped||!s.recorderEnded||s.processing||s.finalized)return;
 s.finalized=true;
 if(s.discardPending){
  setVoiceStatus(s,"","");
  s.chunks=[];
  return;
 }
 const audio=new Blob(s.chunks,{type:s.mime});
 s.chunks=[];
 if(audio.size<1500){
  setVoiceStatus(s,"لم ألتقط كلامًا واضحًا. جرّب التسجيل تاني.","No speech captured. Please try again.");
  return;
 }
 if(audio.size>MAX_RECORDING_BYTES){
  setVoiceStatus(s,"التسجيل طويل جدًا لهذا الطلب. جرّب كلامًا أقصر.","This recording exceeds the speech service size limit. Try a shorter recording.");
  return;
 }
 // Transcribe the *entire* recording as one coherent utterance. No
 // artificial four-second cuts or lost words at the clip boundaries.
 s.processing=true;
 setVoiceStatus(s,"بجهز كلامك…","Transcribing your speech…");
 (async()=>{
  try{
   const words=await recognizeClip(s,audio);
   if(!s.discardPending&&s.input.isConnected&&words){
    update(s.input,combine(s.input.value.trim(),words));
    setVoiceStatus(s,"","");
   }else if(!words) setVoiceStatus(s,"لم أسمع كلامًا واضحًا. جرّب تاني.","No clear speech detected. Try again.");
  }catch(error){
   console.warn("[NEIS dictation]",formatError(error));
   // Keep audio in memory for a manual retry. Never show an incomplete text.
   if(!s.discardPending){
    s.retryAudio=audio;
    setVoiceStatus(s,"تعذّر التفريغ مؤقتًا. اضغط إعادة المحاولة بدون تسجيل جديد.","Transcription failed. Tap Retry without recording again.");
    showRetry(s);
   }
  }finally{
   s.processing=false;
  }
 })();
}
function showRetry(s){
 if(!s.retryAudio||!s.status?.isConnected)return;
 let button=s.status.querySelector?.(".neis-voice-retry");
 if(!button){
  button=document.createElement("button");
  button.type="button";
  button.className="neis-voice-retry";
  button.textContent=tr("إعادة المحاولة","Retry");
  s.status.append(" ",button);
 }
 button.onclick=async()=>{
  if(s.processing||!s.retryAudio)return;
  s.processing=true;
  button.disabled=true;
  const audio=s.retryAudio;
  try{
   const words=await recognizeClip(s,audio);
   if(!s.discardPending&&s.input.isConnected&&words){
    update(s.input,combine(s.input.value.trim(),words));
    s.retryAudio=null;
    setVoiceStatus(s,"","");
   }else{
    setVoiceStatus(s,"لم أسمع كلامًا واضحًا. جرّب تاني.","No clear speech detected. Try again.");
    s.retryAudio=null;
   }
  }catch(error){
   console.warn("[NEIS dictation retry]",formatError(error));
   setVoiceStatus(s,"التفريغ لسه مش متاح. جرّب تاني.","Speech service is still unavailable. Please retry.");
   showRetry(s);
  }finally{s.processing=false;button.disabled=false}
 };
}
function stop(s=active,{discard=false}={}){
 if(!s||s.stopped)return;
 s.discardPending=s.discardPending||discard;
 s.stopped=true;if(active===s)active=null;
 if(s.button?.isConnected){
  s.button.classList.remove("is-listening");
  s.button.setAttribute("aria-pressed","false");
  s.button.setAttribute("aria-label",tr("بدء الإملاء الصوتي","Start voice dictation"));
 }
 stopMeter(s);
 try{
  if(s.recorder?.state==="recording")s.recorder.stop();
  else if(!s.recorder)s.recorderEnded=true;
 }catch(_){s.recorderEnded=true}
 try{s.stream?.getTracks().forEach(t=>t.stop())}catch(_){}
 if(!s.discardPending)setVoiceStatus(s,"بجهز كلامك…","Preparing transcription…");
 finalize(s);
}
async function recognizeClip(s,blob){
 if(blob.size<1500)return;
 if(blob.size>MAX_RECORDING_BYTES)throw Error("VOICE_TOO_LARGE");
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
function startRecording(s){
 // A single MediaRecorder stays running until Stop. Timeslice blobs are
 // concatenated to one valid media recording before being sent.
 const recorder=new MediaRecorder(s.stream,{mimeType:s.mime,audioBitsPerSecond:32000});
 s.recorder=recorder;
 recorder.ondataavailable=event=>{
  if(event.data?.size)s.chunks.push(event.data);
 };
 recorder.onerror=()=>{
  if(!s.stopped){
   setVoiceStatus(s,"حدث خطأ أثناء تسجيل الصوت.","Audio capture encountered an error.");
   stop(s);
  }
 };
 recorder.onstop=()=>{
  s.recorderEnded=true;
  finalize(s);
 };
 recorder.start(1000);
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
 const s={input,button,status,stream,mime,recorder:null,chunks:[],stopped:false,discardPending:false,recorderEnded:false,finalized:false,processing:false,retryAudio:null,meterFrame:0};
 active=s;
 button.classList.add("is-listening");button.setAttribute("aria-pressed","true");
 button.setAttribute("aria-label",tr("إيقاف الإملاء الصوتي وإظهار الكلام","Stop dictation and insert text"));
 status.textContent=tr("جاري الاستماع… اضغط إيقاف لإظهار الكلام.","Listening… tap Stop to insert the text.");
 startMeter(s);
 stream.getTracks().forEach(t=>t.addEventListener("ended",()=>stop(s),{once:true}));
 try{startRecording(s)}catch(e){status.textContent=tr("تعذر بدء التسجيل.","Could not start recording.");stop(s)}
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
 const wave=document.createElement("span");
 wave.className="neis-voice-wave";wave.setAttribute("aria-hidden","true");
 wave.innerHTML="<i></i><i></i><i></i><i></i><i></i>";
 mic.insertAdjacentHTML("beforeend",'<span class="neis-voice-stop" aria-hidden="true"></span>');
 wrap.append(wave,mic);
 const send=form.querySelector('button[type=submit],[data-chat-send],#magnusSend');
 if(send)form.insertBefore(wrap,send);else form.append(wrap);
 form.insertAdjacentElement("afterend",status);
 form.addEventListener("submit",()=>{if(active?.input===input)stop(active,{discard:true})});
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
 mic.insertAdjacentHTML("beforeend",'<span class="neis-voice-stop" aria-hidden="true"></span>');
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
// Keep recording while the browser allows the microphone to remain active.
// Mobile operating systems may still suspend capture when the app is backgrounded.
window.addEventListener("pagehide",()=>stop());
})();