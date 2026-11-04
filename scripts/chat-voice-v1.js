/* NEIS Circle — speech-to-text for DM, Circle and Magnus chat composers.
 * Browser SpeechRecognition only: no auto-send, no server-side audio upload.
 * Keeps native input events so existing drafts, send and realtime handlers work.
 */
(()=>{
'use strict';
if(window.__neisChatVoiceV1)return;
window.__neisChatVoiceV1=true;
const speechCtor=window.SpeechRecognition||window.webkitSpeechRecognition;
const targets=['liveChatInput','circleChatInput','magnusInput'];
let active=null;
const label=(ar,en)=>document.documentElement.lang?.toLowerCase().startsWith('ar')?ar:en;
function stop(){
  if(!active)return;
  const s=active;active=null;s.stopped=true;
  clearTimeout(s.timer);
  try{s.recognition.onresult=s.recognition.onerror=s.recognition.onend=null;s.recognition.abort()}catch(_){}
  if(s.button?.isConnected){s.button.classList.remove('is-listening');s.button.setAttribute('aria-pressed','false');}
  if(s.status?.isConnected)s.status.textContent='';
}
function activeLanguage(){
  return document.documentElement.lang?.toLowerCase().startsWith('ar')?'ar-EG':'en-US';
}
function setText(input,value){
  input.value=value.slice(0,Number(input.maxLength)>0?input.maxLength:10000);
  input.dispatchEvent(new Event('input',{bubbles:true}));
}
function start(input,button,status){
  if(active?.input===input){stop();return}
  stop();
  if(!speechCtor){status.textContent=label('التعرف على الصوت غير مدعوم في المتصفح ده.','Speech recognition is not supported in this browser.');return}
  let recog;
  try{recog=new speechCtor()}catch(_){status.textContent=label('تعذر تشغيل الميكروفون.','Could not start microphone.');return}
  recog.lang=activeLanguage();recog.continuous=true;recog.interimResults=true;recog.maxAlternatives=1;
  const s={input,button,status,recognition:recog,stopped:false,timer:null,committed:input.value.trim(),sessionFinal:'',starting:false};
  active=s;
  button.classList.add('is-listening');button.setAttribute('aria-pressed','true');
  status.textContent=label('جاري الاستماع… اضغط المايك للإيقاف.','Listening… tap microphone to stop.');
  const join=(a,b)=>[a,b].filter(Boolean).join(a&&b?' ':'');
  recog.onresult=event=>{
    if(active!==s||s.stopped)return;
    const items=Array.from(event.results||[]);
    const finals=items.filter(v=>v.isFinal).map(v=>v[0]?.transcript||'').join(' ').trim();
    const pending=items.filter(v=>!v.isFinal).map(v=>v[0]?.transcript||'').join(' ').trim();
    s.sessionFinal=finals;
    setText(input,join(s.committed,join(finals,pending)));
  };
  recog.onerror=event=>{
    if(active!==s||s.stopped)return;
    const reason=String(event?.error||'');
    if(['not-allowed','service-not-allowed','audio-capture'].includes(reason)){
      stop();
      status.textContent=label('اسمح للمتصفح بالوصول للميكروفون ثم جرّب مجددًا.','Allow microphone access in browser settings, then retry.');
    }else if(reason==='network'){
      stop();
      status.textContent=label('خدمة التعرف على الصوت غير متاحة حاليًا.','Speech recognition service is unavailable.');
    }
  };
  recog.onend=()=>{
    if(active!==s||s.stopped)return;
    s.committed=join(s.committed,s.sessionFinal);
    s.sessionFinal='';
    // The browser may end recognition after silence or its own duration limit.
    // Resume only while the student explicitly wants to keep dictating.
    s.timer=setTimeout(()=>{
      if(active!==s||s.stopped||!input.isConnected){stop();return}
      try{recog.start()}catch(_){
        stop();status.textContent=label('اتوقف التعرف على الصوت. اضغط المايك للمحاولة تاني.','Speech recognition stopped. Tap the mic to retry.');
      }
    },450);
  };
  try{recog.start()}catch(_){stop();status.textContent=label('تعذر بدء التسجيل.','Could not start speech recognition.')}
}
function mount(input){
  const form=input.closest('form');if(!form||form.querySelector('.neis-voice-controls'))return;
  const wrap=document.createElement('span');wrap.className='neis-voice-controls';
  const mic=document.createElement('button');mic.type='button';mic.className='neis-voice-mic ttai-mic';
  mic.setAttribute('aria-label',label('بدء أو إيقاف الإملاء الصوتي','Start or stop voice dictation'));
  mic.setAttribute('aria-pressed','false');
  mic.title=label('اضغط للتحدث واضغط مجددًا للإيقاف','Tap to dictate, tap again to stop');
  mic.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>';
  const status=document.createElement('span');status.className='neis-voice-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  mic.addEventListener('click',()=>start(input,mic,status));
  // Prevent focus/selection loss on touch; never invoke the composer submit.
  mic.addEventListener('pointerdown',e=>e.preventDefault());
  wrap.append(mic);
  const send=form.querySelector('button[type=submit],[data-chat-send],#magnusSend');
  if(send)form.insertBefore(wrap,send);else form.append(wrap);
  form.insertAdjacentElement('afterend',status);
  form.addEventListener('submit',()=>{if(active?.input===input)stop()});
}
function scan(){
  if(active&&!active.input.isConnected)stop();
  for(const id of targets){const input=document.getElementById(id);if(input)mount(input)}
}
let queued=false;
const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;scan()})};
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan,{once:true});else scan();
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});
window.addEventListener('pagehide',stop);
})();
