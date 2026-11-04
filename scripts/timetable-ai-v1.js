/* NEIS Circle — additive, private timetable AI sheet. Existing timetable remains unchanged.
   Requires authenticated Edge Function timetable-ai and atomic RLS-backed save RPC. */
(()=>{
"use strict";
if(typeof window!=="undefined"){
  if(window.__neisTimetableAiMounted)return;
  window.__neisTimetableAiMounted="timetable-ai-v1";
}
const ID="ttAiOpen";
const editable=["title","day_of_week","start_time","end_time","location","notes","category"];
const labels={
  en:{title:"Timetable AI",intro:"Tell me about your classes or attach a schedule. I'll prepare a timetable you can review before saving.",
    attach:"Attach PDF or image",placeholder:"Ask about your timetable…",send:"Send",apply:"Save to my timetable",
    review:"Review changes",discard:"Discard draft",undo:"Undo",clear:"New chat",close:"Close",busy:"Understanding your timetable…",thinking:"Thinking about your question…",voice:"Speak your message",voiceStop:"Stop dictation",voiceListening:"Listening…",voiceUnsupported:"Speech-to-text is not supported in this browser. You can use your keyboard microphone.",voiceDenied:"Microphone permission was denied. Please allow microphone access in your browser.",voiceError:"Could not recognize speech. Please try again.",
    saving:"Saving your timetable…",added:"added",edited:"updated",removed:"removed",nochanges:"Your timetable has no unsaved changes.",
    privacy:"AI timetable requests and attached PDF/image schedules are processed by Google Gemini (gemini-3.8-flash). Avoid including names or other identifying details. Uploaded files are not stored in NEIS Circle.",
    file:"Selected file:",tooLarge:"Choose a PDF or image smaller than 15 MB.",invalidFile:"Only PDF, PNG, JPG or WebP files are supported.",
    error:"Couldn't complete that request. Please retry.",retry:"Retry",removeFile:"Remove attachment",info:"AI data handling",success:"Your timetable was updated.",changed:"Your timetable changed elsewhere. Start a new chat to avoid overwriting changes.",
    confirm:"Save these proposed changes to your private timetable?",cancel:"Cancel",reviewTitle:"Proposed changes",pdf:"PDF or image"},
  ar:{title:"مساعد الجدول الذكي",intro:"قولّي مواعيد حصصك أو ارفع صورة أو PDF، وأنا أجهز لك جدول تراجعه قبل الحفظ.",
    attach:"إرفاق صورة أو PDF",placeholder:"اسأل عن جدولك أو عدّله…",send:"إرسال",apply:"حفظ في جدولي",
    review:"مراجعة التعديلات",discard:"إلغاء المسودة",undo:"تراجع",clear:"محادثة جديدة",close:"إغلاق",busy:"بحلل جدولك…",thinking:"بجهّز إجابة لسؤالك…",voice:"إملاء صوتي",voiceStop:"إيقاف الإملاء",voiceListening:"بسمعك…",voiceUnsupported:"المتصفح لا يدعم تحويل الصوت إلى نص. ممكن تستخدم ميكروفون لوحة المفاتيح.",voiceDenied:"اسمح باستخدام الميكروفون من إعدادات المتصفح.",voiceError:"لم أتمكن من تحويل الكلام إلى نص. جرّب مرة تانية.",
    saving:"بحفظ جدولك…",added:"إضافة",edited:"تعديل",removed:"حذف",nochanges:"مفيش تعديلات غير محفوظة.",
    privacy:"الرسائل وملفات الجدول (PDF أو صور) بتتبعت لـGoogle Gemini (gemini-3.8-flash) للمعالجة البصرية المباشرة. تجنب البيانات الشخصية. NEIS Circle مش بيخزن الملفات المرفوعة.",
    file:"الملف المختار:",tooLarge:"اختار صورة أو PDF أقل من 15 ميجابايت.",invalidFile:"المدعوم PDF أو PNG أو JPG أو WebP فقط.",
    error:"حصلت مشكلة في الطلب. جرّب تاني.",retry:"إعادة المحاولة",removeFile:"إزالة الملف",info:"خصوصية مساعد الجدول",success:"تم تحديث جدولك.",changed:"الجدول اتغير من مكان تاني. ابدأ محادثة جديدة عشان متفقدش أي تعديلات.",
    confirm:"تحفظ التعديلات دي على جدولك الخاص؟",cancel:"إلغاء",reviewTitle:"التعديلات المقترحة",pdf:"صورة أو PDF"}
};
const stateAI={user:"",open:false,busy:false,saving:false,panel:null,history:[],draft:null,draftHistory:[],original:[],baseline:[],
  source:[],file:null,preview:false,scheduled:false,privacyOpen:false,lastFailed:null,voiceRecognition:null,advicePending:false};
function stopVoice(){
  const recognition=stateAI.voiceRecognition;
  stateAI.voiceRecognition=null;
  if(recognition){
    recognition.onresult=null;
    recognition.onerror=null;
    recognition.onend=null;
    try{recognition.abort()}catch(_){}
  }
}
function isAdviceQuestion(text,file){
  return !file && /(?:\b(?:how|help|tips?|advice|recommend|suggest|explain|best|ways?|manage|organize|organise|balance|prioritize|improve)\b|إزاي|كيف|ساعدني|نصائح|أفضل طريقة|أنظم|تنظيم)/i.test(text) &&
    /(?:\b(?:manage|organize|organise|plan|balance|study|time|timetable|schedule|revision|classes|focus|productivity)\b|ذاكر|تنظيم|جدول|مذاكرة|وقت|دراسة)/i.test(text);
}
function lang(){return typeof state!=="undefined"&&state.lang==="ar"?"ar":"en"}
function t(k){return labels[lang()][k]}
function isTimetable(){return typeof state!=="undefined" && state.view==="timetable"&&
  state.onboardingComplete===true&&state.timetable?.ready===true&&
  typeof authUser!=="undefined"&&!!authUser?.id}
function rows(){return (state.timetable?.rows||[]).map(r=>({
  key:String(r.id),title:r.title,day_of_week:Number(r.day_of_week),
  start_time:String(r.start_time).slice(0,5),end_time:String(r.end_time).slice(0,5),
  location:r.location||"",notes:r.notes||"",category:r.category||"Class"
}))}
function begin(reset=false){
  const uid=String(authUser.id);
  if(uid!==stateAI.user||reset||stateAI.draft===null){
    stateAI.user=uid;
    stateAI.original=rows();
    stateAI.baseline=(state.timetable.rows||[]).map(r=>({id:r.id,updated_at:r.updated_at}));
    stateAI.draft=structuredClone(stateAI.original);
    stateAI.draftHistory=[];
    stateAI.history=[];stateAI.source=[];stateAI.file=null;stateAI.preview=false;stateAI.lastFailed=null;
  }
}
function diff(){
  if(!stateAI.draft)return {add:[],update:[],remove:[]};
  const before=new Map(stateAI.original.map(r=>[r.key,r]));
  const after=new Set(stateAI.draft.map(r=>r.key));
  const add=[],update=[],remove=[];
  for(const r of stateAI.draft){
    const old=before.get(r.key);
    if(!old){add.push(r);continue}
    if(editable.some(k=>String(old[k])!==String(r[k])))update.push(r);
  }
  for(const r of stateAI.original)if(!after.has(r.key))remove.push(r);
  return {add,update,remove};
}
function total(d){return d.add.length+d.update.length+d.remove.length}
function tmpKey(){
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
  return "tmp_"+Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join("");
}
function normalizeDraft(input){
  if(!Array.isArray(input)||input.length>80)throw new Error("Invalid proposal");
  const saved=new Set(stateAI.original.map(r=>r.key));
  const pending=new Set((stateAI.draft||[]).map(r=>r.key));
  const used=new Set();
  return input.map(raw=>{
    const key=String(raw.key||"");
    const assigned=(saved.has(key)||pending.has(key))?key:tmpKey();
    if(used.has(assigned))throw new Error("Repeated entry");
    used.add(assigned);
    const start=String(raw.start_time||"").slice(0,5);
    const end=String(raw.end_time||"").slice(0,5);
    const day=Number(raw.day_of_week);
    if(!Number.isInteger(day)||day<0||day>6||!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||
       !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||end<=start||!String(raw.title||"").trim())
      throw new Error("Incomplete entry");
    return {key:assigned,title:String(raw.title).trim().slice(0,100),day_of_week:day,
      start_time:start,end_time:end,category:String(raw.category||"Class"),
      location:String(raw.location||"").slice(0,120),notes:String(raw.notes||"").slice(0,1000)};
  });
}
function el(tag,cls,textValue){
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(textValue!=null)node.textContent=textValue;
  return node;
}
function message(body,role){
  const p=el("div","ttai-bubble ttai-"+role);
  const plain=String(body??"");
  if(role==="assistant"){
    // Safe formatting for Gemini's short Markdown emphasis. Only create
    // text nodes and strong elements; never inject model-generated HTML.
    for(const chunk of plain.split(/(\\*\\*[^*\\n]{1,140}\\*\\*)/g)){
      if(/^\\*\\*[^*\\n]{1,140}\\*\\*$/.test(chunk)){
        const strong=document.createElement("strong");
        strong.textContent=chunk.slice(2,-2);
        p.appendChild(strong);
      }else if(chunk)p.appendChild(document.createTextNode(chunk));
    }
  }else p.textContent=plain;
  return p;
}
function syncMobileViewport(){
  const panel=stateAI.panel;
  if(!panel||!stateAI.open)return;
  const mobile=window.matchMedia("(max-width:760px)").matches;
  if(!mobile){
    panel.style.removeProperty("--ttai-visible-height");
    panel.style.removeProperty("--ttai-visible-top");
    return;
  }
  const viewport=window.visualViewport;
  const height=viewport?viewport.height:window.innerHeight;
  const top=viewport?viewport.offsetTop:0;
  panel.style.setProperty("--ttai-visible-height",Math.max(250,Math.round(height))+"px");
  panel.style.setProperty("--ttai-visible-top",Math.max(0,Math.round(top))+"px");
}
function setMobileOpenState(open){
  document.body.classList.toggle("ttai-mobile-open",!!open&&window.matchMedia("(max-width:760px)").matches);
}
function dayName(n){
  const ds=lang()==="ar"?["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"]:
    ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  return ds[Number(n)]||"";
}
function rowText(r){return dayName(r.day_of_week)+" · "+r.start_time+"–"+r.end_time+" · "+r.title+
  (r.location?" · "+r.location:"")}
function alertUser(msg){
  if(typeof toast==="function")toast(msg);
  else window.alert(msg);
}
function ensurePanel(){
  if(stateAI.panel)return stateAI.panel;
  const panel=el("section","ttai-panel");
  panel.id="ttAiPanel";panel.setAttribute("role","dialog");
  panel.setAttribute("aria-label",t("title"));panel.setAttribute("aria-modal","false");
  panel.hidden=true;
  document.body.appendChild(panel);
  stateAI.panel=panel;
  return panel;
}
function draw(){
  stopVoice();
  const panel=ensurePanel();
  if(!stateAI.open){
    panel.hidden=true;
    setMobileOpenState(false);
    panel.style.removeProperty("--ttai-visible-height");
    panel.style.removeProperty("--ttai-visible-top");
    return;
  }
  panel.hidden=false;
  setMobileOpenState(true);
  syncMobileViewport();
  panel.dir=lang()==="ar"?"rtl":"ltr";
  panel.setAttribute("aria-label",t("title"));
  panel.replaceChildren();
  const head=el("header","ttai-header");
  const title=el("div","ttai-heading");
  title.append(el("span","ttai-mark","✦"),el("strong",null,t("title")));
  const clearBtn=el("button","ttai-link",t("clear"));
  clearBtn.type="button";clearBtn.disabled=stateAI.busy||stateAI.saving;
  clearBtn.onclick=()=>{begin(true);draw()};
  const info=el("button","ttai-info-btn","ⓘ");
  info.type="button";info.setAttribute("aria-label",t("info"));info.title=t("info");
  info.setAttribute("aria-expanded",String(stateAI.privacyOpen));
  info.onclick=()=>{stateAI.privacyOpen=!stateAI.privacyOpen;draw()};
  const close=el("button","ttai-icon-btn","×");
  close.type="button";close.setAttribute("aria-label",t("close"));
  close.onclick=()=>{stateAI.open=false;draw()};
  const controls=el("div","ttai-header-controls");controls.append(clearBtn,info,close);
  head.append(title,controls);panel.append(head);
  if(stateAI.privacyOpen)panel.append(el("p","ttai-privacy-info",t("privacy")));
  const chat=el("div","ttai-chat");
  chat.setAttribute("role","log");chat.setAttribute("aria-live","polite");
  chat.append(message(t("intro"),"assistant"));
  for(const m of stateAI.history)chat.append(message(m.text,m.role));
  if(stateAI.busy)chat.append(message(t(stateAI.advicePending?"thinking":"busy"),"pending"));
  if(stateAI.lastFailed && !stateAI.busy){
    const retry=el("button","ttai-retry",t("retry"));
    retry.type="button";
    retry.onclick=()=>{const draft=stateAI.lastFailed;if(draft.file&&!stateAI.file)stateAI.file=draft.file;void submit(draft.text,true)};
    chat.append(retry);
  }
  panel.append(chat);
  const changes=diff();
  if(total(changes)>0){
    const bar=el("div","ttai-reviewbar");
    const summary=el("button","ttai-review-toggle",t("review")+" · +"+changes.add.length+
      " / ~"+changes.update.length+" / −"+changes.remove.length);
    summary.type="button";summary.onclick=()=>{stateAI.preview=!stateAI.preview;draw()};
    bar.append(summary);
    if(stateAI.preview){
      const items=el("div","ttai-diff");
      for(const [group,tag] of [["add","+"],["update","~"],["remove","−"]]){
        for(const row of changes[group]){
          const line=el("div","ttai-diff-row");
          line.append(el("span","ttai-diff-tag",tag),el("span",null,rowText(row)));
          items.append(line);
        }
      }
      bar.append(items);
    }
    const action=el("button","ttai-apply",stateAI.saving?t("saving"):t("apply"));
    action.type="button";action.disabled=stateAI.busy||stateAI.saving;action.onclick=()=>{void applyPlan()};
    bar.append(action);
    if(stateAI.draftHistory.length>0){
      const undoBtn=el("button","ttai-link",t("undo"));
      undoBtn.type="button";undoBtn.disabled=stateAI.busy||stateAI.saving;
      undoBtn.onclick=()=>{
        const prev=stateAI.draftHistory.pop();
        if(prev){stateAI.draft=prev;draw()}
      };
      bar.append(undoBtn);
    }
    const discard=el("button","ttai-link",t("discard"));
    discard.type="button";discard.disabled=stateAI.busy||stateAI.saving;
    discard.onclick=()=>{stateAI.draft=structuredClone(stateAI.original);stateAI.draftHistory=[];stateAI.preview=false;draw()};
    bar.append(discard);panel.append(bar);
  }
  const footer=el("div","ttai-footer");
  const fileLabel=el("span","ttai-file-name",stateAI.file?t("file")+" "+stateAI.file.name:"");
  footer.append(fileLabel);
  if(stateAI.file){
    const remove=el("button","ttai-file-remove","×");
    remove.type="button";remove.title=t("removeFile");
    remove.setAttribute("aria-label",t("removeFile"));
    remove.onclick=()=>{stateAI.file=null;draw()};
    footer.append(remove);
  }
  const compose=el("form","ttai-compose");
  const attach=el("label","ttai-attach","＋");
  attach.title=t("attach");attach.setAttribute("aria-label",t("attach"));
  const fileInput=el("input");fileInput.type="file";
  fileInput.accept=".pdf,application/pdf,image/png,image/jpeg,image/webp";
  fileInput.setAttribute("aria-label",t("attach"));
  fileInput.onchange=()=>{const f=fileInput.files?.[0];if(f)setFile(f)};
  attach.append(fileInput);
  const input=el("textarea","ttai-input");
  input.rows=1;input.maxLength=1600;input.placeholder=t("placeholder");
  input.setAttribute("aria-label",t("placeholder"));
  // Single-line placeholder; grow real typed messages up to four lines.
  // Prevent Android's native textarea resize grip and half-hidden second row.
  input.addEventListener("input",()=>{
    input.style.height="40px";
    const contentHeight=Math.min(102,Math.max(40,input.scrollHeight));
    input.style.height=contentHeight+"px";
    input.style.overflowY=input.scrollHeight>102?"auto":"hidden";
  });
  input.onkeydown=event=>{
    if(event.key==="Enter"&&!event.shiftKey){
      event.preventDefault();
      if(!stateAI.busy&&!stateAI.saving)compose.requestSubmit();
    }
  };
  const speechConstructor=typeof window!=="undefined"?
    (window.SpeechRecognition||window.webkitSpeechRecognition):null;
  const mic=el("button","ttai-mic");
  mic.type="button";
  mic.setAttribute("aria-label",t("voice"));
  mic.title=speechConstructor?t("voice"):t("voiceUnsupported");
  mic.disabled=stateAI.busy||stateAI.saving||!speechConstructor;
  // Lucide-style outline microphone matches the existing minimal UI.
  mic.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>';
  const voiceStatus=el("span","ttai-speech-status");
  voiceStatus.setAttribute("role","status");
  voiceStatus.setAttribute("aria-live","polite");
  mic.onclick=()=>{
    if(stateAI.voiceRecognition){
      stopVoice();
      mic.classList.remove("is-listening");
      mic.setAttribute("aria-label",t("voice"));
      mic.title=t("voice");
      voiceStatus.textContent="";
      return;
    }
    if(!speechConstructor)return;
    let recognition;
    try{recognition=new speechConstructor()}catch(_){voiceStatus.textContent=t("voiceError");return}
    recognition.lang=lang()==="ar"?"ar-EG":"en-US";
    recognition.continuous=false;
    recognition.interimResults=true;
    recognition.maxAlternatives=1;
    const initial=input.value.trim();
    stateAI.voiceRecognition=recognition;
    mic.classList.add("is-listening");
    mic.setAttribute("aria-label",t("voiceStop"));
    mic.title=t("voiceStop");
    voiceStatus.textContent=t("voiceListening");
    recognition.onresult=event=>{
      if(stateAI.voiceRecognition!==recognition)return;
      const spoken=Array.from(event.results||[]).map(item=>item[0]?.transcript||"").join(" ").trim();
      input.value=[initial,spoken].filter(Boolean).join(" ").slice(0,input.maxLength);
      input.dispatchEvent(new Event("input",{bubbles:true}));
      // Deliberately do not submit; students must review recognized words.
    };
    recognition.onerror=event=>{
      if(stateAI.voiceRecognition!==recognition)return;
      voiceStatus.textContent=event.error==="not-allowed"||event.error==="service-not-allowed"?t("voiceDenied"):
        event.error==="no-speech"?"":t("voiceError");
    };
    recognition.onend=()=>{
      if(stateAI.voiceRecognition!==recognition)return;
      stateAI.voiceRecognition=null;
      mic.classList.remove("is-listening");
      mic.setAttribute("aria-label",t("voice"));
      mic.title=t("voice");
      if(voiceStatus.textContent===t("voiceListening"))voiceStatus.textContent="";
    };
    try{recognition.start()}catch(_){
      stateAI.voiceRecognition=null;
      mic.classList.remove("is-listening");
      mic.setAttribute("aria-label",t("voice"));
      voiceStatus.textContent=t("voiceError");
    }
  };
  const send=el("button","ttai-send","➤");
  send.type="submit";send.title=t("send");send.setAttribute("aria-label",t("send"));
  send.disabled=stateAI.busy||stateAI.saving;
  compose.append(attach,input,mic,send);
  compose.onsubmit=event=>{
    event.preventDefault();const text=input.value.trim();
    if(!text&&!stateAI.file)return;
    // Sending from a touch/mobile viewport must not reopen the soft keyboard.
    if(window.matchMedia('(max-width:760px)').matches||document.documentElement.classList.contains('neis-native-app'))input.blur();
    void submit(text);
  };
  footer.append(compose,voiceStatus);
  panel.append(footer);
  // Keep the message pane independently scrollable. A visualViewport resize
  // must resize this pane, never drag the entire page or hide the AI messages.
  chat.scrollTop=chat.scrollHeight;
}
function setFile(file){
  if(!["application/pdf","image/png","image/jpeg","image/webp"].includes(file.type)){
    alertUser(t("invalidFile"));return;
  }
  if(file.size>15*1024*1024){alertUser(t("tooLarge"));return}
  stateAI.file=file;draw();
}
async function readData(blob){
  return await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(",")[1]||"");
    reader.onerror=()=>reject(new Error("Read failed"));
    reader.readAsDataURL(blob);
  });
}
async function toData(file){
  // Send the original PDF or image directly to Gemini 3.8 Flash native multimodal document/vision input.
  // Never flatten PDFs into plain text or lose visual table layout.
  const data=await readData(file);
  const mimeType=file.type||"application/pdf";
  return {
    attachments:[{
      name:file.name||(mimeType==="application/pdf"?"timetable.pdf":"timetable-image"),
      mimeType,
      data
    }]
  };
}
// Keep the chat responsive even if a large PDF or the Edge relay stalls.
// Supabase supports AbortSignal; Promise.race is a second safety net if
// a browser/network implementation ignores the abort request.
const AI_REQUEST_DEADLINE_MS=95000;
async function invokeWithDeadline(body){
  const controller=new AbortController();
  let deadline;
  const timeout=new Promise((_,reject)=>{
    deadline=setTimeout(()=>{
      // Reject first so an AbortError from the SDK cannot hide our
      // helpful timeout message or cause the UI to remain pending.
      reject(new Error(lang()==="ar"
        ?"استغرق تحليل الجدول وقتًا أطول من المتوقع. أعد المحاولة؛ الملف والرسالة ما زالا محفوظين."
        :"Timetable analysis timed out. Please retry; your PDF and message are preserved."));
      controller.abort();
    },AI_REQUEST_DEADLINE_MS);
  });
  try{
    return await Promise.race([
      sb.functions.invoke("timetable-ai",{body,signal:controller.signal}),
      timeout
    ]);
  }finally{
    clearTimeout(deadline);
  }
}
async function submit(text,retrying=false){
  if(stateAI.busy||stateAI.saving)return;
  const file=stateAI.file;
  stopVoice();
  stateAI.advicePending=isAdviceQuestion(text,file);
  stateAI.busy=true;
  if(retrying && stateAI.lastFailed){
    // Do not duplicate a failed prompt in conversational memory.
    stateAI.history=stateAI.history.filter(x=>!x.isError && !x.failedPrompt);
  }
  const prior=stateAI.history.filter(x=>!x.isError).map(x=>({role:x.role,text:x.text,content:x.text}));
  const prevDraft=stateAI.draftHistory.length>0?stateAI.draftHistory[stateAI.draftHistory.length-1]:null;
  stateAI.lastFailed=null;
  stateAI.history.push({role:"user",text:text+(file?(text?" · ":"")+file.name:""),failedPrompt:true});
  draw();
  try{
    const body={
      message:text,
      prompt:text,
      lang:lang(),
      currentEntries:stateAI.original,
      draft:stateAI.draft,
      draftEntries:stateAI.draft,
      previousDraftEntries:prevDraft,
      source:stateAI.source,
      extracted:stateAI.source,
      history:prior,
      messages:prior
    };
    if(file)Object.assign(body,await toData(file));
    const {data,error}=await invokeWithDeadline(body);
    if(error||!data||!Array.isArray(data.entries)){
      let description=data?.error||"";
      if(error?.context?.json){
        const details=await error.context.json().catch(()=>null);
        description=details?.error||description;
      }
      throw new Error(description||error?.message||t("error"));
    }
    if(data.changed){
      if(stateAI.draft)stateAI.draftHistory.push(structuredClone(stateAI.draft));
      stateAI.draft=normalizeDraft(data.entries);
    }
    if(Array.isArray(data.extracted))stateAI.source=data.extracted.slice(0,80);
    else if(data.extracted&&typeof data.extracted==="object")stateAI.source=data.extracted;
    stateAI.history.push({role:"assistant",text:String(data.reply||"").slice(0,5000)});
    stateAI.history[stateAI.history.length-2].failedPrompt=false;
    stateAI.file=null;
  }catch(e){
    stateAI.lastFailed={text,file};
    const safe=String(e?.message||t("error"));
    stateAI.history.push({role:"assistant",text:safe,isError:true});
  }finally{
    stateAI.busy=false;stateAI.advicePending=false;draw();
  }
}
async function applyPlan(){
  if(stateAI.busy||stateAI.saving)return;
  const d=diff();if(!total(d))return;
  stateAI.preview=true;draw();
  if(!window.confirm(t("confirm")))return;
  stateAI.saving=true;draw();
  try{
    const {data,error}=await sb.rpc("apply_timetable_ai_plan",{
      p_plan:stateAI.draft,p_expected:stateAI.baseline
    });
    if(error||!Array.isArray(data))throw new Error(error?.message||t("error"));
    // Update native timetable data; native renderer & realtime use the same RLS records.
    state.timetable.rows=data;
    state.timetable.ready=true;
    const previousHistory=stateAI.history;
    const previousSource=stateAI.source;
    begin(true);
    stateAI.history=previousHistory;
    stateAI.source=previousSource;
    stateAI.history.push({role:"assistant",text:t("success")});
    alertUser(t("success"));
    if(typeof render==="function")render();
  }catch(e){alertUser((/changed|تغير/i.test(e.message))?t("changed"):(e.message||t("error")))}
  finally{stateAI.saving=false;draw()}
}
function openPanel(){
  if(!isTimetable())return;
  begin();
  stateAI.open=true;draw();
  const field=stateAI.panel?.querySelector("textarea");
  if(field && !window.matchMedia("(max-width:760px)").matches)field.focus({preventScroll:true});
}
function mount(){
  if(!isTimetable()){
    if(stateAI.open){stateAI.open=false;draw()}
    return;
  }
  const actions=document.querySelector("#view .tt-head-actions");
  if(!actions||document.getElementById(ID))return;
  const button=el("button","secondary ttai-launch","✦ AI");
  button.id=ID;button.type="button";button.setAttribute("aria-label",t("title"));
  button.title=t("title");
  button.onclick=openPanel;
  actions.insertBefore(button,actions.firstChild);
}
function scheduleMount(){
  if(stateAI.scheduled)return;
  stateAI.scheduled=true;
  requestAnimationFrame(()=>{stateAI.scheduled=false;mount()});
}
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&stateAI.open){stateAI.open=false;draw()}
});
function start(){
  const root=document.querySelector("#view")||document.body;
  new MutationObserver(scheduleMount).observe(root,{childList:true});
  // The software keyboard changes visualViewport rather than the layout
  // viewport on Android. Keep the modal inside the visible region.
  if(window.visualViewport){
    window.visualViewport.addEventListener("resize",syncMobileViewport,{passive:true});
    window.visualViewport.addEventListener("scroll",syncMobileViewport,{passive:true});
  }
  window.addEventListener?.("resize",syncMobileViewport,{passive:true});
  scheduleMount();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
else start();
})();
