/* NEIS Circle · Timetable AI Assistant (Google Gemini 3.8 Flash Multimodal)
   Additive layer: preserves all existing Timetable UI/UX, CRUD, and PNG export.
   Sends original PDF/image binary directly to Gemini 3.8 Flash multimodal input. */
(function(){
  'use strict';
  if(window.__neisTimetableAiGeminiV1)return;
  window.__neisTimetableAiGeminiV1=true;

  const OPEN_BUTTON_ID='ttAiAssistantBtn';
  const ALLOWED_MIMES=new Set([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]);
  const ALLOWED_CATEGORIES=new Set(['Class','Lab','Study','Exam','Activity','Other']);
  const DAY_NAMES={
    en:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
    ar:['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']
  };
  const PALETTE=['#2f7db8','#0f9d76','#d9822b','#7a52d8','#d6456b','#2f9e95','#5e6a78'];

  let scheduled=false;

  function isAr(){
    return (typeof state!=='undefined'&&state?.lang==='ar')||
      document.documentElement.lang==='ar'||
      document.body.classList.contains('rtl');
  }

  function tr(en,ar){
    return isAr()?ar:en;
  }

  function safeEsc(val){
    if(typeof esc==='function')return esc(val);
    return String(val??'')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }

  function notify(en,ar){
    const msg=tr(en,ar);
    if(typeof toast==='function')toast(msg);
  }

  function ensureState(){
    if(typeof state==='undefined'||!state)return null;
    if(!state.timetableAi){
      state.timetableAi={
        provider:'gemini',
        model:'gemini-3.8-flash',
        busy:false,
        messages:[
          {
            role:'assistant',
            content:tr(
              'Upload your timetable PDF or image (or describe your classes) and tell me which subjects you take. I will visually analyze the full table layout and prepare a draft for your review.',
              'ارفع ملف الجدول بصيغة PDF أو صورة (أو اكتب موادك) وحدد المواد التي تدرسها فقط. سأحلل التخطيط البصري للجدول بالكامل وأجهز مسودة لمراجعتك.'
            )
          }
        ],
        draft:null,
        draftHistory:[],
        extracted:null,
        pendingAttachment:null,
        uploadedFingerprints:new Set(),
        lastFailedPayload:null
      };
    }
    return state.timetableAi;
  }

  function normalizeTime24(value){
    const raw=String(value??'').trim();
    const m24=raw.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
    if(m24)return m24[1].padStart(2,'0')+':'+m24[2];
    const m12=raw.match(/^(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)$/i);
    if(m12){
      let h=Number(m12[1]);
      const min=m12[2]||'00';
      const p=m12[3].toUpperCase();
      if(p==='PM'&&h<12)h+=12;
      if(p==='AM'&&h===12)h=0;
      if(h>=0&&h<=23)return String(h).padStart(2,'0')+':'+min;
    }
    return '';
  }

  function toMinutes(hhmm){
    const parts=String(hhmm||'').split(':').map(Number);
    if(parts.length<2||!Number.isFinite(parts[0])||!Number.isFinite(parts[1]))return -1;
    return parts[0]*60+parts[1];
  }

  function validateEntries(entries){
    if(!Array.isArray(entries))return [];
    const out=[];
    const seen=new Set();
    for(let i=0;i<entries.length;i++){
      const row=entries[i];
      if(!row||typeof row!=='object')continue;
      const day=Number(row.day_of_week);
      if(!Number.isInteger(day)||day<0||day>6)continue;
      const title=String(row.title??'').trim().slice(0,100);
      if(!title)continue;
      const start=normalizeTime24(row.start_time);
      const end=normalizeTime24(row.end_time);
      if(!start||!end||toMinutes(end)<=toMinutes(start))continue;
      const cat=ALLOWED_CATEGORIES.has(String(row.category??'').trim())
        ?String(row.category).trim()
        :'Class';
      const color=/^#[0-9A-Fa-f]{6}$/.test(String(row.color??'').trim())
        ?String(row.color).trim().toLowerCase()
        :PALETTE[i%PALETTE.length];
      const location=String(row.location??'').trim().slice(0,120);
      const notes=String(row.notes??'').trim().slice(0,1000);
      const id=String(row.id??'').trim()||('tt-draft-'+day+'-'+start.replace(':','')+'-'+(i+1));
      const key=day+'|'+start+'|'+end+'|'+title.toLowerCase();
      if(seen.has(key))continue;
      seen.add(key);
      out.push({
        id,
        day_of_week:day,
        title,
        start_time:start,
        end_time:end,
        location,
        notes,
        category:cat,
        color
      });
    }
    out.sort((a,b)=>a.day_of_week-b.day_of_week||a.start_time.localeCompare(b.start_time));
    return out;
  }

  function fileToBase64Attachment(file){
    return new Promise((resolve,reject)=>{
      if(!file)return reject(new Error('No file selected'));
      const mimeType=String(file.type||'').toLowerCase()||
        (file.name&&file.name.toLowerCase().endsWith('.pdf')?'application/pdf':'');
      if(!ALLOWED_MIMES.has(mimeType)){
        return reject(new Error(tr(
          'Unsupported file type. Please attach a PDF, PNG, JPEG, or WebP file.',
          'نوع الملف غير مدعوم. يرجى إرفاق ملف PDF أو صورة PNG/JPEG/WebP.'
        )));
      }
      if(file.size>15*1024*1024){
        return reject(new Error(tr(
          'File is larger than 15 MB. Please upload a smaller timetable file.',
          'حجم الملف يتجاوز 15 ميجابايت.'
        )));
      }
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error(tr('Could not read file.','تعذر قراءة الملف.')));
      reader.onload=()=>{
        const result=String(reader.result||'');
        const base64=result.replace(/^data:[^;]+;base64,/,'').trim();
        const fingerprint=file.name+':'+file.size+':'+mimeType+':'+base64.slice(0,48);
        resolve({
          name:file.name||'timetable',
          mimeType,
          size:file.size||0,
          data:base64,
          fingerprint
        });
      };
      reader.readAsDataURL(file);
    });
  }

  async function resolveAccessToken(){
    if(typeof sb!=='undefined'&&sb?.auth?.getSession){
      try{
        const {data}=await sb.auth.getSession();
        if(data?.session?.access_token)return data.session.access_token;
      }catch(_){}
    }
    if(window.__neisTestAccessToken)return window.__neisTestAccessToken;
    return '';
  }

  async function invokeGeminiTimetableBackend(payload){
    const token=await resolveAccessToken();
    if(!token){
      const err=new Error(tr(
        'Please sign in to use the Timetable AI Assistant.',
        'يرجى تسجيل الدخول لاستخدام مساعد الجدول الذكي.'
      ));
      err.code='AUTH_REQUIRED';
      throw err;
    }

    const headers={
      'Content-Type':'application/json',
      'Authorization':'Bearer '+token
    };
    if(typeof CONFIG!=='undefined'&&CONFIG?.supabaseAnonKey){
      headers['apikey']=CONFIG.supabaseAnonKey;
    }

    const endpoints=['/api/timetable-ai'];
    if(typeof CONFIG!=='undefined'&&CONFIG?.supabaseUrl){
      endpoints.push(CONFIG.supabaseUrl.replace(/\/+$/,'')+'/functions/v1/timetable-ai');
    }

    let lastError=null;
    for(const url of endpoints){
      try{
        const response=await fetch(url,{
          method:'POST',
          headers,
          body:JSON.stringify(payload)
        });
        if(response.status===404&&url==='/api/timetable-ai'&&endpoints.length>1){
          continue;
        }
        const data=await response.json().catch(()=>({}));
        if(!response.ok){
          const err=new Error(
            data?.error||tr('Timetable AI request failed.','تعذر إكمال طلب مساعد الجدول.')
          );
          err.status=response.status;
          err.code=data?.code||'REQUEST_FAILED';
          throw err;
        }
        return data;
      }catch(error){
        lastError=error;
        if(error?.status&&error.status!==404)throw error;
      }
    }
    throw lastError||new Error(tr('Timetable AI service is unreachable.','خدمة مساعد الجدول غير متاحة.'));
  }

  function applyLocalUndo(aiState){
    if(!aiState.draftHistory.length)return false;
    aiState.draft=aiState.draftHistory.pop();
    aiState.messages.push({
      role:'assistant',
      content:tr(
        'Restored the previous timetable draft.',
        'تم التراجع واستعادة المسودة السابقة للجدول.'
      )
    });
    return true;
  }

  async function sendTimetableMessage(customPrompt,isRetry=false){
    const aiState=ensureState();
    if(!aiState||aiState.busy)return null;

    const inputEl=document.getElementById('ttAiPromptInput');
    const promptText=typeof customPrompt==='string'
      ?customPrompt.trim()
      :String(inputEl?.value??'').trim();

    let payloadToSend=null;
    let attachmentUsed=null;

    if(isRetry&&aiState.lastFailedPayload){
      payloadToSend=aiState.lastFailedPayload.payload;
      attachmentUsed=aiState.lastFailedPayload.attachment;
    }else{
      if(/^(undo|undo the previous change|revert|تراجع)$/i.test(promptText)&&!aiState.pendingAttachment){
        if(applyLocalUndo(aiState)){
          if(inputEl)inputEl.value='';
          renderModalIfOpen();
          return {reply:'Undo applied',changed:true,entries:aiState.draft||[]};
        }
      }

      attachmentUsed=aiState.pendingAttachment;
      if(!promptText&&!attachmentUsed){
        notify(
          'Enter a message or attach your timetable PDF/image.',
          'أدخل رسالة أو أرفق ملف الجدول بصيغة PDF أو صورة.'
        );
        return null;
      }

      const currentSaved=validateEntries(state?.timetable?.entries||[]);
      const activeDraft=Array.isArray(aiState.draft)
        ?validateEntries(aiState.draft)
        :currentSaved;
      const previousDraft=aiState.draftHistory.length
        ?validateEntries(aiState.draftHistory[aiState.draftHistory.length-1])
        :null;

      const shouldUploadBinary=attachmentUsed&&
        !aiState.uploadedFingerprints.has(attachmentUsed.fingerprint);

      payloadToSend={
        prompt:promptText,
        lang:isAr()?'ar':'en',
        attachments:shouldUploadBinary
          ?[{
              name:attachmentUsed.name,
              mimeType:attachmentUsed.mimeType,
              data:attachmentUsed.data
            }]
          :[],
        currentEntries:currentSaved,
        draftEntries:activeDraft,
        previousDraftEntries:previousDraft,
        extracted:aiState.extracted,
        messages:aiState.messages
          .filter(m=>!m.error)
          .slice(-10)
          .map(m=>({role:m.role,content:m.content}))
      };

      aiState.messages.push({
        role:'user',
        content:promptText||tr('Attached timetable document','مرفق الجدول الدراسي'),
        attachmentName:attachmentUsed?.name||''
      });
      if(inputEl)inputEl.value='';
    }

    aiState.busy=true;
    aiState.lastFailedPayload=null;
    renderModalIfOpen();

    try{
      const response=await invokeGeminiTimetableBackend(payloadToSend);
      const nextEntries=validateEntries(response?.entries||[]);

      if(attachmentUsed?.fingerprint){
        aiState.uploadedFingerprints.add(attachmentUsed.fingerprint);
        aiState.pendingAttachment=null;
      }

      if(response?.extracted&&typeof response.extracted==='object'){
        aiState.extracted=response.extracted;
      }

      if(response?.changed||aiState.draft===null){
        if(Array.isArray(aiState.draft)){
          aiState.draftHistory.push(validateEntries(aiState.draft));
        }else if(Array.isArray(state?.timetable?.entries)){
          aiState.draftHistory.push(validateEntries(state.timetable.entries));
        }
        aiState.draft=nextEntries;
      }

      aiState.messages.push({
        role:'assistant',
        content:String(response?.reply||'').trim()||tr(
          'Draft schedule updated. Review the entries on the right before saving.',
          'تم تحديث مسودة الجدول. راجع الحصص في القائمة الجانبية قبل الحفظ.'
        )
      });

      aiState.busy=false;
      renderModalIfOpen();
      return response;
    }catch(error){
      aiState.busy=false;
      aiState.lastFailedPayload={
        payload:payloadToSend,
        attachment:attachmentUsed
      };
      if(attachmentUsed&&!aiState.pendingAttachment){
        aiState.pendingAttachment=attachmentUsed;
      }
      aiState.messages.push({
        role:'assistant',
        error:true,
        canRetry:true,
        content:error?.message||tr(
          'Could not process the timetable request. Your attachment and message are preserved — click Retry.',
          'تعذر معالجة طلب الجدول. تم الاحتفاظ بالملف والرسالة — اضغط إعادة المحاولة.'
        )
      });
      renderModalIfOpen();
      return null;
    }
  }

  async function applyDraftToTimetable(){
    const aiState=ensureState();
    if(!aiState||!Array.isArray(aiState.draft))return false;
    if(typeof authUser==='undefined'||!authUser?.id){
      notify('Please sign in first.','يرجى تسجيل الدخول أولاً.');
      return false;
    }
    const entries=validateEntries(aiState.draft);
    aiState.busy=true;
    renderModalIfOpen();

    try{
      if(typeof sb!=='undefined'&&sb?.from){
        const del=await sb.from('user_timetable_entries')
          .delete()
          .eq('user_id',authUser.id);
        if(del?.error)throw del.error;

        if(entries.length){
          const insertRows=entries.map(row=>({
            user_id:authUser.id,
            day_of_week:row.day_of_week,
            title:row.title,
            start_time:row.start_time,
            end_time:row.end_time,
            location:row.location||'',
            notes:row.notes||'',
            category:row.category||'Class',
            color:row.color||'#2f7db8'
          }));
          const ins=await sb.from('user_timetable_entries')
            .insert(insertRows)
            .select('id,user_id,day_of_week,title,start_time,end_time,notes,location,category,color,created_at,updated_at');
          if(ins?.error)throw ins.error;
          if(state?.timetable){
            state.timetable.entries=Array.isArray(ins.data)?ins.data:entries;
          }
        }else if(state?.timetable){
          state.timetable.entries=[];
        }
      }else if(state?.timetable){
        state.timetable.entries=entries;
      }

      aiState.busy=false;
      if(typeof closeModal==='function')closeModal();
      if(typeof render==='function')render();
      notify(
        'Timetable updated from Gemini AI draft.',
        'تم حفظ الجدول الدراسي من مسودة المساعد الذكي.'
      );
      return true;
    }catch(error){
      aiState.busy=false;
      renderModalIfOpen();
      notify(
        error?.message||'Could not save timetable entries.',
        error?.message||'تعذر حفظ حصص الجدول.'
      );
      return false;
    }
  }

  function buildModalMarkup(){
    const aiState=ensureState();
    const draft=Array.isArray(aiState?.draft)
      ?aiState.draft
      :validateEntries(state?.timetable?.entries||[]);
    const dayLabels=isAr()?DAY_NAMES.ar:DAY_NAMES.en;

    const bubbles=aiState.messages.map((m,idx)=>`
      <div class="tt-ai-bubble ${m.role==='user'?'user':'assistant'}${m.error?' error':''}" data-tt-ai-msg="${idx}">
        ${m.attachmentName?`<div class="tt-ai-file-chip">PDF/IMG · ${safeEsc(m.attachmentName)}</div>`:''}
        <div>${safeEsc(m.content)}</div>
        ${m.canRetry?`<div style="margin-top:8px"><button type="button" class="secondary small" data-tt-ai-retry="true">${tr('Retry with preserved file','إعادة المحاولة مع نفس الملف')}</button></div>`:''}
      </div>
    `).join('');

    const draftItems=draft.length
      ?draft.map(item=>`
          <article class="tt-ai-draft-item" style="--tt-color:${safeEsc(item.color||'#2f7db8')}" data-tt-ai-draft-entry="${safeEsc(item.id)}">
            <div class="tt-ai-draft-item-top">
              <b>${safeEsc(item.title)}</b>
              <span>${safeEsc(dayLabels[item.day_of_week]||dayLabels[0])}</span>
            </div>
            <small>${safeEsc(item.start_time)} → ${safeEsc(item.end_time)}${item.location?' · '+safeEsc(item.location):''}</small>
          </article>
        `).join('')
      :`<div class="tt-empty-day" style="min-height:140px">
          <b>${tr('No draft lessons yet','لا توجد حصص في المسودة بعد')}</b>
          <small>${tr('Upload a timetable PDF/image or ask Gemini to add your classes.','ارفع جدولك بصيغة PDF أو صورة أو اطلب إضافة حصصك.')}</small>
        </div>`;

    return `
      <div class="modal-backdrop" id="ttAiModalBackdrop">
        <div class="modal tt-ai-modal" role="dialog" aria-modal="true" aria-labelledby="ttAiTitle">
          <header class="tt-ai-header">
            <div>
              <span class="eyebrow">${tr('Gemini 3.8 Flash · Native Visual Multimodal AI','Gemini 3.8 Flash · فهم بصري متعدد الوسائط')}</span>
              <h3 id="ttAiTitle">${tr('Timetable AI Assistant','مساعد الجدول الذكي')}</h3>
              <p>${tr('Upload an original PDF or image schedule. Gemini visually inspects tables, merged cells, and subject levels before preparing a draft for your confirmation.','ارفع ملف الجدول الأصلي (PDF أو صورة). يقوم Gemini بفحص الجداول والخلايا المدمجة ومستويات المواد بصرياً وتجهيز مسودة لمراجعتك.')}</p>
            </div>
            <button type="button" class="ghost small" data-tt-ai-close="true">${tr('Close','إغلاق')}</button>
          </header>

          <div class="tt-ai-body">
            <section class="tt-ai-chat-pane">
              <div class="tt-ai-messages" id="ttAiMessageList">${bubbles}</div>
              <form class="tt-ai-compose" id="ttAiComposeForm">
                ${aiState.pendingAttachment?`
                  <div class="tt-ai-attachment-bar" id="ttAiAttachmentBadge">
                    <span>${safeEsc(aiState.pendingAttachment.name)} (${safeEsc(aiState.pendingAttachment.mimeType)})</span>
                    <button type="button" class="ghost small" data-tt-ai-remove-file="true">${tr('Remove','إزالة')}</button>
                  </div>
                `:''}
                <div class="tt-ai-compose-row">
                  <input type="file" id="ttAiFileInput" accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp" hidden>
                  <button type="button" class="secondary small" id="ttAiAttachBtn" data-tt-ai-attach="true" ${aiState.busy?'disabled':''}>${tr('Attach PDF / Image','إرفاق PDF / صورة')}</button>
                  <input type="text" id="ttAiPromptInput" placeholder="${tr("e.g. Here's my timetable. I only take English, Physics L2, Maths L2, and ICT.","مثال: هذا جدولي، أدرس فقط English و Physics L2 و Maths L2 و ICT")}" ${aiState.busy?'disabled':''}>
                  <button type="submit" class="primary small" id="ttAiSendBtn" ${aiState.busy?'disabled':''}>${aiState.busy?tr('Analyzing…','جارٍ التحليل…'):tr('Send','إرسال')}</button>
                </div>
              </form>
            </section>

            <aside class="tt-ai-draft-pane">
              <div class="tt-ai-draft-head">
                <b>${tr('Draft Review','مراجعة المسودة')} (${draft.length})</b>
                ${aiState.draftHistory.length?`<button type="button" class="ghost small" data-tt-ai-undo="true" ${aiState.busy?'disabled':''}>${tr('Undo','تراجع')}</button>`:''}
              </div>
              <div class="tt-ai-draft-list" id="ttAiDraftList">${draftItems}</div>
              <div class="tt-ai-draft-actions">
                <button type="button" class="secondary small" data-tt-ai-discard="true" ${aiState.busy?'disabled':''}>${tr('Reset Draft','إعادة ضبط')}</button>
                <button type="button" class="primary small" id="ttAiApplyBtn" data-tt-ai-apply="true" ${aiState.busy?'disabled':''}>${tr('Apply to Timetable','حفظ في جدولي')}</button>
              </div>
            </aside>
          </div>
        </div>
      </div>
    `;
  }

  function bindModalEvents(root){
    if(!root)return;
    const aiState=ensureState();
    const list=root.querySelector('#ttAiMessageList');
    if(list)list.scrollTop=list.scrollHeight;

    root.querySelector('[data-tt-ai-close]')?.addEventListener('click',()=>{
      if(typeof closeModal==='function')closeModal();
      else root.innerHTML='';
    });

    const fileInput=root.querySelector('#ttAiFileInput');
    root.querySelector('[data-tt-ai-attach]')?.addEventListener('click',()=>{
      fileInput?.click();
    });

    fileInput?.addEventListener('change',async e=>{
      const file=e.target?.files?.[0];
      if(!file)return;
      try{
        aiState.pendingAttachment=await fileToBase64Attachment(file);
        renderModalIfOpen();
      }catch(err){
        notify(err.message,err.message);
      }
    });

    root.querySelector('[data-tt-ai-remove-file]')?.addEventListener('click',()=>{
      aiState.pendingAttachment=null;
      renderModalIfOpen();
    });

    root.querySelector('#ttAiComposeForm')?.addEventListener('submit',e=>{
      e.preventDefault();
      void sendTimetableMessage();
    });

    root.querySelectorAll('[data-tt-ai-retry]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        void sendTimetableMessage('',true);
      });
    });

    root.querySelector('[data-tt-ai-undo]')?.addEventListener('click',()=>{
      if(applyLocalUndo(aiState))renderModalIfOpen();
    });

    root.querySelector('[data-tt-ai-discard]')?.addEventListener('click',()=>{
      aiState.draft=validateEntries(state?.timetable?.entries||[]);
      aiState.draftHistory=[];
      renderModalIfOpen();
    });

    root.querySelector('[data-tt-ai-apply]')?.addEventListener('click',()=>{
      void applyDraftToTimetable();
    });
  }

  function openAssistantModal(){
    ensureState();
    const root=document.getElementById('modalRoot');
    if(!root)return;
    root.innerHTML=buildModalMarkup();
    bindModalEvents(root);
  }

  function renderModalIfOpen(){
    const root=document.getElementById('modalRoot');
    if(!root||!root.querySelector('#ttAiModalBackdrop'))return;
    const currentInput=root.querySelector('#ttAiPromptInput')?.value||'';
    root.innerHTML=buildModalMarkup();
    const nextInput=root.querySelector('#ttAiPromptInput');
    if(nextInput&&currentInput&&!state?.timetableAi?.busy){
      nextInput.value=currentInput;
    }
    bindModalEvents(root);
  }

  function ensureHeaderButton(){
    const actions=document.querySelector('#view .tt-head-actions');
    if(!actions||document.getElementById(OPEN_BUTTON_ID))return;
    const btn=document.createElement('button');
    btn.type='button';
    btn.id=OPEN_BUTTON_ID;
    btn.className='secondary tt-ai-open-button';
    btn.dataset.ttAiOpen='true';
    btn.textContent=tr('AI Assistant','مساعد الجدول الذكي');
    btn.title=tr(
      'Analyze PDF or image timetables with Gemini 3.8 Flash',
      'تحليل جدول الدراسة من ملف PDF أو صورة باستخدام Gemini 3.8 Flash'
    );
    btn.addEventListener('click',openAssistantModal);
    actions.insertBefore(btn,actions.firstChild);
  }

  function scheduleButtonCheck(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(()=>{
      scheduled=false;
      ensureHeaderButton();
    });
  }

  function bootObserver(){
    const viewRoot=document.getElementById('view');
    if(!viewRoot)return;
    const obs=new MutationObserver(scheduleButtonCheck);
    obs.observe(viewRoot,{childList:true,subtree:false});
    scheduleButtonCheck();
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',bootObserver);
  }else{
    bootObserver();
  }

  window.NEISTimetableAI={
    version:'1.0.0',
    provider:'gemini',
    model:'gemini-3.8-flash',
    open:openAssistantModal,
    send:sendTimetableMessage,
    applyDraft:applyDraftToTimetable,
    attachFile:async function(file){
      const aiState=ensureState();
      aiState.pendingAttachment=await fileToBase64Attachment(file);
      renderModalIfOpen();
      return aiState.pendingAttachment;
    },
    validateEntries,
    getState:ensureState
  };
})();
