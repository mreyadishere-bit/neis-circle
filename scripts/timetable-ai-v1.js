/* NEIS Circle — additive, private timetable AI sheet. Existing timetable remains unchanged.
   Requires authenticated Edge Function timetable-ai and atomic RLS-backed save RPC. */
(()=>{
"use strict";
const ID="ttAiOpen";
const editable=["title","day_of_week","start_time","end_time","location","notes","category"];
const labels={
  en:{title:"Timetable AI",intro:"Tell me about your classes or attach a schedule. I'll prepare a timetable you can review before saving.",
    attach:"Attach PDF or image",placeholder:"Ask me to create or change your timetable…",send:"Send",apply:"Save to my timetable",
    review:"Review changes",discard:"Discard draft",clear:"New chat",close:"Close",busy:"Understanding your timetable…",
    saving:"Saving your timetable…",added:"added",edited:"updated",removed:"removed",nochanges:"Your timetable has no unsaved changes.",
    privacy:"Images and schedule details are sent to Google Gemini for analysis. Avoid uploading personal details. Files aren't stored by NEIS Circle.",
    file:"Selected file:",tooLarge:"Choose a PDF or image smaller than 5 MB.",invalidFile:"Only PDF, PNG, JPG or WebP files are supported.",
    error:"Couldn't complete that request. Please retry.",success:"Your timetable was updated.",changed:"Your timetable changed elsewhere. Start a new chat to avoid overwriting changes.",
    confirm:"Save these proposed changes to your private timetable?",cancel:"Cancel",reviewTitle:"Proposed changes",pdf:"PDF or image"},
  ar:{title:"مساعد الجدول الذكي",intro:"قولّي مواعيد حصصك أو ارفع صورة أو PDF، وأنا أجهز لك جدول تراجعه قبل الحفظ.",
    attach:"إرفاق صورة أو PDF",placeholder:"اكتب حصصك أو اطلب تعديل جدولك…",send:"إرسال",apply:"حفظ في جدولي",
    review:"مراجعة التعديلات",discard:"إلغاء المسودة",clear:"محادثة جديدة",close:"إغلاق",busy:"بحلل جدولك…",
    saving:"بحفظ جدولك…",added:"إضافة",edited:"تعديل",removed:"حذف",nochanges:"مفيش تعديلات غير محفوظة.",
    privacy:"الصورة وبيانات الجدول بتتبعت لـGoogle Gemini للتحليل. متبعتش بيانات شخصية. NEIS Circle مش بيخزن الملف.",
    file:"الملف المختار:",tooLarge:"اختار صورة أو PDF أقل من 5 ميجابايت.",invalidFile:"المدعوم PDF أو PNG أو JPG أو WebP فقط.",
    error:"حصلت مشكلة في الطلب. جرّب تاني.",success:"تم تحديث جدولك.",changed:"الجدول اتغير من مكان تاني. ابدأ محادثة جديدة عشان متفقدش أي تعديلات.",
    confirm:"تحفظ التعديلات دي على جدولك الخاص؟",cancel:"إلغاء",reviewTitle:"التعديلات المقترحة",pdf:"صورة أو PDF"}
};
const stateAI={user:"",open:false,busy:false,saving:false,panel:null,history:[],draft:null,original:[],baseline:[],
  source:[],file:null,preview:false,scheduled:false};
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
    stateAI.history=[];stateAI.source=[];stateAI.file=null;stateAI.preview=false;
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
function tmpKey(){return "tmp_"+crypto.randomUUID()}
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
  const close=el("button","ttai-icon-btn","×");
  close.type="button";close.setAttribute("aria-label",t("close"));
  close.onclick=()=>{stateAI.open=false;draw()};
  head.append(title,close);panel.append(head);
  const chat=el("div","ttai-chat");
  chat.setAttribute("role","log");chat.setAttribute("aria-live","polite");
  chat.append(message(t("intro"),"assistant"));
  for(const m of stateAI.history)chat.append(message(m.text,m.role));
  if(stateAI.busy)chat.append(message(t("busy"),"pending"));
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
    const discard=el("button","ttai-link",t("discard"));
    discard.type="button";discard.disabled=stateAI.busy||stateAI.saving;
    discard.onclick=()=>{stateAI.draft=structuredClone(stateAI.original);stateAI.preview=false;draw()};
    bar.append(discard);panel.append(bar);
  }
  const footer=el("div","ttai-footer");
  const fileLabel=el("span","ttai-file-name",stateAI.file?t("file")+" "+stateAI.file.name:"");
  footer.append(fileLabel);
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
  footer.append(compose,el("p","ttai-privacy",t("privacy")));
  panel.append(footer);
  chat.scrollTop=chat.scrollHeight;
}
function setFile(file){
  if(!["application/pdf","image/png","image/jpeg","image/webp"].includes(file.type)){
    alertUser(t("invalidFile"));return;
  }
  if(file.size>5*1024*1024){alertUser(t("tooLarge"));return}
  stateAI.file=file;draw();
}
async function toData(file){
  // File never goes to Supabase Storage; sent only to the authenticated AI function.
  if(file.type.startsWith("image/")&&file.size>1600000){
    const bitmap=await createImageBitmap(file);
    const ratio=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement("canvas");
    canvas.width=Math.round(bitmap.width*ratio);
    canvas.height=Math.round(bitmap.height*ratio);
    canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);
    bitmap.close();
    const compressed=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.9));
    if(compressed&&compressed.size<file.size)file=compressed;
  }
  const data=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(",")[1]||"");
    reader.onerror=()=>reject(new Error("Read failed"));
    reader.readAsDataURL(file);
  });
  return {mime:file.type,data};
}
async function submit(text){
  if(stateAI.busy||stateAI.saving)return;
  const file=stateAI.file;
  stateAI.busy=true;
  const prior=stateAI.history.map(x=>({role:x.role,text:x.text}));
  stateAI.history.push({role:"user",text:text+(file?(text?" · ":"")+file.name:"")});
  draw();
  try{
    const body={message:text,draft:stateAI.draft,source:stateAI.source,history:prior};
    if(file)body.file=await toData(file);
    const {data,error}=await sb.functions.invoke("timetable-ai",{body});
    if(error||!data||!Array.isArray(data.entries)){
      let description=data?.error||"";
      if(error?.context?.json){
        const details=await error.context.json().catch(()=>null);
        description=details?.error||description;
      }
      throw new Error(description||error?.message||t("error"));
    }
    if(data.changed)stateAI.draft=normalizeDraft(data.entries);
    if(Array.isArray(data.extracted))stateAI.source=data.extracted.slice(0,80);
    stateAI.history.push({role:"assistant",text:String(data.reply||"").slice(0,1200)});
    stateAI.file=null;
  }catch(e){
    stateAI.history.push({role:"assistant",text:e.message||t("error")});
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
    begin(true);
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
document.addEventListener("DOMContentLoaded",()=>{
  const root=document.querySelector("#view")||document.body;
  new MutationObserver(scheduleMount).observe(root,{childList:true});
  scheduleMount();
});
})();
