/* NEIS Circle v14 — verified WhatsApp identity gate and private moderation identity state. */
(function(){
  'use strict';
  state.identityVerification=state.identityVerification||{verification_required:false,email_verified:false,phone_verified:false,phone_masked:'',verified_at:null};
  var pendingPhone='';
  var cooldownTimer=0;
  var tr=function(en,ar){return state.lang==='ar'?ar:en};
  var messages={
    invalid_phone:['Enter a valid international number starting with +, for example +201001234567.','أدخل رقمًا دوليًا صحيحًا يبدأ بـ +، مثل +201001234567.'],
    identity_blocked:['This verified identity cannot register for NEIS Circle.','لا يمكن لهذه الهوية الموثقة التسجيل في NEIS Circle.'],
    phone_already_registered:['This phone is already verified on another account.','هذا الهاتف موثق بالفعل في حساب آخر.'],
    otp_send_rate_limited:['Too many code requests. Wait 10 minutes before trying again.','تم طلب رموز كثيرة. انتظر 10 دقائق قبل المحاولة مجددًا.'],
    otp_attempt_rate_limited:['Too many verification attempts. Wait 15 minutes before trying again.','محاولات تحقق كثيرة. انتظر 15 دقيقة قبل المحاولة مجددًا.'],
    invalid_or_expired_code:['That code is incorrect or expired. Request a new code and try again.','الرمز غير صحيح أو منتهي. اطلب رمزًا جديدًا وحاول مجددًا.'],
    verification_provider_not_configured:['WhatsApp verification is temporarily unavailable. An administrator must finish the approved provider setup.','التحقق عبر واتساب غير متاح مؤقتًا. يجب أن تكمل الإدارة إعداد مزوّد الرسائل المعتمد.'],
    verification_failed:['We could not verify this number. Check it and try again.','تعذر التحقق من هذا الرقم. راجعه وحاول مرة أخرى.']
  };
  function errorText(error){
    var code=String(error?.context?.body?.error||error?.message||error||'verification_failed');
    try{var parsed=JSON.parse(error?.context?.body||'{}');if(parsed.error)code=parsed.error}catch(_){}
    var pair=messages[code]||messages.verification_failed;return tr(pair[0],pair[1]);
  }
  function shell(content){
    document.body.classList.remove('app-ready');
    var root=document.getElementById('authRoot');root.style.display='grid';root.innerHTML=content;
  }
  function phoneScreen(step){
    var codeStep=step==='code'&&pendingPhone;
    shell(`<section class="phone-verify-shell"><div class="phone-verify-brand"><i>NC</i><span>NEIS Circle</span></div><span class="onboard-step">${tr(codeStep?'STEP 2 OF 2':'STEP 1 OF 2',codeStep?'الخطوة ٢ من ٢':'الخطوة ١ من ٢')}</span><h1>${tr(codeStep?'Enter the WhatsApp code':'Verify your WhatsApp number',codeStep?'أدخل رمز واتساب':'وثّق رقم واتساب')}</h1><p>${codeStep?tr(`We sent a one-time code to ${pendingPhone}. The code expires and cannot be read by this website.`,`أرسلنا رمزًا لمرة واحدة إلى ${pendingPhone}. الرمز مؤقت ولا يمكن للموقع قراءته.`):tr('Use a WhatsApp-capable number in international E.164 format. Your number is private and visible only to authorized administrators.','استخدم رقمًا يدعم واتساب بالصيغة الدولية E.164. رقمك خاص ولا يظهر إلا للمسؤولين المصرح لهم.')}</p><form id="phoneVerifyForm">${codeStep?`<label class="field">${tr('Verification code','رمز التحقق')}<input id="otpCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4,10}" maxlength="10" required autofocus></label>`:`<label class="field">${tr('WhatsApp number','رقم واتساب')}<input id="whatsappPhone" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" placeholder="+201001234567" pattern="\+[1-9][0-9]{7,14}" required autofocus></label>`}<div id="phoneVerifyError" class="form-error hidden" role="alert"></div><div class="phone-verify-actions">${codeStep?`<button type="button" class="secondary" data-change-phone>${tr('Change number','تغيير الرقم')}</button>`:''}<button id="phoneVerifySubmit" class="primary">${tr(codeStep?'Verify & continue':'Send WhatsApp code',codeStep?'تحقق وتابع':'إرسال رمز واتساب')}</button></div></form><button class="phone-signout" type="button" data-phone-signout>${tr('Sign out','تسجيل الخروج')}</button><p class="phone-privacy">${tr('Codes are validated server-side through an approved WhatsApp provider. Codes are never embedded in the page or stored here in plaintext.','تُتحقق الرموز على الخادم عبر مزوّد واتساب معتمد، ولا تُضمّن في الصفحة أو تُخزن هنا كنص صريح.')}</p></section>`);
    var form=document.getElementById('phoneVerifyForm');
    document.querySelector('[data-phone-signout]').onclick=signOut;
    var change=document.querySelector('[data-change-phone]');if(change)change.onclick=function(){pendingPhone='';phoneScreen('phone')};
    form.onsubmit=codeStep?verifyCode:sendCode;
  }
  function showError(value){var box=document.getElementById('phoneVerifyError');if(!box)return;box.textContent=value;box.classList.remove('hidden')}
  async function sendCode(event){
    event.preventDefault();var button=document.getElementById('phoneVerifySubmit'),phone=document.getElementById('whatsappPhone').value.replace(/[\s().-]/g,'');
    if(!/^\+[1-9][0-9]{7,14}$/.test(phone)){showError(errorText('invalid_phone'));return}
    button.disabled=true;button.textContent=tr('Sending securely…','جارٍ الإرسال الآمن…');
    var result=await sb.functions.invoke('whatsapp-otp-start',{body:{phone:phone}});
    if(result.error||result.data?.error){showError(errorText(result.data?.error||result.error));button.disabled=false;button.textContent=tr('Send WhatsApp code','إرسال رمز واتساب');return}
    pendingPhone=phone;phoneScreen('code');startCooldown();
  }
  async function verifyCode(event){
    event.preventDefault();var button=document.getElementById('phoneVerifySubmit'),code=document.getElementById('otpCode').value.replace(/\D/g,'');
    button.disabled=true;button.textContent=tr('Verifying…','جارٍ التحقق…');
    var result=await sb.functions.invoke('whatsapp-otp-check',{body:{phone:pendingPhone,code:code}});
    if(result.error||result.data?.error){showError(errorText(result.data?.error||result.error));button.disabled=false;button.textContent=tr('Verify & continue','تحقق وتابع');return}
    pendingPhone='';await loadLiveData();render();toast(tr('WhatsApp number verified.','تم توثيق رقم واتساب.'));
  }
  function startCooldown(){clearInterval(cooldownTimer);var remaining=30;cooldownTimer=setInterval(function(){remaining--;if(remaining<=0)clearInterval(cooldownTimer)},1000)}

  var previousLoad=loadLiveData;
  loadLiveData=async function(){
    await previousLoad();if(!sb||!authUser)return;
    var result=await sb.rpc('identity_verification_status');
    if(!result.error&&result.data)state.identityVerification=result.data;
    else if(result.error?.code!=='42883')console.error('Identity verification status could not load',result.error);
  };
  var previousRender=render;
  render=function(){
    if(authUser&&state.identityVerification?.verification_required&&!state.identityVerification?.phone_verified){phoneScreen(pendingPhone?'code':'phone');return}
    previousRender();
  };
})();
