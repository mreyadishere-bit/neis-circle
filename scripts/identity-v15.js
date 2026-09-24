/* NEIS Circle v17 — Google sign-in with a post-login registered mobile gate. */
(function(){
  'use strict';
  var authRoot=document.getElementById('authRoot');
  var tr=(en,arText)=>state.lang==='ar'?arText:en;
  var errors={
    invalid_phone:['Enter a valid mobile number with country code, for example +201001234567.','أدخل رقم هاتف محمول صحيحًا مع كود الدولة، مثل +201001234567.'],
    identity_unavailable:['This phone number cannot be used.','لا يمكن استخدام رقم الهاتف هذا.'],
    save_failed:['We could not save your number. Please try again.','تعذر حفظ رقمك. حاول مرة أخرى.'],
    save_unconfirmed:['Your number was not confirmed in the database. Please try again.','لم يتم تأكيد حفظ رقمك في قاعدة البيانات. حاول مرة أخرى.']
  };
  function authTools(){return `<div class="auth-tools"><button data-auth-lang>${state.lang==='ar'?'EN':'AR'}</button><button class="theme-control" data-auth-theme aria-label="${tr('Toggle color theme','تغيير مظهر الألوان')}"><span aria-hidden="true"></span></button></div>`}
  function story(){return `<div class="auth-story"><div class="auth-brand"><i>NC</i><span>NEIS Circle</span></div><div class="auth-story-copy"><h1>${tr('A better student network starts with you.','شبكة طلاب أفضل تبدأ بك.')}</h1><p>${tr('A private space for useful questions, real experiences and student communities.','مساحة خاصة للأسئلة المفيدة والخبرات الحقيقية والمجتمعات الطلابية.')}</p></div><div class="auth-points"><span>${tr('Secure sign-in with your Google account','تسجيل دخول آمن بحساب Google')}</span><span>${tr('Registered mobile identity kept private','رقم هاتف مسجّل ومحفوظ بخصوصية')}</span><span>${tr('Moderated communities and protected data','مجتمعات خاضعة للإشراف وبيانات محمية')}</span></div></div>`}
  function bindTools(){
    var lang=document.querySelector('[data-auth-lang]');if(lang)lang.onclick=function(){state.lang=state.lang==='ar'?'en':'ar';state.articleLanguage=state.lang;applyPrefs();authScreen()};
    var theme=document.querySelector('[data-auth-theme]');if(theme)theme.onclick=function(){state.theme=state.theme==='light'?'dark':'light';applyPrefs();authScreen()};
  }
  function oauthError(){
    var raw=location.search+location.hash.replace('#','&'),match=/[?&]error_description=([^&]+)/.exec(raw);
    if(!match)return '';
    var message=decodeURIComponent(match[1].replace(/\+/g,' '));
    try{history.replaceState(null,'',location.pathname)}catch(_){/* ignore */}
    return message;
  }
  function authScreen(){
    document.body.classList.remove('app-ready');
    var failed=oauthError();
    authRoot.innerHTML=`<section class="auth-shell">${story()}<div class="auth-panel">${authTools()}<h2>${tr('Welcome to NEIS Circle','مرحبًا بك في NEIS Circle')}</h2><p>${tr('Sign in with your Google account to continue.','سجّل الدخول بحساب Google للمتابعة.')}</p>${failed?`<div class="form-error" role="alert">${esc(tr('Sign-in failed','فشل تسجيل الدخول'))}: ${esc(failed)}</div>`:''}<button class="google-btn" data-auth-google><span class="google-mark">G</span>${tr('Continue with Google','المتابعة باستخدام Google')}</button><p class="auth-note">${tr('After signing in, you will register your mobile number once before entering.','بعد تسجيل الدخول، ستسجّل رقم هاتفك مرة واحدة قبل الدخول.')}</p></div></section>`;
    document.querySelector('[data-auth-google]').onclick=function(){if(!sb){toast(tr('Connection is not ready. Please refresh.','الاتصال غير جاهز. حدّث الصفحة.'));return}googleSignIn()};
    bindTools();
  }
  function needsPhone(){
    if(!sb||!authUser)return false;
    var status=state.identityVerification;
    if(!status||status.__loaded!==true)return false;
    return !(status.phone_validated||status.phone_verified);
  }
  function phoneGate(){
    document.body.classList.remove('app-ready');
    authRoot.innerHTML=`<section class="phone-verify-shell"><div class="phone-verify-brand"><i>NC</i><span>NEIS Circle</span></div><span class="onboard-step">${tr('MOBILE REGISTRATION','تسجيل الهاتف')}</span><h1>${tr('Register your mobile number','سجّل رقم هاتفك')}</h1><p>${tr('One last step before entering. Your number stays private and is used only for account security.','خطوة أخيرة قبل الدخول. يبقى رقمك خاصًا ويُستخدم لأمان الحساب فقط.')}</p><form id="phoneGateForm"><label class="field">${tr('Mobile number with country code','رقم الهاتف مع كود الدولة')}<input id="gatePhone" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" placeholder="+201001234567" required autofocus></label><div id="phoneGateError" class="form-error hidden" role="alert"></div><div class="phone-verify-actions"><button id="phoneGateSubmit" class="primary">${tr('Save & continue','حفظ ومتابعة')}</button></div></form><button type="button" class="phone-signout" data-gate-signout>${tr('Sign out','تسجيل الخروج')}</button><p class="phone-privacy">${tr('The number is validated and stored server-side and is never shown to other students.','يتم التحقق من الرقم وتخزينه على الخادم ولا يظهر للطلاب الآخرين أبدًا.')}</p></section>`;
    document.getElementById('phoneGateForm').onsubmit=submitPhone;
    document.querySelector('[data-gate-signout]').onclick=signOut;
  }
  async function submitPhone(event){
    event.preventDefault();
    var button=document.getElementById('phoneGateSubmit'),errorBox=document.getElementById('phoneGateError');
    var phone=document.getElementById('gatePhone').value.trim();
    var normalizedPhone=phone.replace(/[\s\-().]/g,'');
    function fail(pair){errorBox.textContent=tr(pair[0],pair[1]);errorBox.classList.remove('hidden');button.disabled=false;button.textContent=tr('Save & continue','حفظ ومتابعة')}
    if(!/^\+[1-9][0-9]{7,14}$/.test(normalizedPhone)){fail(errors.invalid_phone);return}
    button.disabled=true;button.textContent=tr('Saving…','جارٍ الحفظ…');
    var result=await sb.rpc('register_own_phone',{phone_input:normalizedPhone});
    if(result.error){
      var code=String(result.error.message||'');
      fail(/invalid_phone/.test(code)?errors.invalid_phone:/identity_unavailable/.test(code)?errors.identity_unavailable:errors.save_failed);
      return;
    }
    var saved=result.data||{};
    if(!(saved.phone_validated||saved.phone_verified)){fail(errors.save_unconfirmed);return}
    var status=await sb.rpc('identity_verification_status');
    if(status.error||!(status.data?.phone_validated||status.data?.phone_verified)||!status.data?.phone_masked){
      fail(errors.save_unconfirmed);return;
    }
    state.identityVerification=Object.assign({},status.data,{__loaded:true});
    await loadLiveData();
    if(!(state.identityVerification?.phone_validated||state.identityVerification?.phone_verified)){
      fail(errors.save_unconfirmed);return;
    }
    render();toast(tr('Mobile number registered. Welcome!','تم تسجيل رقم الهاتف. أهلًا بك!'));
  }

  state.identityVerification=state.identityVerification||{};
  var previousLoad=loadLiveData;
  loadLiveData=async function(){
    await previousLoad();if(!sb||!authUser)return;
    var status=await sb.rpc('identity_verification_status');
    if(!status.error){var data=status.data||{};data.__loaded=true;state.identityVerification=data}
  };
  var previousRender=render;
  render=function(){
    if(!authUser){authScreen();return}
    if(needsPhone()){phoneGate();return}
    return previousRender();
  };
  var previousSignOut=signOut;
  signOut=async function(){state.identityVerification={};await previousSignOut();authScreen()};
  if(!authUser){setTimeout(authScreen,0);setTimeout(function(){if(!authUser)authScreen()},600)}
})();
