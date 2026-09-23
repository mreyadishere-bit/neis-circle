/* NEIS Circle v17 — Google-first entry with required post-login mobile registration. */
(function(){
  'use strict';
  var authRoot=document.getElementById('authRoot');
  var status=null;
  var tr=(en,arText)=>state.lang==='ar'?arText:en;
  var errors={
    invalid_phone:['Enter a valid mobile number with country code, for example +201001234567.','أدخل رقم هاتف محمول صحيحًا مع كود الدولة، مثل +201001234567.'],
    identity_unavailable:['This phone number cannot be used. It may already belong to another account.','لا يمكن استخدام رقم الهاتف هذا، وقد يكون مرتبطًا بحساب آخر.'],
    phone_rate_limited:['Too many attempts. Wait 15 minutes and try again.','محاولات كثيرة. انتظر 15 دقيقة ثم حاول مجددًا.'],
    authentication_required:['Your session expired. Sign in with Google again.','انتهت الجلسة. سجّل الدخول باستخدام Google مرة أخرى.'],
    phone_registration_failed:['We could not save the mobile number. Please try again.','تعذر حفظ رقم الهاتف. حاول مرة أخرى.']
  };
  function errorText(value){var code=String(value?.context?.body?.error||value?.message||value||'phone_registration_failed');try{var parsed=JSON.parse(value?.context?.body||'{}');if(parsed.error)code=parsed.error}catch(_){}var pair=errors[code]||errors.phone_registration_failed;return tr(pair[0],pair[1])}
  function tools(){return `<div class="auth-tools"><button data-auth-lang>${state.lang==='ar'?'EN':'AR'}</button><button data-auth-theme>${state.theme==='light'?'◐':'☀'}</button></div>`}
  function bindTools(redraw){var lang=document.querySelector('[data-auth-lang]');if(lang)lang.onclick=function(){state.lang=state.lang==='ar'?'en':'ar';state.articleLanguage=state.lang;applyPrefs();redraw()};var theme=document.querySelector('[data-auth-theme]');if(theme)theme.onclick=function(){state.theme=state.theme==='light'?'dark':'light';applyPrefs();redraw()}}
  function googleAuthScreen(){
    document.body.classList.remove('app-ready');
    authRoot.innerHTML=`<section class="auth-shell"><div class="auth-story"><div class="auth-brand"><i>NC</i><span>NEIS Circle</span></div><div class="auth-story-copy"><h1>${tr('A better student network starts with you.','شبكة طلاب أفضل تبدأ بك.')}</h1><p>${tr('Sign in securely with Google, then complete your student identity before entering.','سجّل الدخول بأمان باستخدام Google، ثم أكمل هويتك الطلابية قبل الدخول.')}</p></div><div class="auth-points"><span>${tr('One secure Google account','حساب Google آمن واحد')}</span><span>${tr('A registered mobile number after sign-in','رقم هاتف مسجّل بعد الدخول')}</span><span>${tr('Private identity data and moderated communities','بيانات هوية خاصة ومجتمعات خاضعة للإشراف')}</span></div></div><div class="auth-panel">${tools()}<h2>${tr('Welcome to NEIS Circle','مرحبًا بك في NEIS Circle')}</h2><p>${tr('Continue with Google. We will ask for your mobile number only after Google signs you in.','تابع باستخدام Google، وسنطلب رقم هاتفك فقط بعد إتمام تسجيل الدخول.')}</p><button class="google-btn" data-auth-google><span class="google-mark">G</span>${tr('Continue with Google','المتابعة باستخدام Google')}</button><p class="auth-note">${tr('No email code is required.','لا يلزم إدخال أي كود للبريد.')}</p></div></section>`;
    document.querySelector('[data-auth-google]').onclick=function(){if(!sb){toast(tr('Connection is not ready. Please refresh.','الاتصال غير جاهز. حدّث الصفحة.'));return}googleSignIn()};bindTools(googleAuthScreen);
  }
  function phoneScreen(){
    document.body.classList.remove('app-ready');
    var email=authUser?.email||'';
    authRoot.innerHTML=`<section class="phone-verify-shell"><div class="phone-verify-brand"><i>NC</i><span>NEIS Circle</span></div>${tools()}<span class="onboard-step">${tr('REQUIRED STEP','خطوة إلزامية')}</span><h1>${tr('Add your mobile number','أدخل رقم هاتفك')}</h1><p>${tr(`Google sign-in is complete for ${email}. Add a valid mobile number before entering the platform.`,`تم تسجيل الدخول بحساب Google: ${email}. أدخل رقم هاتف صحيحًا قبل دخول المنصة.`)}</p><form id="mobileRegistrationForm"><label class="field">${tr('Mobile number with country code','رقم الهاتف مع كود الدولة')}<input id="registeredMobile" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" placeholder="+201001234567" required></label><small class="identity-help">${tr('The number is validated, normalized and kept private. No SMS or WhatsApp code will be sent.','يتم التحقق من صحة الرقم وتنسيقه وحفظه بخصوصية، ولن يتم إرسال كود SMS أو WhatsApp.')}</small><div id="mobileRegistrationError" class="form-error hidden" role="alert"></div><div class="phone-verify-actions"><button type="button" class="secondary" data-mobile-signout>${tr('Use another Google account','استخدم حساب Google آخر')}</button><button id="mobileRegistrationSubmit" class="primary">${tr('Save & continue','حفظ ومتابعة')}</button></div></form></section>`;
    document.querySelector('[data-mobile-signout]').onclick=signOut;document.getElementById('mobileRegistrationForm').onsubmit=registerMobile;bindTools(phoneScreen);
  }
  async function registerMobile(event){
    event.preventDefault();var button=document.getElementById('mobileRegistrationSubmit'),errorBox=document.getElementById('mobileRegistrationError'),phone=document.getElementById('registeredMobile').value.trim();
    errorBox.classList.add('hidden');button.disabled=true;button.textContent=tr('Checking securely…','جارٍ التحقق بأمان…');
    var result=await sb.functions.invoke('register-mobile',{body:{phone:phone}});
    if(result.error||result.data?.error){errorBox.textContent=errorText(result.data?.error||result.error);errorBox.classList.remove('hidden');button.disabled=false;button.textContent=tr('Save & continue','حفظ ومتابعة');return}
    status={phone_required:false,phone_validated:true,phone_masked:result.data?.phone_masked||''};state.identityVerification=status;await loadLiveData();render();toast(tr('Mobile number saved securely.','تم حفظ رقم الهاتف بأمان.'));
  }
  state.identityVerification=null;
  var previousLoad=loadLiveData;
  loadLiveData=async function(){
    await previousLoad();if(!sb||!authUser)return;
    var result=await sb.rpc('identity_verification_status');
    status=!result.error&&result.data?result.data:{phone_required:true,load_error:true};state.identityVerification=status;
  };
  var previousRender=render;
  render=function(){if(!authUser){googleAuthScreen();return}if(!status||status.phone_required!==false){phoneScreen();return}return previousRender()};
  var previousSignOut=signOut;
  signOut=async function(){await previousSignOut();status=null;state.identityVerification=null;googleAuthScreen()};
  if(!authUser){setTimeout(googleAuthScreen,0);setTimeout(function(){if(!authUser)googleAuthScreen()},600)}
})();
