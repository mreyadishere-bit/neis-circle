/* NEIS Circle — additive, private timetable AI sheet. Existing timetable remains unchanged.
   Requires authenticated Edge Function timetable-ai and atomic RLS-backed save RPC. */
(()=>{
"use strict";
if(typeof window!=="undefined"){
  if(window.__neisTimetableAiMounted)return;
  window.__neisTimetableAiMounted="timetable-ai-v1";
}
const ID="ttAiOpen";
const editable=["title","day_of_week","start_time","end_time","location","notes","category","color"];
const SUBJECT_COLORS=["#2f7db8","#7a52d8","#10a879","#efb83f","#ec6fb7","#e56d57","#5e6a78","#22a6b3"];
function subjectKey(title){return String(title||"").normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase()}
function suggestedColor(subject,index=0){
  const k=subjectKey(subject);
  if(/math|رياض/.test(k))return "#2f7db8";
  if(/phys|فيزي/.test(k))return "#7a52d8";
  if(/\bict\b|computer|حاسب|تكنولوج/.test(k))return "#10a879";
  if(/english|انجلي/.test(k))return "#efb83f";
  if(/religion|دين/.test(k))return "#5e6a78";
  return SUBJECT_COLORS[index%SUBJECT_COLORS.length];
}
const labels={
  en:{title:"Timetable AI",intro:"Tell me about your classes or attach a schedule. I'll prepare a timetable you can review before saving.",
    attach:"Attach PDF or image",placeholder:"Ask me to create or change your timetable…",send:"Send",apply:"Save to my timetable",
    review:"Review changes",discard:"Discard draft",undo:"Undo",clear:"New chat",close:"Close",busy:"Understanding your timetable…",
    saving:"Saving your timetable…",added:"added",edited:"updated",removed:"removed",nochanges:"Your timetable has no unsaved changes.",
    privacy:"AI timetable requests and attached PDF/image schedules are processed by Cloudflare Workers AI (Llama 4 Scout). Avoid including names or other identifying details. Uploaded files are not stored in NEIS Circle.",
    file:"Selected file:",tooLarge:"Choose a PDF or image smaller than 15 MB.",invalidFile:"Only PDF, PNG, JPG or WebP files are supported.",
    error:"Couldn't complete that request. Please retry.",retry:"Retry",removeFile:"Remove attachment",info:"AI data handling",success:"Your timetable was updated.",changed:"Your timetable changed elsewhere. Start a new chat to avoid overwriting changes.",
    confirm:"Save these proposed changes to your private timetable?",cancel:"Cancel",reviewTitle:"Proposed changes",pdf:"PDF or image"},
  ar:{title:"مساعد الجدول الذكي",intro:"قولّي مواعيد حصصك أو ارفع صورة أو PDF، وأنا أجهز لك جدول تراجعه قبل الحفظ.",
    attach:"إرفاق صورة أو PDF",placeholder:"اكتب حصصك أو اطلب تعديل جدولك…",send:"إرسال",apply:"حفظ في جدولي",
    review:"مراجعة التعديلات",discard:"إلغاء المسودة",undo:"تراجع",clear:"محادثة جديدة",close:"إغلاق",busy:"بحلل جدولك…",
    saving:"بحفظ جدولك…",added:"إضافة",edited:"تعديل",removed:"حذف",nochanges:"مفيش تعديلات غير محفوظة.",
    privacy:"الرسائل وملفات الجدول (PDF أو صور) بتتبعت لـCloudflare Workers AI (Llama 4 Scout) للمعالجة البصرية المباشرة. تجنب البيانات الشخصية. NEIS Circle مش بيخزن الملفات المرفوعة.",
    file:"الملف المختار:",tooLarge:"اختار صورة أو PDF أقل من 15 ميجابايت.",invalidFile:"المدعوم PDF أو PNG أو JPG أو WebP فقط.",
    error:"حصلت مشكلة في الطلب. جرّب تاني.",retry:"إعادة المحاولة",removeFile:"إزالة الملف",info:"خصوصية مساعد الجدول",success:"تم تحديث جدولك.",changed:"الجدول اتغير من مكان تاني. ابدأ محادثة جديدة عشان متفقدش أي تعديلات.",
    confirm:"تحفظ التعديلات دي على جدولك الخاص؟",cancel:"إلغاء",reviewTitle:"التعديلات المقترحة",pdf:"صورة أو PDF"}
};
const stateAI={user:"",open:false,busy:false,saving:false,panel:null,history:[],draft:null,draftHistory:[],original:[],baseline:[],
  source:[],file:null,preview:false,scheduled:false,privacyOpen:false,lastFailed:null,wizard:null};
function lang(){return typeof state!=="undefined"&&state.lang==="ar"?"ar":"en"}
function t(k){return labels[lang()][k]}
function isTimetable(){return typeof state!=="undefined" && state.view==="timetable"&&
  state.onboardingComplete===true&&state.timetable?.ready===true&&
  typeof authUser!=="undefined"&&!!authUser?.id}
function rows(){return (state.timetable?.rows||[]).map(r=>({
  key:String(r.id),title:r.title,day_of_week:Number(r.day_of_week),
  start_time:String(r.start_time).slice(0,5),end_time:String(r.end_time).slice(0,5),
  location:r.location||"",notes:r.notes||"",category:r.category||"Class",color:r.color||suggestedColor(r.title)
}))}
function begin(reset=false){
  const uid=String(authUser.id);
  if(uid!==stateAI.user||reset||stateAI.draft===null){
    stateAI.user=uid;
    stateAI.original=rows();
    stateAI.baseline=(state.timetable.rows||[]).map(r=>({id:r.id,updated_at:r.updated_at}));
    stateAI.draft=structuredClone(stateAI.original);
    stateAI.draftHistory=[];
    stateAI.history=[];stateAI.source=[];stateAI.file=null;stateAI.preview=false;stateAI.lastFailed=null;stateAI.wizard=null;
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
      location:String(raw.location||"").slice(0,120),notes:String(raw.notes||"").slice(0,1000),
      color:/^#[\da-f]{6}$/i.test(String(raw.color||""))?String(raw.color).toLowerCase():suggestedColor(raw.title)};
  });
}
function el(tag,cls,textValue){
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(textValue!=null)node.textContent=textValue;
  return node;
}
function message(body,role){
  const p=el("div","ttai-bubble ttai-"+role,body);
  return p;
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
  const panel=ensurePanel();
  if(!stateAI.open){panel.hidden=true;return}
  panel.hidden=false;
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
  if(stateAI.busy)chat.append(message(t("busy"),"pending"));
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
  input.onkeydown=event=>{
    if(event.key==="Enter"&&!event.shiftKey){
      event.preventDefault();
      if(!stateAI.busy&&!stateAI.saving)compose.requestSubmit();
    }
  };
  const send=el("button","ttai-send","➤");
  send.type="submit";send.title=t("send");send.setAttribute("aria-label",t("send"));
  send.disabled=stateAI.busy||stateAI.saving;
  compose.append(attach,input,send);
  compose.onsubmit=event=>{
    event.preventDefault();const text=input.value.trim();
    if(!text&&!stateAI.file)return;
    void submit(text);
  };
  footer.append(compose);
  panel.append(footer);
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
const PDFJS_VERSION = "5.5.207";
const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@" + PDFJS_VERSION + "/build/pdf.min.mjs";
const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@" + PDFJS_VERSION + "/build/pdf.worker.min.mjs";
const MAX_RENDERED_PAGES = 5;
let pdfjsPromise = null;
async function loadPdfRenderer(){
  if(!pdfjsPromise){
    pdfjsPromise = import(PDFJS_URL).then(module=>{
      module.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return module;
    }).catch(error=>{
      pdfjsPromise=null;
      throw new Error(lang()==="ar"?"تعذر تحميل قارئ PDF. حاول تاني أو ارفع صورة للجدول.":"Couldn't load the PDF renderer. Retry or upload a timetable image.");
    });
  }
  return pdfjsPromise;
}
async function toData(file){
  // Cloudflare vision consumes images, not native PDFs. Render locally so
  // days, grid borders, merged cells, and subject levels remain visible.
  if(file.type!=="application/pdf"){
    return {attachments:[{
      name:file.name, mimeType:file.type, data:await readData(file)
    }]};
  }
  const pdfjs=await loadPdfRenderer();
  let doc;
  try{
    const bytes=new Uint8Array(await file.arrayBuffer());
    doc=await pdfjs.getDocument({data:bytes}).promise;
    if(doc.numPages>MAX_RENDERED_PAGES){
      throw new Error(lang()==="ar"
        ?"الملف فيه أكتر من 5 صفحات. ارفع جزءًا من الجدول لا يزيد عن خمس صفحات."
        :"This PDF has more than 5 pages. Please upload a PDF containing up to five timetable pages.");
    }
    const attachments=[];
    for(let pageNum=1;pageNum<=doc.numPages;pageNum++){
      const page=await doc.getPage(pageNum);
      const original=page.getViewport({scale:1});
      const scale=Math.min(2.5,1600/original.width,2100/original.height);
      const viewport=page.getViewport({scale});
      const canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.floor(viewport.width));
      canvas.height=Math.max(1,Math.floor(viewport.height));
      const context=canvas.getContext("2d",{alpha:false});
      if(!context)throw new Error("Canvas rendering is not available");
      await page.render({canvasContext:context,viewport}).promise;
      const url=canvas.toDataURL("image/jpeg",0.78);
      canvas.width=0;canvas.height=0;page.cleanup();
      const data=url.split(",")[1]||"";
      if(!data)throw new Error("Page rendering produced an empty image.");
      attachments.push({
        name:file.name+" — page "+pageNum, mimeType:"image/jpeg", data
      });
    }
    return {attachments};
  }finally{
    if(doc)await doc.destroy();
  }
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
      sb.functions.invoke("timetable-ai-cloudflare",{body,signal:controller.signal}),
      timeout
    ]);
  }finally{
    clearTimeout(deadline);
  }
}
async function submit(text,retrying=false){
  if(stateAI.busy||stateAI.saving)return;
  const file=stateAI.file;
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
    stateAI.history.push({role:"assistant",text:String(data.reply||"").slice(0,1200)});
    stateAI.history[stateAI.history.length-2].failedPrompt=false;
    stateAI.file=null;
  }catch(e){
    stateAI.lastFailed={text,file};
    const safe=String(e?.message||t("error"));
    stateAI.history.push({role:"assistant",text:safe,isError:true});
  }finally{
    stateAI.busy=false;draw();
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
  if(field)field.focus();
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
  scheduleMount();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
else start();
})();
