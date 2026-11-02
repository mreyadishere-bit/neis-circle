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
function subjectKey(title){
  return String(title||"").normalize("NFKC").trim().replace(/\s+/g," ")
    .toLocaleLowerCase().replace(/\bgr\s*([0-9]{1,2})\b/g,"gr$1")
    .replace(/\bg\s*(11|12)\b/g,"gr$1")
    .replace(/\bl\s*([12])\b/g,"l$1");
}
function subjectBase(title){
  return subjectKey(title).replace(/\s+(?:l[12]|gr(?:11|12))$/,"").trim();
}
function matchesSelectedSubject(title,w){
  const key=subjectKey(title);
  if(w.selected.has(key))return true;
  const base=subjectBase(title);
  if(!w.selected.has(base)||base===key)return false;
  // Generic English can safely match English L1 only when that is the
  // single documented level. Never merge L1 and L2 silently.
  const levels=[...new Set(w.subjects.filter(x=>
    subjectBase(x)===base&&subjectKey(x)!==base).map(subjectKey))];
  return levels.length===1&&levels[0]===key;
}
function suggestedColor(subject,index=0){
  const k=subjectKey(subject);
  if(/math|رياض/.test(k))return "#2f7db8";
  if(/phys|فيزي/.test(k))return "#7a52d8";
  if(/\bict\b|computer|حاسب|تكنولوج/.test(k))return "#10a879";
  if(/english|انجلي/.test(k))return "#efb83f";
  if(/religion|دين/.test(k))return "#5e6a78";
  if(/french|français|فرنس/.test(k))return "#ec6fb7";
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
  source:[],file:null,preview:false,scheduled:false,privacyOpen:false,lastFailed:null,wizard:null,phase:"",abort:null,cancelled:false};
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

/* Guided import: extraction is never saved directly or filtered by the AI.
   Students choose exact subjects/levels and review each row before saving. */
function wizardText(en,ar){return lang()==="ar"?ar:en}
function normalizeSubjects(extracted){
  const seen=new Set(),subjects=[];
  const raw=[...(Array.isArray(extracted?.all_detected_subjects)?extracted.all_detected_subjects:[]),
    ...(Array.isArray(extracted?.detected_lessons)?extracted.detected_lessons.map(x=>x?.title):[])];
  for(const val of raw){
    const title=String(val||"").trim().replace(/\s+/g," ").slice(0,90);
    const key=subjectKey(title);
    if(key&&!seen.has(key)&&subjects.length<70){seen.add(key);subjects.push(title)}
  }
  return subjects;
}
function startWizard(extracted){
  const subjects=normalizeSubjects(extracted);
  const lessons=Array.isArray(extracted?.detected_lessons)?extracted.detected_lessons.filter(x=>x&&typeof x==="object").slice(0,100):[];
  const wizard={
    step:"subjects",subjects,lessons,selected:new Set(),locations:{},colors:{},mode:stateAI.original.length?"merge":"replace",
    warnings:Array.isArray(extracted?.ambiguous_items)?extracted.ambiguous_items.map(String).slice(0,20):[]
  };
  const oldUniqueSubjects=new Set(stateAI.original.map(x=>subjectKey(x.title)));
  const oldUniqueColors=new Set(stateAI.original.map(x=>String(x.color||"").toLowerCase()).filter(Boolean));
  // Early AI imports could only save the hard-coded blue SQL default.
  // Don't perpetuate that broken palette when the student re-imports.
  const legacyAllBlue=oldUniqueSubjects.size>1&&oldUniqueColors.size===1&&
    oldUniqueColors.has("#2f7db8");
  subjects.forEach((name,i)=>{
    const existing=stateAI.original.find(x=>subjectKey(x.title)===subjectKey(name));
    wizard.colors[subjectKey(name)]=(!legacyAllBlue&&existing?.color)||
      suggestedColor(name,i);
  });
  stateAI.wizard=wizard;
}
function wizardButton(label,kind,onClick,disabled=false){
  const button=el("button","ttai-wiz-btn "+(kind||""),label);
  button.type="button";button.disabled=Boolean(disabled);button.onclick=onClick;return button;
}
function wizardTitle(text,small){
  const box=el("div","ttai-wiz-title");
  box.append(el("strong",null,text));
  if(small)box.append(el("p",null,small));
  return box;
}
function wizardToolbar(panel,previous,onNext,nextDisabled){
  const foot=el("div","ttai-wiz-toolbar");
  if(previous)foot.append(wizardButton(wizardText("Back","رجوع"),"ttai-subtle",previous));
  foot.append(wizardButton(wizardText("Continue","متابعة"),"ttai-primary",onNext,Boolean(nextDisabled)));
  panel.append(foot);
}
function buildWizardDraft(){
  const w=stateAI.wizard;
  if(!w)return;
  const selected=w.selected;
  const generated=[],seen=new Set();
  for(const lesson of w.lessons){
    const key=subjectKey(lesson.title);
    if(!matchesSelectedSubject(lesson.title,w))continue;
    const day=Number(lesson.day_of_week);
    const start=String(lesson.start_time||"").slice(0,5),end=String(lesson.end_time||"").slice(0,5);
    if(!Number.isInteger(day)||day<0||day>6||!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||end<=start){
      w.warnings.push(wizardText("Unclear day or time for ","يوم أو وقت غير واضح لمادة ")+lesson.title);
      continue;
    }
    const token=day+"|"+start+"|"+end+"|"+key;
    if(seen.has(token))continue;
    seen.add(token);
    const place=String(w.locations[key]??lesson.location??"").slice(0,120);
    generated.push({
      key:tmpKey(),title:lesson.title,day_of_week:day,start_time:start,end_time:end,
      color:w.colors[key]||suggestedColor(lesson.title),location:place,
      notes:String(lesson.notes||"").slice(0,1000),category:"Class"
    });
  }
  // Never let the AI silently omit subjects chosen by the student.
  const unavailable=[...selected].filter(choice=>
    !generated.some(lesson=>subjectKey(lesson.title)===choice||
      (subjectBase(lesson.title)===choice&&matchesSelectedSubject(lesson.title,w))));
  w.missingSubjects=unavailable;
  if(unavailable.length)w.warnings.push(wizardText(
    "No readable lesson found for: ","لم أجد حصة واضحة لمادة: ")+
    unavailable.join(", ")+wizardText(". Add or verify these manually.",
      ". ضيف الحصص دي أو راجع الملف بنفسك."));
  const kept=w.mode==="merge"?structuredClone(stateAI.original):[];
  const existing=new Set(kept.map(x=>[x.day_of_week,x.start_time,x.end_time,subjectKey(x.title)].join("|")));
  const additions=generated.filter(x=>!existing.has([x.day_of_week,x.start_time,x.end_time,subjectKey(x.title)].join("|")));
  stateAI.draftHistory.push(structuredClone(stateAI.draft));
  stateAI.draft=normalizeDraft([...kept,...additions].slice(0,80));
  stateAI.preview=true;w.step="review";
}
function updateWizardRow(key,field,value){
  const row=stateAI.draft?.find(x=>x.key===key);
  if(!row)return;
  stateAI.draftHistory.push(structuredClone(stateAI.draft));
  if(field==="day_of_week")row[field]=Number(value);
  else if(field==="color")row[field]=/^#[\da-f]{6}$/i.test(value)?value:row[field];
  else row[field]=String(value).slice(0,field==="notes"?1000:120);
}
function editWizardRow(row){
  const article=el("article","ttai-wiz-lesson");
  const top=el("div","ttai-wiz-lesson-top");
  top.append(el("strong",null,row.title));
  const remove=wizardButton("×","ttai-lesson-remove",()=>{
    stateAI.draftHistory.push(structuredClone(stateAI.draft));
    stateAI.draft=stateAI.draft.filter(x=>x.key!==row.key);draw();
  });
  remove.setAttribute("aria-label",wizardText("Remove lesson","حذف الحصة"));
  top.append(remove);article.append(top);
  const form=el("div","ttai-wiz-edit-grid");
  const makeInput=(caption,type,value,field,options)=>{
    const wrap=el("label","ttai-wiz-field");
    wrap.append(el("span",null,caption));
    let input;
    if(options){
      input=el("select");
      for(const [v,label] of options){
        const option=el("option",null,label);option.value=String(v);
        option.selected=String(v)===String(value);input.append(option);
      }
    }else{
      input=el("input");input.type=type;input.value=String(value||"");
      if(type==="text")input.maxLength=120;
    }
    input.onchange=()=>{updateWizardRow(row.key,field,input.value);draw()};
    wrap.append(input);form.append(wrap);
  };
  makeInput(wizardText("Subject","المادة"),"text",row.title,"title");
  makeInput(wizardText("Day","اليوم"),"select",row.day_of_week,"day_of_week",
    Array.from({length:7},(_,n)=>[n,dayName(n)]));
  makeInput(wizardText("From","من"),"time",row.start_time,"start_time");
  makeInput(wizardText("To","إلى"),"time",row.end_time,"end_time");
  makeInput(wizardText("Where","المكان"),"text",row.location,"location");
  makeInput(wizardText("Color","اللون"),"color",row.color||suggestedColor(row.title),"color");
  makeInput(wizardText("Type","النوع"),"select",row.category||"Class","category",
    [["Class",wizardText("Class","حصة")],["Lab",wizardText("Lab","معمل")],
      ["Study",wizardText("Study","مذاكرة")],["Exam",wizardText("Exam","امتحان")],
      ["Activity",wizardText("Activity","نشاط")],["Other",wizardText("Other","أخرى")]]);
  makeInput(wizardText("Notes","ملاحظات"),"text",row.notes,"notes");
  article.append(form);
  if(!row.start_time||!row.end_time||row.end_time<=row.start_time){
    article.append(el("p","ttai-wiz-warning",wizardText("Fix this lesson's time before saving.","صحّح وقت الحصة قبل الحفظ.")));
  }
  return article;
}
function drawWizard(chat){
  const w=stateAI.wizard;
  if(!w||stateAI.busy)return;
  const panel=el("section","ttai-wizard");
  panel.setAttribute("aria-label",wizardText("Guided timetable import","إضافة الجدول بالخطوات"));
  const steps=el("div","ttai-wiz-steps");
  const labels=[wizardText("Subjects","المواد"),wizardText("Details","التفاصيل"),wizardText("Review","المراجعة")];
  const index=["subjects","details","review"].indexOf(w.step);
  labels.forEach((name,i)=>steps.append(el("span","ttai-wiz-step "+(i===index?"active":i<index?"done":""),(i+1)+" · "+name)));
  panel.append(steps);
  if(w.step==="subjects"){
    panel.append(wizardTitle(
      wizardText("Which subjects do you take?","إيه المواد اللي بتدرسها؟"),
      wizardText("Choose only your subjects. Levels like L1 and L2 stay separate. Nothing will be saved yet.",
        "اختار موادك بس. L1 وL2 مختلفين، ومفيش حاجة هتتحفظ دلوقتي.")
    ));
    if(!w.subjects.length)panel.append(el("p","ttai-wiz-warning",wizardText(
      "No subjects could be read confidently. Try a sharper scan or another PDF.",
      "مش قادر أحدد المواد بثقة. ارفع صورة أو PDF أوضح."
    )));
    const grid=el("div","ttai-wiz-subjects");
    w.subjects.forEach((name,i)=>{
      const key=subjectKey(name),on=w.selected.has(key);
      const chip=wizardButton((on?"✓  ":"")+name,"ttai-subject "+(on?"is-selected":""),()=>{
        if(w.selected.has(key))w.selected.delete(key);else w.selected.add(key);
        draw();
      });
      chip.setAttribute("aria-pressed",String(on));
      chip.style.setProperty("--subject-color",w.colors[key]||suggestedColor(name,i));
      grid.append(chip);
    });
    panel.append(grid);
    const count=w.selected.size;
    panel.append(el("p","ttai-wiz-count",count+" "+wizardText("subjects selected","مواد تم اختيارها")));
    wizardToolbar(panel,null,()=>{w.step="details";draw()},count===0);
  }else if(w.step==="details"){
    panel.append(wizardTitle(
      wizardText("Colors and class locations","ألوان المواد وأماكن الحصص"),
      wizardText("Choose a location for each subject, or skip if you are not sure.",
        "حدد مكان كل مادة أو سيبه بدون اختيار لو مش متأكد.")
    ));
    for(const name of w.subjects.filter(x=>w.selected.has(subjectKey(x)))){
      const key=subjectKey(name);
      const card=el("div","ttai-wiz-detail");
      const header=el("div","ttai-wiz-detail-head");
      const dot=el("span","ttai-wiz-dot");
      dot.style.background=w.colors[key]||suggestedColor(name);
      header.append(dot,el("strong",null,name));
      const picker=el("input");picker.type="color";picker.value=w.colors[key]||suggestedColor(name);
      picker.setAttribute("aria-label",wizardText("Color for ","لون مادة ")+name);
      picker.onchange=()=>{w.colors[key]=picker.value;draw()};
      header.append(picker);card.append(header);
      const opts=el("div","ttai-wiz-choices");
      const selectedLoc=String(w.locations[key]||"");
      const candidates=[["School",wizardText("School","المدرسة")],["Online",wizardText("Online","أونلاين")],
        ["Other",wizardText("Other","مكان آخر")],["",wizardText("Not sure","مش متأكد")]];
      candidates.forEach(([value,label])=>{
        const active=value==="Other"?(selectedLoc&&selectedLoc!=="School"&&selectedLoc!=="Online"):selectedLoc===value;
        const choice=wizardButton(label,"ttai-option "+(active?"is-selected":""),()=>{
          w.locations[key]=value==="Other"?"Other":value;draw();
        });
        choice.setAttribute("aria-pressed",String(Boolean(active)));opts.append(choice);
      });
      card.append(opts);
      if(selectedLoc==="Other"||selectedLoc&&selectedLoc!=="School"&&selectedLoc!=="Online"){
        const custom=el("input","ttai-wiz-custom");
        custom.type="text";custom.maxLength=120;custom.placeholder=wizardText("Room, building, or place","قاعة أو مكان الحصة");
        custom.value=selectedLoc==="Other"?"":selectedLoc;
        custom.onchange=()=>{w.locations[key]=custom.value.trim()||"Other"};
        card.append(custom);
      }
      panel.append(card);
    }
    if(stateAI.original.length){
      panel.append(wizardTitle(wizardText("What about your current timetable?","نعمل إيه في جدولك الحالي؟"),
        wizardText("Both choices require a final review and confirmation.","في الحالتين هتراجع الجدول وتأكد الحفظ.")));
      const modes=el("div","ttai-wiz-choices");
      [["merge",wizardText("Keep existing + add classes","احتفظ بالقديم وأضف الحصص")],
       ["replace",wizardText("Replace current timetable","استبدل جدولي الحالي")]].forEach(([key,label])=>{
        const opt=wizardButton(label,"ttai-option "+(w.mode===key?"is-selected":""),()=>{w.mode=key;draw()});
        opt.setAttribute("aria-pressed",String(w.mode===key));modes.append(opt);
      });
      panel.append(modes);
    }
    wizardToolbar(panel,()=>{w.step="subjects";draw()},()=>{buildWizardDraft();draw()});
  }else if(w.step==="review"){
    panel.append(wizardTitle(
      wizardText("Review every lesson before saving","راجع كل حصة قبل الحفظ"),
      wizardText("Adjust incorrect days, times, subjects, colors and locations. The AI won't save anything without your confirmation.",
        "صحّح اليوم والوقت والمادة واللون والمكان. مش هنحفظ إلا بموافقتك.")
    ));
    if(w.warnings.length){
      const warning=el("details","ttai-wiz-warnings");
      warning.append(el("summary",null,wizardText("Unclear cells — check the original file ("+w.warnings.length+")",
        "تفاصيل غير واضحة — راجع الملف الأصلي ("+w.warnings.length+")")));
      w.warnings.forEach(item=>warning.append(el("p",null,String(item).slice(0,220))));
      panel.append(warning);
    }
    const lessons=el("div","ttai-wiz-lessons");
    const ordered=[...(stateAI.draft||[])].sort((a,b)=>a.day_of_week-b.day_of_week||a.start_time.localeCompare(b.start_time));
    let lastDay=-1;
    for(const row of ordered){
      if(row.day_of_week!==lastDay){
        lastDay=row.day_of_week;
        lessons.append(el("h4","ttai-wiz-day",dayName(lastDay)));
      }
      lessons.append(editWizardRow(row));
    }
    if(!ordered.length)lessons.append(el("p","ttai-wiz-warning",wizardText(
      "No readable times found. Add lessons manually or upload a clearer timetable.",
      "مفيش أوقات واضحة. ضيف الحصص يدويًا أو ارفع جدول أوضح."
    )));
    panel.append(lessons);
    if(w.missingSubjects?.length){
      const missing=w.missingSubjects.filter(key=>
        !stateAI.draft.some(lesson=>subjectKey(lesson.title)===key||
          (subjectBase(lesson.title)===key&&matchesSelectedSubject(lesson.title,w))));
      if(missing.length){
        panel.append(el("p","ttai-wiz-warning",wizardText(
          "Selected subjects missing sessions: ","مواد اخترتها لكن حصصها ناقصة: ")+missing.join(", ")+
          wizardText(". Add the missing lessons before saving, or go Back to deselect them.",
            ". ضيف الحصص الناقصة قبل الحفظ أو ارجع وشيل اختيارها.")));
      }
    }
    const controls=el("div","ttai-wiz-toolbar");
    controls.append(wizardButton(wizardText("Back","رجوع"),"ttai-subtle",()=>{w.step="details";draw()}));
    controls.append(wizardButton(wizardText("+ Add lesson","+ إضافة حصة"),"ttai-subtle",()=>{
      stateAI.draftHistory.push(structuredClone(stateAI.draft));
      stateAI.draft.push({key:tmpKey(),title:w.subjects.find(x=>w.selected.has(subjectKey(x)))||"Class",
        day_of_week:0,start_time:"08:00",end_time:"09:00",location:"",notes:"",category:"Class",
        color:suggestedColor("Class")});
      draw();
    },stateAI.draft.length>=80));
    panel.append(controls);
    panel.append(el("p","ttai-wiz-hint",wizardText("Use “Save to my timetable” below only after checking every row.",
      "بعد ما تتأكد من كل حصة، اضغط «حفظ في جدولي» تحت.")));
  }
  chat.append(panel);
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
  drawWizard(chat);
  if(stateAI.busy){
    const working=el("div","ttai-work");
    working.append(el("span","ttai-work-spinner","◌"),
      el("span",null,stateAI.phase||t("busy")));
    const cancel=el("button","ttai-work-cancel",wizardText("Cancel","إلغاء"));
    cancel.type="button";cancel.onclick=()=>{stateAI.cancelled=true;stateAI.abort?.abort();
      stateAI.phase=wizardText("Stopping request…","بوقف التحليل…");draw()};
    working.append(cancel);chat.append(working);
  }
  if(stateAI.lastFailed && !stateAI.busy){
    const retry=el("button","ttai-retry",t("retry"));
    retry.type="button";
    retry.onclick=()=>{const draft=stateAI.lastFailed;if(draft.file&&!stateAI.file)stateAI.file=draft.file;void submit(draft.text,true)};
    chat.append(retry);
  }
  panel.append(chat);
  const changes=diff();
  if(total(changes)>0&&(!stateAI.wizard||stateAI.wizard.step==="review")){
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
  if(stateAI.busy||stateAI.saving)return;
  stateAI.file=file;draw();
  // Upload starts visual discovery, not an immediate write.
  void submit("");
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
// Never persist student documents. A two-file in-memory LRU avoids repeated
// PDF rendering on Retry, without cookies, IndexedDB or database uploads.
const preparedFileCache=new Map();
const fileKeyCache=new WeakMap();
async function fileFingerprint(file){
  if(fileKeyCache.has(file))return fileKeyCache.get(file);
  const bytes=await file.arrayBuffer();
  const hash=await crypto.subtle.digest("SHA-256",bytes);
  const key=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,"0")).join("");
  fileKeyCache.set(file,key);return key;
}
function extractReadableTextFallback(evidence){
  // Local fallback is only a SUBJECT PICKER. A visual grid's day/time may
  // be impossible to reconstruct from text order, so NEVER guess sessions.
  const found=new Map();
  const pattern=/\b(?:Mathematics|Maths?|Physics|English|French|Religion|ICT|Chemistry|Biology|Arabic|German|Spanish|History|Geography|Economics|Business|Computer Science|Computer|Science|Statistics|Psychology|Accounting|Art|Music|PE|Digital Marketing)(?:\s*(?:L\s*[12]|Gr(?:ade)?\s*(?:11|12)|G\s*(?:11|12)))?\b/gi;
  for(const match of String(evidence||"").matchAll(pattern)){
    const title=match[0].replace(/\s+/g," ").trim();
    if(!found.has(subjectKey(title)))found.set(subjectKey(title),title);
  }
  const footerLessons=[];
  const DAYS={sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6};
  const as24=(clock,period)=>{
    const bits=clock.split(":").map(Number);
    if(bits.length!==2||bits[0]<1||bits[0]>12||bits[1]>59)return "";
    let hour=bits[0]%12;if(period.toLowerCase()==="pm")hour+=12;
    return String(hour).padStart(2,"0")+":"+String(bits[1]).padStart(2,"0");
  };
  for(const raw of String(evidence||"").split("\n").slice(0,750)){
    const clean=raw.replace(/\bx=-?\d+:/g,"").replace(/\s*\|\s*/g," ").replace(/\s+/g," ");
    const note=clean.match(/\*\s*([^()]{2,90})\s*\(([^)]{8,140})\)/);
    if(!note)continue;
    const title=note[1].trim();
    const dayWords=[...note[2].matchAll(/\b(sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|rsday|urday)?\b/gi)];
    const times=[...note[2].matchAll(/\b(\d{1,2}:\d{2})\s*(am|pm)\b/gi)];
    if(dayWords.length!==1||times.length!==2||!title)continue;
    const start=as24(times[0][1],times[0][2]),end=as24(times[1][1],times[1][2]);
    if(!start||!end||end<=start)continue;
    const day=DAYS[dayWords[0][1].slice(0,3).toLowerCase()];
    if(day===undefined)continue;
    const key=subjectKey(title);
    if(!found.has(key))found.set(key,title);
    if(!footerLessons.some(x=>x.title===title&&x.day_of_week===day)){
      footerLessons.push({title,day_of_week:day,start_time:start,end_time:end,
        location:"",notes:"",category:"Class"});
    }
  }
  return {
    all_detected_subjects:[...found.values()].slice(0,60),
    detected_lessons:footerLessons.slice(0,30),
    ambiguous_items:[wizardText(
      "The visual AI is unavailable. Grid times are not verified; only explicitly dated footnote lessons may be suggested. Check all entries before saving.",
      "التحليل البصري غير متاح. أوقات الجدول الرئيسي غير مؤكدة، لكن يمكن قراءة حصص الملاحظات المكتوبة صراحة. راجع كل الحصص قبل الحفظ.")],
    summary:"Partial local text extraction only; no AI timetable mapping",
    source:"local-text-fallback"
  };
}
async function prepareVisualPages(file){
  if(file.type!=="application/pdf"){
    setPhase(wizardText("Preparing image…","بجهز الصورة…"));
    return {attachments:[{name:file.name,mimeType:file.type,data:await readData(file)}]};
  }
  setPhase(wizardText("Opening PDF…","بفتح ملف الـPDF…"));
  const pdfjs=await loadPdfRenderer();
  let doc;
  try{
    doc=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
    if(doc.numPages>MAX_RENDERED_PAGES)
      throw new Error(wizardText(
        "This PDF has more than five pages. Please split it into sections of five pages.",
        "الـPDF فيه أكتر من 5 صفحات. قسمه لمجموعات من 5 صفحات."));
    const result=new Array(doc.numPages);
    async function onePage(pageNum){
      if(stateAI.cancelled)throw new Error("Cancelled");
      const page=await doc.getPage(pageNum);
      try{
        const original=page.getViewport({scale:1});
        const textEvidence=[];
        // PDF text and image are complementary: images retain the grid;
        // normalized XY coordinates clarify repeating day headings.
        try{
          const content=await page.getTextContent();
          const positioned=[];
          for(const item of content.items||[]){
            if(typeof item.str!=="string"||!item.str.trim()||!item.transform)continue;
            const point=original.convertToViewportPoint(item.transform[4],item.transform[5]);
            const x=Math.round(point[0]/original.width*1000);
            const y=Math.round(point[1]/original.height*1000);
            if(x>=-20&&x<=1020&&y>=-20&&y<=1020)
              positioned.push({x,y,text:item.str.replace(/[\r\n]+/g," ").trim().slice(0,160)});
          }
          positioned.sort((a,b)=>a.y-b.y||a.x-b.x);
          const lines=[];
          for(const item of positioned){
            const last=lines[lines.length-1];
            if(!last||Math.abs(last.y-item.y)>6)lines.push({y:item.y,parts:[item]});
            else last.parts.push(item);
          }
          for(const line of lines){
            line.parts.sort((a,b)=>a.x-b.x);
            textEvidence.push("y="+line.y+" "+
              line.parts.map(item=>"x="+item.x+":"+item.text).join(" | "));
          }
        }catch{ /* Scanned image PDF: visual path still works. */ }
        if(stateAI.cancelled)throw new Error("Cancelled");
        // Keep small images for affordable, quick Workers AI inference.
        // Two pages at a time balances CPU time and mobile memory.
        const scale=Math.min(2.2,1400/original.width,1900/original.height);
        const viewport=page.getViewport({scale});
        const canvas=document.createElement("canvas");
        canvas.width=Math.max(1,Math.round(viewport.width));
        canvas.height=Math.max(1,Math.round(viewport.height));
        const context=canvas.getContext("2d",{alpha:false});
        if(!context)throw new Error("Canvas rendering unavailable");
        try{
          await page.render({canvasContext:context,viewport}).promise;
          const blob=await new Promise((resolve,reject)=>canvas.toBlob(
            result=>result?resolve(result):reject(new Error("Image compression failed")),
            "image/jpeg",0.72));
          const data=await readData(blob);
          result[pageNum-1]={
            attachment:{name:"page-"+pageNum+".jpg",mimeType:"image/jpeg",data},
            evidence:"PAGE "+pageNum+" POSITIONED PDF TEXT\n"+textEvidence.join("\n").slice(0,10000)
          };
        }finally{
          canvas.width=0;canvas.height=0;
        }
      }finally{page.cleanup()}
    }
    for(let i=1;i<=doc.numPages;i+=2){
      setPhase(wizardText("Preparing pages ","بجهز الصفحات ")+i+
        (i+1<=doc.numPages?"–"+(i+1):"")+"/"+doc.numPages+"…");
      await Promise.all(Array.from({length:Math.min(2,doc.numPages-i+1)},
        (_,j)=>onePage(i+j)));
    }
    return {attachments:result.map(x=>x.attachment),
      textEvidence:result.map(x=>x.evidence).join("\n\n").slice(0,38000)};
  }finally{if(doc)await doc.destroy()}
}
async function toData(file){
  const hash=await fileFingerprint(file);
  if(preparedFileCache.has(hash)){
    setPhase(wizardText("Using prepared pages…","بستخدم الصفحات المجهزة…"));
    return await preparedFileCache.get(hash);
  }
  const prepared=prepareVisualPages(file);
  preparedFileCache.set(hash,prepared);
  while(preparedFileCache.size>2)preparedFileCache.delete(preparedFileCache.keys().next().value);
  try{return await prepared}
  catch(error){preparedFileCache.delete(hash);throw error}
}
// Keep the chat responsive even if a large PDF or the Edge relay stalls.
// Supabase supports AbortSignal; Promise.race is a second safety net if
// a browser/network implementation ignores the abort request.
const AI_REQUEST_DEADLINE_MS=52000;
async function invokeWithDeadline(body){
  const controller=new AbortController();
  stateAI.abort=controller;
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
    if(stateAI.abort===controller)stateAI.abort=null;
  }
}
function setPhase(msg){
  if(!stateAI.cancelled&&stateAI.busy){stateAI.phase=msg;draw()}
}
async function submit(text,retrying=false){
  if(stateAI.busy||stateAI.saving)return;
  const file=stateAI.file;
  stateAI.busy=true;stateAI.cancelled=false;
  stateAI.phase=wizardText("Preparing your timetable…","بجهز جدولك…");
  let prepared=null;
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
      mode:file?"discover":"edit",
      history:prior,
      messages:prior
    };
    if(file){
      prepared=await toData(file);
      if(stateAI.cancelled)throw new Error(wizardText("Cancelled","تم الإلغاء"));
      Object.assign(body,prepared);
    }
    setPhase(file ? wizardText("Reading timetable pages visually…","بقرأ صفحات الجدول بصريًا…")
      : wizardText("Updating your timetable…","بحدّث جدولك…"));
    const {data,error}=await invokeWithDeadline(body);
    if(stateAI.cancelled)throw new Error(wizardText("Cancelled","تم الإلغاء"));
    if(error||!data||!Array.isArray(data.entries)){
      let description=data?.error||"";
      if(error?.context?.json){
        const details=await error.context.json().catch(()=>null);
        description=details?.error||description;
      }
      throw new Error(description||error?.message||t("error"));
    }
    if(file){
      // An uploaded document only discovers subjects and source lessons.
      // AI must not write into the timetable before the wizard review.
      if(!data.extracted||typeof data.extracted!=="object")
        throw new Error(wizardText("Couldn't identify the timetable. Try a clearer scan.","مش قادر أقرأ الجدول. ارفع نسخة أوضح."));
      stateAI.source=data.extracted;startWizard(data.extracted);
      stateAI.history.push({role:"assistant",text:wizardText(
        "I found the subjects. Select yours below and review every lesson before saving.",
        "استخرجت المواد. اختار موادك تحت وبعدها راجع كل حصة قبل الحفظ.")});
    }else{
      if(data.changed){
        if(stateAI.draft)stateAI.draftHistory.push(structuredClone(stateAI.draft));
        const colors=stateAI.wizard?.colors||{};
        stateAI.draft=normalizeDraft(data.entries.map(row=>({
          ...row,color:colors[subjectKey(row.title)]||
            stateAI.draft?.find(item=>item.key===row.key)?.color||suggestedColor(row.title)
        })));
      }
      if(data.extracted&&typeof data.extracted==="object")stateAI.source=data.extracted;
      stateAI.history.push({role:"assistant",text:String(data.reply||"").slice(0,1200)});
    }
    stateAI.history[stateAI.history.length-2].failedPrompt=false;
    stateAI.file=null;
  }catch(e){
    if(stateAI.cancelled){
      stateAI.lastFailed={text,file};
      stateAI.history.push({role:"assistant",text:wizardText(
        "Analysis cancelled. Your file is still here; Retry when ready.",
        "التحليل اتلغى. الملف لسه موجود وتقدر تعيد المحاولة."),isError:true});
    }else{
      stateAI.lastFailed={text,file};
      const safe=String(e?.message||t("error"));
      const partial=file&&prepared?.textEvidence?
        extractReadableTextFallback(prepared.textEvidence):null;
      if(partial?.all_detected_subjects?.length){
        stateAI.source=partial;
        startWizard(partial);
        stateAI.history.push({role:"assistant",text:wizardText(
          "Visual AI is unavailable, but I found subject names in the PDF text. Choose your subjects; times not reliably read must be entered in Review. You can also Retry the visual analysis.",
          "التحليل البصري مش متاح حاليًا، لكن قدرت أقرأ أسماء مواد من نص الـPDF. اختار موادك وراجع الأوقات أو أدخلها يدويًا. تقدر تضغط إعادة المحاولة كمان."
        ),isError:true});
      }else{
        stateAI.history.push({role:"assistant",text:safe,isError:true});
      }
    }
  }finally{
    stateAI.phase="";stateAI.busy=false;stateAI.abort=null;draw();
  }
}
async function applyPlan(){
  if(stateAI.busy||stateAI.saving)return;
  const d=diff();if(!total(d))return;
  if(stateAI.wizard&&stateAI.wizard.step!=="review")return;
  try{
    const missing=(stateAI.wizard?.missingSubjects||[]).filter(key=>
      !stateAI.draft.some(row=>subjectKey(row.title)===key||
        (subjectBase(row.title)===key&&matchesSelectedSubject(row.title,stateAI.wizard))));
    if(missing.length)throw new Error(wizardText(
      "Add lessons for selected subjects before saving: ",
      "ضيف حصص المواد اللي اخترتها قبل الحفظ: ")+missing.join(", "));
    const unique=new Set();
    for(const row of stateAI.draft){
      const start=String(row.start_time||"").slice(0,5),end=String(row.end_time||"").slice(0,5);
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||end<=start)
        throw new Error(wizardText("Fix lesson times before saving.","صحّح أوقات الحصص قبل الحفظ."));
      if(!String(row.title||"").trim()||!Number.isInteger(Number(row.day_of_week))||Number(row.day_of_week)<0||Number(row.day_of_week)>6)
        throw new Error(wizardText("Each lesson needs a subject and valid day.","كل حصة لازم ليها مادة ويوم صحيح."));
      const key=[row.day_of_week,start,end,subjectKey(row.title)].join("|");
      if(unique.has(key))throw new Error(wizardText("Remove duplicate lessons before saving.","احذف الحصص المكررة قبل الحفظ."));
      unique.add(key);
    }
    normalizeDraft(stateAI.draft);
  }catch(e){alertUser(e.message||t("error"));return}
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
