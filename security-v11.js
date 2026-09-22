/* NEIS Circle v11 — isolated account lifecycle, policy and moderation UI. */
(function(){
  'use strict';
  const VERSION='2026.1';
  state.blockedAccounts=state.blockedAccounts||[];
  state.moderationTerms=state.moderationTerms||[];
  state.accountAccess=state.accountAccess||{status:'active',reason:'',guidelines_version:''};
  const tr=(en,arabic)=>state.lang==='ar'?arabic:en;

  function friendlySafetyError(value){
    const raw=String(value?.message||value||'');
    if(/community_content_rejected/i.test(raw))return tr('This text cannot be published because it contains explicit, hostile, or unprofessional language. Rewrite it respectfully and try again.','لا يمكن نشر هذا النص لأنه يحتوي على لغة صريحة أو عدائية أو غير مهنية. أعد صياغته باحترام ثم حاول مرة أخرى.');
    if(/account_access_disabled|account_blocked/i.test(raw))return tr('This account cannot use platform features. Contact an administrator if you believe this is a mistake.','لا يمكن لهذا الحساب استخدام خصائص المنصة. تواصل مع الإدارة إذا كنت تعتقد أن هذا خطأ.');
    return '';
  }

  const baseToast=toast;
  toast=function(value){baseToast(friendlySafetyError(value)||value)};
  if(window.neisFriendlyError){
    const baseFriendly=window.neisFriendlyError;
    window.neisFriendlyError=function(error,action){return friendlySafetyError(error)||baseFriendly(error,action)};
  }

  function policyMarkup(){return `<div class="policy-intro">${tr('NEIS Circle is a formal learning and community platform. Use it only for education, collaboration, school activities, constructive discussion, and safe professional networking.','NEIS Circle منصة رسمية للتعلم والمجتمع. استخدمها فقط للتعليم والتعاون والأنشطة المدرسية والنقاش البنّاء والتواصل المهني الآمن.')}</div><div class="policy-list"><section class="policy-section"><h3>${tr('Respect and professional language','الاحترام واللغة المهنية')}</h3><ul><li>${tr('No harassment, threats, bullying, hate, sexual content, profanity, or personal attacks.','يُمنع التحرش والتهديد والتنمر والكراهية والمحتوى الجنسي والألفاظ الصريحة والهجمات الشخصية.')}</li><li>${tr('Disagree with ideas respectfully; never target a person.','ناقش الأفكار باحترام ولا تستهدف الأشخاص.')}</li></ul></section><section class="policy-section"><h3>${tr('Useful and authentic content','محتوى مفيد وحقيقي')}</h3><ul><li>${tr('Share accurate, relevant learning, community, and opportunity content.','شارك محتوى دقيقًا ومرتبطًا بالتعلم والمجتمع والفرص.')}</li><li>${tr('No spam, scams, impersonation, misleading claims, or attempts to manipulate other users.','يُمنع السبام والاحتيال وانتحال الهوية والمعلومات المضللة ومحاولات التلاعب بالمستخدمين.')}</li></ul></section><section class="policy-section"><h3>${tr('Privacy and safety','الخصوصية والأمان')}</h3><ul><li>${tr('Do not publish private information, credentials, intimate media, or content you do not have permission to share.','لا تنشر معلومات خاصة أو بيانات دخول أو صورًا حميمة أو محتوى لا تملك إذنًا لمشاركته.')}</li><li>${tr('Report harmful behavior. Administrators may remove content or restrict accounts to protect the community.','أبلغ عن السلوك الضار. يحق للإدارة إزالة المحتوى أو تقييد الحسابات لحماية المجتمع.')}</li></ul></section></div>`}

  function openPolicies(){openModal(`<div class="modal-head"><div><h2>${tr('Community policies & guidelines','سياسات وإرشادات المجتمع')}</h2><p>${tr('Version','الإصدار')} ${VERSION}</p></div><button class="close" data-close>×</button></div>${policyMarkup()}<div class="modal-actions"><button class="primary" data-close>${tr('I understand','فهمت')}</button></div>`,true)}

  function confirmAction(title,copy,confirmLabel,handler,typed=''){
    openModal(`<div class="modal-head"><div><h2>${esc(title)}</h2><p>${esc(copy)}</p></div><button class="close" data-close>×</button></div>${typed?`<label class="field">${tr('Type','اكتب')} <b>${typed}</b><input id="dangerConfirm" autocomplete="off"></label>`:''}<div class="modal-actions"><button class="secondary" data-close>${tr('Cancel','إلغاء')}</button><button id="dangerProceed" class="primary danger" ${typed?'disabled':''}>${esc(confirmLabel)}</button></div>`);
    const input=$('#dangerConfirm'),go=$('#dangerProceed');
    if(input)input.oninput=()=>{go.disabled=input.value.trim()!==typed};
    go.onclick=handler;
  }

  async function deactivateAccount(){
    const btn=$('#dangerProceed');btn.disabled=true;
    const {error}=await sb.rpc('deactivate_my_account');
    if(error){toast(error);btn.disabled=false;return}
    await sb.auth.signOut();authUser=null;closeModal();authScreen();toast(tr('Account deactivated. You can reactivate it by signing in again.','تم تعطيل الحساب. يمكنك إعادة تفعيله بتسجيل الدخول مرة أخرى.'));
  }

  async function deleteAccount(){
    const btn=$('#dangerProceed');btn.disabled=true;
    const {error}=await sb.rpc('delete_my_account');
    if(error){toast(error);btn.disabled=false;return}
    try{await sb.auth.signOut()}catch(_){}
    authUser=null;localStorage.removeItem('neis-profile-v2');closeModal();authScreen();toast(tr('Your account and associated data were permanently deleted.','تم حذف حسابك والبيانات المرتبطة به نهائيًا.'));
  }

  function accountStateScreen(status,reason=''){
    document.body.classList.remove('app-ready');
    const blocked=status==='blocked';
    authRoot.innerHTML=`<section class="account-state-shell"><span class="badge-admin">${blocked?tr('ACCESS BLOCKED','الوصول محظور'):tr('ACCOUNT DEACTIVATED','الحساب معطل')}</span><h1>${blocked?tr('This account cannot access NEIS Circle','لا يمكن لهذا الحساب دخول NEIS Circle'):tr('Your account is deactivated','حسابك معطل')}</h1><p>${esc(reason||tr(blocked?'An administrator restricted this account for a policy or safety reason.':'Reactivate it to restore access to your profile and community.','قيّدت الإدارة هذا الحساب لسبب متعلق بالسياسات أو الأمان.'))}</p><div class="account-state-actions">${blocked?'':`<button class="primary" data-reactivate>${tr('Reactivate account','إعادة تفعيل الحساب')}</button>`}<button class="secondary" data-state-signout>${tr('Sign out','تسجيل الخروج')}</button></div></section>`;
    authRoot.querySelector('[data-state-signout]').onclick=signOut;
    const reactivate=authRoot.querySelector('[data-reactivate]');if(reactivate)reactivate.onclick=async()=>{reactivate.disabled=true;const {error}=await sb.rpc('reactivate_my_account');if(error){toast(error);reactivate.disabled=false;return}state.accountAccess={status:'active',reason:'',guidelines_version:state.accountAccess.guidelines_version};await loadLiveData();render();toast(tr('Account reactivated.','تمت إعادة تفعيل الحساب.'))};
  }

  const baseLoad=loadLiveData;
  loadLiveData=async function(){
    await baseLoad();
    if(!sb||!authUser)return;
    const [accessRes,termsRes,blocksRes]=await Promise.all([
      sb.rpc('account_access_status'),
      sb.from('moderation_terms').select('term,language,category').eq('active',true),
      state.isAdmin?sb.from('blocked_accounts').select('id,email,user_id,reason,created_at').order('created_at',{ascending:false}):Promise.resolve({data:[]})
    ]);
    if(!accessRes.error&&accessRes.data)state.accountAccess=accessRes.data;
    if(!termsRes.error)state.moderationTerms=termsRes.data||[];
    if(!blocksRes.error)state.blockedAccounts=blocksRes.data||[];
    if(['blocked','deactivated'].includes(state.accountAccess.status))setTimeout(()=>accountStateScreen(state.accountAccess.status,state.accountAccess.reason),0);
  };

  const baseSettings=settings;
  settings=function(){
    baseSettings();
    const modal=document.querySelector('#modalRoot .modal');if(!modal)return;
    const signout=modal.querySelector('.signout');
    const safety=document.createElement('section');safety.className='account-safety';
    safety.innerHTML=`<div><h3>${tr('Account & safety','الحساب والأمان')}</h3><p>${tr('Review the rules or control the lifecycle of your account.','راجع القواعد أو تحكم في دورة حياة حسابك.')}</p></div><button class="account-row" data-open-policies><span>${tr('Community policies & guidelines','سياسات وإرشادات المجتمع')}</span><b>→</b></button><div class="account-safety-actions"><button class="secondary" data-deactivate-account>${tr('Deactivate account','تعطيل الحساب')}</button><button class="secondary danger" data-delete-account>${tr('Delete permanently','حذف نهائي')}</button></div>`;
    modal.insertBefore(safety,signout||null);
    safety.querySelector('[data-open-policies]').onclick=openPolicies;
    safety.querySelector('[data-deactivate-account]').onclick=()=>confirmAction(tr('Deactivate your account?','تعطيل حسابك؟'),tr('Your profile and content remain stored, but your account cannot use the platform until you reactivate it.','سيظل ملفك ومحتواك محفوظين، لكن لن تتمكن من استخدام المنصة حتى تعيد التفعيل.'),tr('Deactivate','تعطيل'),deactivateAccount);
    safety.querySelector('[data-delete-account]').onclick=()=>confirmAction(tr('Delete your account permanently?','حذف حسابك نهائيًا؟'),tr('This permanently removes your account and associated content. This cannot be undone.','سيؤدي هذا إلى حذف حسابك والمحتوى المرتبط به نهائيًا، ولا يمكن التراجع.'),tr('Delete permanently','حذف نهائي'),deleteAccount,'DELETE');
  };

  function enhanceOnboarding(){
    const form=document.querySelector('#onboardForm'),actions=form?.querySelector('.modal-actions');if(!form||!actions||form.dataset.safetyReady)return;
    form.dataset.safetyReady='true';
    const acceptance=document.createElement('label');acceptance.className='policy-accept';acceptance.innerHTML=`<input id="acceptPolicies" type="checkbox" required><span>${tr('I agree to use NEIS Circle only for formal, safe, educational and constructive purposes, and I accept the','أوافق على استخدام NEIS Circle فقط للأغراض الرسمية والآمنة والتعليمية والبنّاءة، وأقبل')} <button type="button" class="author-link" data-open-policies>${tr('community policies','سياسات المجتمع')}</button>.</span>`;form.insertBefore(acceptance,actions);acceptance.querySelector('[data-open-policies]').onclick=openPolicies;
    const original=form.onsubmit;form.onsubmit=async e=>{await original(e);if(state.onboardingComplete)await sb.rpc('accept_guidelines',{version:VERSION})};
  }
  const onboardingObserver=new MutationObserver(enhanceOnboarding);
  onboardingObserver.observe(document.body,{childList:true,subtree:true});
  enhanceOnboarding();

  const baseAdmin=admin;
  admin=function(){
    const html=baseAdmin();if(!state.isAdmin)return html;
    return `${html}<section class="module-card" style="margin-top:18px"><div class="page-title"><div><h2>${tr('Account access control','التحكم في وصول الحسابات')}</h2><p>${tr('Block abusive users or emails. Enforcement occurs in the database, not only in the interface.','احظر المستخدمين أو عناوين البريد المسيئة. يُفرض الحظر في قاعدة البيانات وليس في الواجهة فقط.')}</p></div></div><div class="admin-access-grid"><form id="blockAccountForm" class="admin-access-form"><label class="field">${tr('User email','بريد المستخدم')}<input id="blockEmail" type="email" required placeholder="student@example.com"></label><label class="field">${tr('Reason','السبب')}<textarea id="blockReason" rows="3" maxlength="300" placeholder="${tr('Policy or safety reason','سبب متعلق بالسياسة أو الأمان')}"></textarea></label><button class="primary">${tr('Block access','حظر الوصول')}</button></form><div><h3>${tr('Blocked accounts','الحسابات المحظورة')}</h3><div class="blocked-list">${state.blockedAccounts.length?state.blockedAccounts.map(b=>`<div class="blocked-row"><div><b>${esc(b.email||b.user_id||'Account')}</b><small>${esc(b.reason||'')}</small></div><button class="secondary" data-unblock-account="${b.id}" data-unblock-email="${esc(b.email||'')}" data-unblock-user="${esc(b.user_id||'')}">${tr('Unblock','إلغاء الحظر')}</button></div>`).join(''):`<div class="empty"><b>${tr('No blocked accounts','لا توجد حسابات محظورة')}</b><span>${tr('Access restrictions will appear here.','ستظهر قيود الوصول هنا.')}</span></div>`}</div></div></div></section>`;
  };

  const baseBind=bindDynamic;
  bindDynamic=function(){
    baseBind();
    document.querySelectorAll('[data-open-policies]').forEach(b=>b.onclick=openPolicies);
    const form=$('#blockAccountForm');if(form)form.onsubmit=async e=>{e.preventDefault();const email=$('#blockEmail').value.trim().toLowerCase(),reason=$('#blockReason').value.trim();const button=form.querySelector('button');button.disabled=true;const {error}=await sb.rpc('admin_set_account_block',{target_email:email,target_user:null,should_block:true,block_reason:reason||'Access disabled by an administrator'});if(error){toast(error);button.disabled=false;return}await loadLiveData();render();toast(tr('Account access blocked.','تم حظر وصول الحساب.'))};
    document.querySelectorAll('[data-unblock-account]').forEach(b=>b.onclick=async()=>{b.disabled=true;const {error}=await sb.rpc('admin_set_account_block',{target_email:b.dataset.unblockEmail||null,target_user:b.dataset.unblockUser||null,should_block:false,block_reason:''});if(error){toast(error);b.disabled=false;return}await loadLiveData();render();toast(tr('Account access restored.','تمت استعادة وصول الحساب.'))});
  };

  document.addEventListener('submit',function(event){
    const form=event.target;if(!(form instanceof HTMLFormElement)||form.matches('#authForm,#onboardForm,#blockAccountForm'))return;
    const content=[...form.querySelectorAll('input:not([type=file]):not([type=hidden]),textarea,[contenteditable=true]')].map(el=>el.value||el.textContent||'').join(' ').toLowerCase();
    const bad=state.moderationTerms.find(x=>x.term&&content.includes(String(x.term).toLowerCase()));
    if(bad){event.preventDefault();event.stopImmediatePropagation();toast('community_content_rejected:'+bad.category)}
  },true);
})();
