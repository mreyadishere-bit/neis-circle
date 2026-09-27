/* NEIS Circle Study — paginated external academic resources only. */
(function(){
  'use strict';
  const PAGE_SIZE=12;
  const tr=(en,ar)=>state.lang==='ar'?ar:en;
  const same=(a,b)=>String(a)===String(b);
  const study=state.studyLibrary={
    tab:'resources',subject:'',unit:'',type:'',language:'',sort:'newest',search:'',
    subjects:[],units:[],resources:[],actions:new Map(),total:0,page:0,loading:false,error:'',ready:false,request:0
  };
  let searchTimer=null;

  function friendly(error,action='load Study resources'){console.error('[NEIS Study]',error);return window.neisFriendlyError?.(error,action)||tr('Something went wrong. Please try again.','حدث خطأ. حاول مرة أخرى.')}
  function clean(value){return String(value||'').trim()}
  function validUrl(value){try{const url=new URL(value);return url.protocol==='http:'||url.protocol==='https:'}catch{return false}}
  function option(value,label,current){return `<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`}
  function date(value){return new Intl.DateTimeFormat(state.lang==='ar'?'ar-EG':'en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date(value))}
  function typeLabel(value){return ({document:tr('Document','مستند'),pdf:'PDF',video:tr('Video','فيديو'),website:tr('Website','موقع'),presentation:tr('Presentation','عرض تقديمي'),other:tr('Other','أخرى')})[value]||value}
  function languageLabel(value){return ({en:'English',ar:'العربية',both:tr('Arabic + English','العربية + الإنجليزية'),other:tr('Other','أخرى')})[value]||value}
  function canEdit(resource){return !!(state.isAdmin||same(resource.author_id,authUser?.id))}
  function empty(title,copy,button=''){return `<div class="study-empty"><span class="study-empty-icon">${icon('book')}</span><h3>${esc(title)}</h3><p>${esc(copy)}</p>${button}</div>`}

  async function loadValues(level){
    const args={level_input:level,subject_input:level==='subject'?null:study.subject||null,unit_input:null};
    const {data,error}=await sb.rpc('study_filter_values',args);
    if(error){study.error=friendly(error);return []}
    return (data||[]).map(row=>row.value).filter(Boolean);
  }
  async function loadSubjects(){study.subjects=await loadValues('subject');study.ready=true;renderStudyPage()}
  async function loadUnits(){study.units=study.subject?await loadValues('unit'):[];renderStudyPage()}
  function shouldLoadResources(){return study.tab!=='resources'||!!study.unit||clean(study.search).length>=2}
  async function loadResources(){
    const request=++study.request;
    if(!shouldLoadResources()){study.resources=[];study.actions=new Map();study.total=0;study.loading=false;study.error='';renderStudyPage();return}
    study.loading=true;study.error='';renderStudyPage();
    const {data,error}=await sb.rpc('study_resource_page',{
      mode_input:study.tab,subject_input:study.subject||null,unit_input:study.unit||null,
      search_input:clean(study.search)||null,type_input:study.type||null,language_input:study.language||null,
      oldest_input:study.sort==='oldest',page_size_input:PAGE_SIZE,offset_input:study.page*PAGE_SIZE
    });
    if(request!==study.request)return;
    if(error){study.loading=false;study.error=friendly(error);study.resources=[];study.total=0;renderStudyPage();return}
    const rows=data||[],authorIds=[...new Set(rows.map(row=>row.author_id).filter(Boolean))],resourceIds=rows.map(row=>row.id);
    const [authorsResult,actionsResult]=await Promise.all([
      authorIds.length?sb.from('profiles').select('id,full_name,username,grade,branch,avatar_url').in('id',authorIds):Promise.resolve({data:[],error:null}),
      resourceIds.length?sb.from('study_resource_actions').select('resource_id,helpful,saved').eq('user_id',authUser.id).in('resource_id',resourceIds):Promise.resolve({data:[],error:null})
    ]);
    if(request!==study.request)return;
    const authors=new Map((authorsResult.data||[]).map(profile=>[String(profile.id),profile]));
    study.actions=new Map((actionsResult.data||[]).map(action=>[String(action.resource_id),action]));
    study.resources=rows.map(row=>({...row,author:authors.get(String(row.author_id))||null}));
    study.total=Number(rows[0]?.total_count||0);study.loading=false;
    renderStudyPage();
  }

  function hierarchy(){
    const subjectOptions=study.subjects.map(value=>option(value,value,study.subject)).join('');
    const unitOptions=study.units.map(value=>option(value,value,study.unit)).join('');
    return `<section class="study-path" aria-label="${tr('Resource hierarchy','تسلسل المصادر')}">
      <label><span>1 · ${tr('Subject','المادة')}</span><select id="studySubject">${option('',tr('Choose subject','اختر المادة'),study.subject)}${subjectOptions}</select></label>
      <span class="study-path-arrow">→</span>
      <label><span>2 · ${tr('Block','البلوك')}</span><select id="studyUnit" ${study.subject?'':'disabled'}>${option('',tr('Choose block','اختر البلوك'),study.unit)}${unitOptions}</select></label>
    </section>`;
  }
  function toolbar(){return `<section class="study-toolbar">
    <label class="study-search">${icon('search')}<input id="studySearch" value="${esc(study.search)}" placeholder="${tr('Search titles, descriptions, subjects…','ابحث في العناوين والوصف والمواد…')}" dir="auto"></label>
    <div class="study-filters">
      <label><span>${tr('Type','النوع')}</span><select id="studyType">${option('',tr('All types','كل الأنواع'),study.type)}${['document','pdf','video','website','presentation','other'].map(value=>option(value,typeLabel(value),study.type)).join('')}</select></label>
      <label><span>${tr('Language','اللغة')}</span><select id="studyLanguage">${option('',tr('All languages','كل اللغات'),study.language)}${['en','ar','both','other'].map(value=>option(value,languageLabel(value),study.language)).join('')}</select></label>
      <label><span>${tr('Sort','الترتيب')}</span><select id="studySort">${option('newest',tr('Newest','الأحدث'),study.sort)}${option('oldest',tr('Oldest','الأقدم'),study.sort)}</select></label>
    </div>
  </section>`}

  function resourceCard(resource){
    const action=study.actions.get(String(resource.id))||{helpful:false,saved:false},author=resource.author||{},editable=canEdit(resource);
    return `<article class="study-card" data-study-resource="${esc(resource.id)}">
      <div class="study-card-top">
        <span class="study-type">${esc(typeLabel(resource.resource_type))}</span>
        <time>${date(resource.created_at)}</time>
      </div>

      <div class="study-card-copy" dir="auto">
        <h3>${esc(resource.title)}</h3>
        <p>${esc(resource.description||tr('Shared academic resource','مصدر أكاديمي مشترك'))}</p>
      </div>

      <div class="study-meta-row">
        <div class="study-meta-chips">
          <span>${esc(resource.subject)}</span>
          <span>${tr('Block','البلوك')} ${esc(resource.unit)}</span>
        </div>
      </div>

      <div class="study-author">
        <span class="avatar">${esc(initials(author.full_name||'Student'))}</span>
        <div class="study-author-copy">
          <b>${esc(author.full_name||tr('NEIS Student','طالب NEIS'))}</b>
          <small>@${esc(author.username||'student')} · ${esc(languageLabel(resource.language))}</small>
        </div>
      </div>

      <div class="study-card-footer">
        <a class="primary study-open" href="${esc(resource.external_url)}" target="_blank" rel="noopener noreferrer">
          <span>${tr('Open resource','فتح المصدر')}</span><b aria-hidden="true">↗</b>
        </a>

        <div class="study-card-tools">
          <button type="button" class="study-tool ${action.helpful?'active':''}" data-study-helpful="${esc(resource.id)}" aria-pressed="${action.helpful?'true':'false'}">
            ${icon('heart')}<span>${tr('Helpful','مفيد')}</span><b>${Number(resource.helpful_count||0)}</b>
          </button>
          <button type="button" class="study-tool ${action.saved?'active':''}" data-study-save="${esc(resource.id)}" aria-pressed="${action.saved?'true':'false'}">
            ${icon('save')}<span>${action.saved?tr('Saved','محفوظ'):tr('Save','حفظ')}</span>
          </button>
          <button type="button" class="study-tool" data-study-share="${esc(resource.id)}">
            ${icon('share')}<span>${tr('Share','مشاركة')}</span>
          </button>
        </div>

        <div class="study-owner-tools">
          ${editable
            ? `<button type="button" class="study-owner-edit" data-study-edit="${esc(resource.id)}">${tr('Edit','تعديل')}</button><button type="button" class="study-owner-delete" data-study-delete="${esc(resource.id)}">${tr('Delete','حذف')}</button>`
            : `<button type="button" class="study-owner-edit" data-study-report="${esc(resource.id)}">${tr('Report','إبلاغ')}</button>`}
        </div>
      </div>
    </article>`;
  }

  function results(){
    if(study.loading)return `<div class="study-grid">${Array.from({length:6},()=>'<div class="study-card study-skeleton"></div>').join('')}</div>`;
    if(study.error)return empty(tr('Study could not load','تعذر تحميل Study'),study.error,`<button class="primary" data-study-retry>${tr('Try again','حاول مرة أخرى')}</button>`);
    if(!shouldLoadResources())return empty(tr('Choose a block to begin','اختر بلوك للبدء'),tr('Resources load after you choose Subject and Block. You can also search directly.','يتم تحميل المصادر بعد اختيار المادة والبلوك، ويمكنك أيضًا البحث مباشرة.'));
    if(!study.resources.length){
      const title=study.tab==='saved'?tr('No saved resources','لا توجد مصادر محفوظة'):study.tab==='my'?tr('You have not shared a resource yet','لم تشارك مصدرًا بعد'):tr('No resources found','لم يتم العثور على مصادر');
      return empty(title,tr('Try different filters or share a useful link.','جرّب فلاتر أخرى أو شارك رابطًا مفيدًا.'),`<button class="primary" data-study-new>${tr('Share a resource','مشاركة مصدر')}</button>`);
    }
    const pages=Math.max(1,Math.ceil(study.total/PAGE_SIZE)),pageMeta=pages>1?`<span>${tr('Page','صفحة')} ${study.page+1} / ${pages}</span>`:'',pagination=pages>1?`<nav class="study-pagination" aria-label="${tr('Study pages','صفحات Study')}"><button class="secondary" data-study-page="${study.page-1}" ${study.page===0?'disabled':''}>${tr('Previous','السابق')}</button><button class="secondary" data-study-page="${study.page+1}" ${study.page+1>=pages?'disabled':''}>${tr('Next','التالي')}</button></nav>`:'';
    return `<div class="study-results-head"><b>${study.total} ${tr(study.total===1?'resource':'resources','مصدر')}</b>${pageMeta}</div><div class="study-grid">${study.resources.map(resourceCard).join('')}</div>${pagination}`;
  }

  function studyView(){
    return `<section class="study-head"><div><p class="kicker"><i></i>${tr('Shared academic library','مكتبة أكاديمية مشتركة')}</p><h1>Study</h1><p>${tr('Useful links organized by subject and block — without file storage or noise.','روابط مفيدة منظّمة حسب المادة والبلوك، دون تخزين ملفات أو تشتيت.')}</p></div><button class="primary study-create" data-study-new><span>+</span>${tr('Share resource','مشاركة مصدر')}</button></section>
      <div class="tabs study-tabs">${[['resources',tr('Resources','المصادر')],['saved',tr('Saved Resources','المصادر المحفوظة')],['my',tr('My Resources','مصادري')]].map(([value,label])=>`<button class="${study.tab===value?'active':''}" data-study-tab="${value}">${label}</button>`).join('')}</div>
      ${study.tab==='resources'?hierarchy():''}${toolbar()}<div id="studyResults">${results()}</div>`;
  }

  function renderStudyPage(){
    if(state.view!=='study'||!authUser||state.onboardingComplete!==true)return;
    const view=$('#view');if(!view)return;
    view.innerHTML=studyView();$$('[data-nav]').forEach(button=>button.classList.toggle('active',button.dataset.nav==='study'));bindStudy();if(typeof syncChrome==='function')syncChrome();
  }

  function editor(resource=null){
    if(!authUser)return;
    const editing=!!resource;if(editing&&!canEdit(resource)){toast(tr('You cannot edit this resource.','لا يمكنك تعديل هذا المصدر.'));return}
    openModal(`<div class="modal-head"><div><p class="kicker"><i></i>${tr('External link only','رابط خارجي فقط')}</p><h2>${editing?tr('Edit resource','تعديل المصدر'):tr('Share a Study resource','مشاركة مصدر دراسي')}</h2><p>${tr('Add a clear path so students can find it later.','أضف مسارًا واضحًا ليتمكن الطلاب من العثور عليه لاحقًا.')}</p></div><button class="close" data-close>×</button></div>
      <form id="studyResourceForm" class="study-form">
        <label class="field">${tr('Title','العنوان')}<input id="studyFormTitle" required minlength="3" maxlength="180" value="${esc(resource?.title||'')}" dir="auto"></label>
        <label class="field">${tr('Description','الوصف')}<textarea id="studyFormDescription" rows="5" maxlength="3000" dir="auto">${esc(resource?.description||'')}</textarea></label>
        <div class="study-form-grid study-form-grid-two"><label class="field">${tr('Subject','المادة')}<input id="studyFormSubject" required minlength="2" maxlength="100" value="${esc(resource?.subject||study.subject)}" dir="auto"></label><label class="field">${tr('Block','البلوك')}<input id="studyFormUnit" required maxlength="120" value="${esc(resource?.unit||study.unit)}" dir="auto"></label></div>
        <div class="study-form-grid"><label class="field">${tr('Resource type','نوع المصدر')}<select id="studyFormType">${['document','pdf','video','website','presentation','other'].map(value=>option(value,typeLabel(value),resource?.resource_type||'document')).join('')}</select></label><label class="field">${tr('Language','اللغة')}<select id="studyFormLanguage">${['en','ar','both','other'].map(value=>option(value,languageLabel(value),resource?.language||state.lang)).join('')}</select></label></div>
        <label class="field">${tr('External link','الرابط الخارجي')}<input id="studyFormUrl" required type="url" inputmode="url" maxlength="2048" value="${esc(resource?.external_url||'')}" placeholder="https://…" dir="ltr"></label>
        <div class="study-link-warning"><b>${tr('Before publishing','قبل النشر')}</b><p>${tr('Make sure this link is set to “Anyone with the link can access/view” so other students can open it.','تأكد من ضبط الرابط على «أي شخص لديه الرابط يمكنه الوصول/العرض» حتى يستطيع الطلاب الآخرون فتحه.')}</p></div>
        <label class="study-confirm"><input id="studyFormConfirmed" type="checkbox" ${resource?.link_access_confirmed?'checked':''} required><span>${tr('I confirm this link is accessible to anyone with the link.','أؤكد أن هذا الرابط متاح لأي شخص لديه الرابط.')}</span></label>
        <div class="modal-actions"><button type="button" class="secondary" data-close>${tr('Cancel','إلغاء')}</button><button class="primary" id="studyFormSubmit">${editing?tr('Update resource','تحديث المصدر'):tr('Publish resource','نشر المصدر')}</button></div>
      </form>`,true);
    $('#studyResourceForm').onsubmit=event=>saveResource(event,resource);
    $('#modalRoot .modal')?.classList.add('study-editor-modal');
  }

  async function saveResource(event,resource){
    event.preventDefault();const button=$('#studyFormSubmit');if(button.disabled)return;
    const externalUrl=clean($('#studyFormUrl').value);
    if(!validUrl(externalUrl)){toast(tr('Enter a valid http:// or https:// link.','أدخل رابطًا صحيحًا يبدأ بـ http:// أو https://.'));return}
    if(!$('#studyFormConfirmed').checked){toast(tr('Confirm that other students can access the link.','أكد أن الطلاب الآخرين يمكنهم فتح الرابط.'));return}
    button.disabled=true;
    const payload={title:clean($('#studyFormTitle').value),description:clean($('#studyFormDescription').value),subject:clean($('#studyFormSubject').value),unit:clean($('#studyFormUnit').value),external_url:externalUrl,resource_type:$('#studyFormType').value,language:$('#studyFormLanguage').value,link_access_confirmed:true};
    const query=resource?sb.from('study_resources').update(payload).eq('id',resource.id).select('*').single():sb.from('study_resources').insert({...payload,author_id:authUser.id}).select('*').single();
    const {data,error}=await query;
    if(error){button.disabled=false;toast(friendly(error,resource?'update this Study resource':'publish this Study resource'));return}
    closeModal();study.subject=data.subject;study.unit=data.unit;study.page=0;study.tab='resources';
    study.subjects=await loadValues('subject');study.units=await loadValues('unit');await loadResources();
    toast(resource?tr('Resource updated.','تم تحديث المصدر.'):tr('Resource published.','تم نشر المصدر.'));
  }

  async function removeResource(id){
    const resource=study.resources.find(item=>same(item.id,id));if(!resource||!canEdit(resource))return;
    if(!confirm(tr('Delete this resource permanently?','هل تريد حذف هذا المصدر نهائيًا؟')))return;
    const {data,error}=await sb.from('study_resources').delete().eq('id',id).select('id');
    if(error||!data?.length){toast(error?friendly(error):tr('Resource could not be deleted.','تعذر حذف المصدر.'));return}
    if(study.resources.length===1&&study.page>0)study.page--;await loadResources();study.subjects=await loadValues('subject');renderStudyPage();toast(tr('Resource deleted.','تم حذف المصدر.'));
  }

  async function toggleAction(id,kind,button){
    if(button.disabled)return;button.disabled=true;
    const current=study.actions.get(String(id))||{helpful:false,saved:false},exists=study.actions.has(String(id)),next={helpful:!!current.helpful,saved:!!current.saved};next[kind]=!next[kind];
    let result;
    if(!next.helpful&&!next.saved){
      result=exists?await sb.from('study_resource_actions').delete().match({resource_id:id,user_id:authUser.id}):{error:null};
    }else if(exists){
      result=await sb.from('study_resource_actions').update({helpful:next.helpful,saved:next.saved}).match({resource_id:id,user_id:authUser.id});
    }else{
      result=await sb.from('study_resource_actions').insert({resource_id:id,user_id:authUser.id,helpful:next.helpful,saved:next.saved});
    }
    if(result.error){button.disabled=false;toast(friendly(result.error,kind==='helpful'?'update Helpful':'update Saved Resources'));return}
    const resource=study.resources.find(item=>same(item.id,id));if(resource&&kind==='helpful')resource.helpful_count=Math.max(0,Number(resource.helpful_count||0)+(next.helpful?1:-1));
    if(next.helpful||next.saved)study.actions.set(String(id),{resource_id:id,...next});else study.actions.delete(String(id));
    if(study.tab==='saved'&&kind==='saved'&&!next.saved){study.resources=study.resources.filter(item=>!same(item.id,id));study.total=Math.max(0,study.total-1)}
    renderStudyPage();
  }

  async function shareResource(id){
    const resource=study.resources.find(item=>same(item.id,id));if(!resource)return;
    try{if(navigator.share)await navigator.share({title:resource.title,text:resource.description,url:resource.external_url});else{await navigator.clipboard.writeText(resource.external_url);toast(tr('Link copied.','تم نسخ الرابط.'))}}catch(error){if(error.name!=='AbortError')toast(tr('Could not share this link.','تعذرت مشاركة الرابط.'))}
  }

  function reportResource(id){
    openModal(`<div class="modal-head"><div><h2>${tr('Report resource','الإبلاغ عن المصدر')}</h2><p>${tr('The report goes to the private admin queue.','يصل البلاغ إلى قائمة الأدمن الخاصة.')}</p></div><button class="close" data-close>×</button></div><form id="studyReportForm"><label class="field">${tr('Reason','السبب')}<select id="studyReportReason"><option>${tr('Broken or inaccessible link','رابط معطّل أو غير متاح')}</option><option>${tr('Spam','محتوى مزعج')}</option><option>${tr('Unsafe content','محتوى غير آمن')}</option><option>${tr('Other','سبب آخر')}</option></select></label><label class="field">${tr('Details','التفاصيل')}<textarea id="studyReportDetails" rows="4" maxlength="1000"></textarea></label><div class="modal-actions"><button type="button" class="secondary" data-close>${tr('Cancel','إلغاء')}</button><button class="primary">${tr('Submit report','إرسال البلاغ')}</button></div></form>`);
    $('#studyReportForm').onsubmit=async event=>{event.preventDefault();const button=event.submitter;if(button.disabled)return;button.disabled=true;const {error}=await sb.from('reports').insert({reporter_id:authUser.id,target_type:'study_resource',target_id:String(id),reason:$('#studyReportReason').value,details:clean($('#studyReportDetails').value)});if(error){button.disabled=false;toast(friendly(error));return}closeModal();toast(tr('Report sent to the administrator.','تم إرسال البلاغ إلى الأدمن.'))};
  }

  function bindStudy(){
    $$('[data-study-new]').forEach(button=>button.onclick=()=>editor());
    $$('[data-study-tab]').forEach(button=>button.onclick=()=>{study.tab=button.dataset.studyTab;study.page=0;if(study.tab!=='resources'){study.subject='';study.unit=''}loadResources()});
    const subject=$('#studySubject'),unit=$('#studyUnit');
    if(subject)subject.onchange=async()=>{study.subject=subject.value;study.unit='';study.page=0;study.units=[];study.resources=[];await loadUnits()};
    if(unit)unit.onchange=()=>{study.unit=unit.value;study.page=0;loadResources()};
    const search=$('#studySearch');if(search)search.oninput=()=>{study.search=search.value;study.page=0;clearTimeout(searchTimer);searchTimer=setTimeout(loadResources,350)};
    [['studyType','type'],['studyLanguage','language'],['studySort','sort']].forEach(([id,key])=>{const field=$('#'+id);if(field)field.onchange=()=>{study[key]=field.value;study.page=0;loadResources()}});
    const view=$('#view');
    if(view)view.onclick=event=>{
      const button=event.target.closest('button,a');
      if(!button||!view.contains(button))return;
      if(button.matches('[data-study-page]')){event.preventDefault();study.page=Number(button.dataset.studyPage);loadResources();scrollTo({top:0,behavior:'smooth'});return}
      if(button.matches('[data-study-helpful]')){event.preventDefault();toggleAction(button.dataset.studyHelpful,'helpful',button);return}
      if(button.matches('[data-study-save]')){event.preventDefault();toggleAction(button.dataset.studySave,'saved',button);return}
      if(button.matches('[data-study-share]')){event.preventDefault();shareResource(button.dataset.studyShare);return}
      if(button.matches('[data-study-edit]')){event.preventDefault();editor(study.resources.find(item=>same(item.id,button.dataset.studyEdit)));return}
      if(button.matches('[data-study-delete]')){event.preventDefault();removeResource(button.dataset.studyDelete);return}
      if(button.matches('[data-study-report]')){event.preventDefault();reportResource(button.dataset.studyReport);return}
      if(button.matches('[data-study-retry]')){event.preventDefault();loadResources();return}
    };
  }

  const previousRender=render;
  render=function(){
    if(state.view!=='study'){previousRender();return}
    if(!authUser||state.onboardingComplete!==true){previousRender();return}
    document.body.classList.add('app-ready');renderStudyPage();
    if(!study.ready)loadSubjects();
  };
})();
