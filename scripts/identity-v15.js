/* NEIS Circle v15 — email OTP signup and server-validated registered mobile identity. */
(function(){
  'use strict';
  var authRoot=document.getElementById('authRoot');
  var mode='signin';
  var pending={email:'',mode:'signin',phone:'',sentAt:0};
  var tr=(en,arText)=>state.lang==='ar'?arText:en;
  var errors={
    invalid_email:['Enter a valid email address.','أدخل بريدًا إلكترونيًا صحيحًا.'],
    invalid_phone:['Enter a valid mobile number with country code, for example +201001234567.','أدخل رقم هاتف محمول صحيحًا مع كود الدولة، مثل +201001234567.'],
    identity_unavailable:['This email or phone number cannot be used.','لا يمكن استخدام هذا البريد أو رقم الهاتف.'],
    signup_rate_limited:['Too many attempts. Wait 15 minutes and try again.','محاولات كثيرة. انتظر 15 دقيقة ثم حاول مجددًا.'],
    signup_validation_failed:['We could not validate these details. Please try again.','تعذر التحقق من هذه البيانات. حاول مرة أخرى.'],
    otp_expired:['The code is incorrect or expired. Request a new code.','الرمز غير صحيح أو منتهي. اطلب رمزًا جديدًا.'],
    email_not_registered:['No active account uses this email. Create an account first.','لا يوجد حساب نشط بهذا البريد. أنشئ حسابًا أولًا.'],
    email_send_failed:['We could not send the email code. Please try again.','تعذر إرسال رمز البريد. حاول مرة أخرى.']
  };
  function errorText(value){
    var code=String(value?.context?.body?.error||value?.message||value||'signup_validation_failed');
    try{var parsed=JSON.parse(value?.context?.body||'{}');if(parsed.error)code=parsed.error}catch(_){}
    if(/expired|invalid.*token|otp/i.test(code))code='otp_expired';
    if(/user not found|signups not allowed/i.test(code))code='email_not_registered';
    var pair=errors[code]||errors.signup_validation_failed;return tr(pair[0],pair[1]);
  }
  function authTools(){return `<div class="auth-tools"><button data-auth-lang>${state.lang==='ar'?'EN':'AR'}</button><button data-auth-theme>${state.theme==='light'?'◐':'☀'}</button></div>`}
  function story(){return `<div class="auth-story"><div class="auth-brand"><i>NC</i><span>NEIS Circle</span></div><div class="auth-story-copy"><h1>${tr('A better student network starts with you.','شبكة طلاب أفضل تبدأ بك.')}</h1><p>${tr('A private space for useful questions, real experiences and student communities.','مساحة خاصة للأسئلة المفيدة والخبرات الحقيقية والمجتمعات الطلابية.')}</p></div><div class="auth-points"><span>${tr('Email verified with a secure one-time code','بريد موثّق برمز آمن لمرة واحدة')}</span><span>${tr('Registered mobile identity kept private','رقم هاتف مسجّل ومحفوظ بخصوصية')}</span><span>${tr('Moderated communities and protected data','مجتمعات خاضعة للإشراف وبيانات محمية')}</span></div></div>`}
  function bindTools(){
    var lang=document.querySelector('[data-auth-lang]');if(lang)lang.onclick=function(){state.lang=state.lang==='ar'?'en':'ar';state.articleLanguage=state.lang;applyPrefs();emailAuthScreen()};
    var theme=document.querySelector('[data-auth-theme]');if(theme)theme.onclick=function(){state.theme=state.theme==='light'?'dark':'light';applyPrefs();emailAuthScreen()};
  }
  function setError(value){var box=document.getElementById('emailAuthError');if(box){box.textContent=value;box.classList.remove('hidden')}}
  function authPanel(){
    var signup=mode==='signup';
    return `<div class="auth-panel">${authTools()}<h2>${signup?tr('Create your account','أنشئ حسابك'):tr('Welcome back','مرحبًا بعودتك')}</h2><p>${signup?tr('Verify your email and register a valid mobile number before entering.','وثّق بريدك وسجّل رقم هاتف صحيحًا قبل الدخول.'):tr('Use an email code or your existing Google account.','استخدم رمز البريد أو حساب Google الحالي.')}</p><div class="auth-choice"><button class="${!signup?'active':''}" data-auth-mode="signin">${tr('Sign in','تسجيل الدخول')}</button><button class="${signup?'active':''}" data-auth-mode="signup">${tr('Create account','إنشاء حساب')}</button></div><form id="emailAuthForm" class="identity-auth-form"><label class="field">${tr('Email address','البريد الإلكتروني')}<input id="authEmail" type="email" autocomplete="email" maxlength="254" required></label>${signup?`<label class="field">${tr('Mobile number with country code','رقم الهاتف مع كود الدولة')}<input id="authPhone" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" placeholder="+201001234567" required></label><small class="identity-help">${tr('The number is validated and registered for account security. Phone ownership is not OTP-verified.','يتم التحقق من صيغة الرقم وتسجيله لأمان الحساب، لكن ملكية الهاتف لا يتم توثيقها برمز.')}</small>`:''}<div id="emailAuthError" class="form-error hidden" role="alert"></div><button id="emailAuthSubmit" class="primary">${signup?tr('Send email verification code','إرسال رمز تحقق البريد'):tr('Send sign-in code','إرسال رمز الدخول')}</button></form>${!signup?`<div class="auth-divider"><span>${tr('or','أو')}</span></div><button class="google-btn" data-auth-google><span class="google-mark">G</span>${tr('Continue with Google','المتابعة باستخدام Google')}</button>`:''}<p class="auth-note">${tr('Codes expire quickly, resend is rate-limited, and verification happens through Supabase Auth.','تنتهي صلاحية الرموز سريعًا، وإعادة الإرسال محدودة، والتحقق يتم عبر Supabase Auth.')}</p></div>`;
  }
  function emailAuthScreen(){
    document.body.classList.remove('app-ready');
    authRoot.innerHTML=`<section class="auth-shell">${story()}${authPanel()}</section>`;
    document.querySelectorAll('[data-auth-mode]').forEach(function(button){button.onclick=function(){mode=button.dataset.authMode;pending={email:'',mode:mode,phone:'',sentAt:0};emailAuthScreen()}});
    var google=document.querySelector('[data-auth-google]');if(google)google.onclick=function(){if(!sb){toast(tr('Connection is not ready. Please refresh.','الاتصال غير جاهز. حدّث الصفحة.'));return}googleSignIn()};
    document.getElementById('emailAuthForm').onsubmit=startEmailAuth;bindTools();
  }
  async function startEmailAuth(event){
    event.preventDefault();
    var button=document.getElementById('emailAuthSubmit'),email=document.getElementById('authEmail').value.trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){setError(errorText('invalid_email'));return}
    button.disabled=true;button.textContent=tr('Checking securely…','جارٍ التحقق بأمان…');
    var options={shouldCreateUser:false};
    if(mode==='signup'){
      var phone=document.getElementById('authPhone').value.trim();
      var validation=await sb.functions.invoke('email-signup-validate',{body:{email:email,phone:phone}});
      if(validation.error||validation.data?.error){setError(errorText(validation.data?.error||validation.error));button.disabled=false;button.textContent=tr('Send email verification code','إرسال رمز تحقق البريد');return}
      pending.phone=validation.data.phone;options={shouldCreateUser:true,data:{signup_ticket:validation.data.ticket}};
    }
    var result=await sb.auth.signInWithOtp({email:email,options:options});
    if(result.error){setError(errorText(result.error));button.disabled=false;button.textContent=mode==='signup'?tr('Send email verification code','إرسال رمز تحقق البريد'):tr('Send sign-in code','إرسال رمز الدخول');return}
    pending.email=email;pending.mode=mode;pending.sentAt=Date.now();showOtp();
  }
  function showOtp(){
    document.body.classList.remove('app-ready');
    authRoot.innerHTML=`<section class="phone-verify-shell email-verify-shell"><div class="phone-verify-brand"><i>NC</i><span>NEIS Circle</span></div><span class="onboard-step">${tr('EMAIL VERIFICATION','توثيق البريد')}</span><h1>${tr('Enter the email code','أدخل رمز البريد')}</h1><p>${tr(`We sent a one-time code to ${pending.email}.`,`أرسلنا رمزًا لمرة واحدة إلى ${pending.email}.`)}</p><form id="emailOtpForm"><label class="field">${tr('Verification code','رمز التحقق')}<input id="emailOtpCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" maxlength="8" required autofocus></label><div id="emailAuthError" class="form-error hidden" role="alert"></div><div class="phone-verify-actions"><button type="button" class="secondary" data-back-auth>${tr('Back','رجوع')}</button><button id="emailOtpSubmit" class="primary">${tr('Verify & continue','تحقق وتابع')}</button></div></form><button type="button" class="phone-signout" data-resend-email>${tr('Resend code','إعادة إرسال الرمز')}</button><p class="phone-privacy">${tr('The code is verified server-side and is never stored in this page.','يتم التحقق من الرمز على الخادم ولا يتم تخزينه في الصفحة.')}</p></section>`;
    document.querySelector('[data-back-auth]').onclick=emailAuthScreen;
    document.querySelector('[data-resend-email]').onclick=resendEmail;
    document.getElementById('emailOtpForm').onsubmit=verifyEmailOtp;
  }
  async function verifyEmailOtp(event){
    event.preventDefault();var button=document.getElementById('emailOtpSubmit'),token=document.getElementById('emailOtpCode').value.replace(/\D/g,'');
    button.disabled=true;button.textContent=tr('Verifying…','جارٍ التحقق…');
    var result=await sb.auth.verifyOtp({email:pending.email,token:token,type:'email'});
    if(result.error||!result.data?.session){setError(errorText(result.error||'otp_expired'));button.disabled=false;button.textContent=tr('Verify & continue','تحقق وتابع');return}
    authUser=result.data.user;await loadLiveData();render();toast(tr('Email verified successfully.','تم توثيق البريد بنجاح.'));
  }
  async function resendEmail(){
    var button=document.querySelector('[data-resend-email]'),remaining=60-Math.floor((Date.now()-pending.sentAt)/1000);
    if(remaining>0){setError(tr(`Wait ${remaining} seconds before resending.`,`انتظر ${remaining} ثانية قبل إعادة الإرسال.`));return}
    button.disabled=true;
    var options=pending.mode==='signup'?{shouldCreateUser:true}:{shouldCreateUser:false};
    var result=await sb.auth.signInWithOtp({email:pending.email,options:options});
    if(result.error){setError(errorText(result.error));button.disabled=false;return}
    pending.sentAt=Date.now();button.disabled=false;toast(tr('A new code was sent.','تم إرسال رمز جديد.'));
  }

  state.identityVerification=state.identityVerification||{};
  var previousLoad=loadLiveData;
  loadLiveData=async function(){
    await previousLoad();if(!sb||!authUser)return;
    var status=await sb.rpc('identity_verification_status');
    if(!status.error&&status.data)state.identityVerification=status.data;
  };
  var previousRender=render;
  render=function(){if(!authUser){emailAuthScreen();return}return previousRender()};
  var previousSignOut=signOut;
  signOut=async function(){await previousSignOut();emailAuthScreen()};
  if(!authUser){setTimeout(emailAuthScreen,0);setTimeout(function(){if(!authUser)emailAuthScreen()},600)}
})();
