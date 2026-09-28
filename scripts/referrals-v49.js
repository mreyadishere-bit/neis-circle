/* NEIS Circle v49 — lightweight WhatsApp referrals without paid APIs. */
(function(){
  'use strict';

  const STORAGE_KEY='neis-referral-code-v1';
  const CODE_RE=/^nc-[a-z0-9]{10}$/;
  let claimBusy=false;

  const tr=(en,arText)=>state.lang==='ar'?arText:en;

  function cleanCode(value){
    const code=String(value||'').trim().toLowerCase();
    return CODE_RE.test(code)?code:'';
  }

  function captureReferralFromUrl(){
    try{
      const url=new URL(location.href);
      const incoming=url.searchParams.get('ref');
      if(incoming){
        const code=cleanCode(incoming);
        if(code)localStorage.setItem(STORAGE_KEY,code);
        url.searchParams.delete('ref');
        const next=url.pathname+(url.search?url.search:'')+(url.hash||'');
        history.replaceState(history.state,'',next);
      }
    }catch(_){/* keep navigation untouched */}
  }

  function storedReferral(){
    return cleanCode(localStorage.getItem(STORAGE_KEY));
  }

  function clearStoredReferral(){
    localStorage.removeItem(STORAGE_KEY);
  }

  async function maybeClaimReferral(){
    const code=storedReferral();
    if(!code||claimBusy||!sb||!authUser||state.onboardingComplete!==true)return;
    claimBusy=true;
    try{
      const result=await sb.rpc('claim_referral',{referral_code_input:code});
      if(result.error)return;
      const status=String(result.data?.status||'');
      if(['claimed','invalid','ineligible','already_referred','self_referral'].includes(status)){
        clearStoredReferral();
      }
    }finally{
      claimBusy=false;
    }
  }

  function inviteLink(code){
    const url=new URL(location.origin+location.pathname);
    url.searchParams.set('ref',code);
    return url.toString();
  }

  function whatsappMessage(link){
    if(state.lang==='ar'){
      return [
        'مرحبًا! أعتقد أن NEIS Circle قد يعجبك 👋',
        '',
        'هو مجتمع لطلاب مدارس النيل المصرية نقدر من خلاله:',
        '• نشارك المقالات والأفكار',
        '• نكتشف الفرص والمنح',
        '• نشارك مصادر المذاكرة',
        '• نتواصل مع طلاب آخرين',
        '',
        'انضم من خلال رابط الدعوة الخاص بي:',
        link
      ].join('\n');
    }
    return [
      'Hey! I thought you might like NEIS Circle 👋',
      '',
      'It’s a student community for NEIS students where we can:',
      '• share articles and ideas',
      '• discover opportunities and scholarships',
      '• share study resources',
      '• connect with other students',
      '',
      'Join through my invite link:',
      link
    ].join('\n');
  }

  async function copyText(value){
    try{
      if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(value);
      }else{
        const area=document.createElement('textarea');
        area.value=value;
        area.setAttribute('readonly','');
        area.style.position='fixed';
        area.style.opacity='0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      toast(tr('Invite link copied.','تم نسخ رابط الدعوة.'));
    }catch(_){
      window.prompt(tr('Copy your invite link','انسخ رابط الدعوة الخاص بك'),value);
    }
  }

  async function openReferralInvite(){
    if(!sb||!authUser)return;
    const result=await sb.rpc('referral_summary');
    if(result.error||!result.data?.referral_code){
      toast(tr('Could not load your invite link. Please try again.','تعذر تحميل رابط الدعوة. حاول مرة أخرى.'));
      return;
    }

    const code=String(result.data.referral_code);
    const count=Number(result.data.successful_invites||0);
    const link=inviteLink(code);
    const wa='https://wa.me/?text='+encodeURIComponent(whatsappMessage(link));

    openModal(`
      <div class="modal-head referral-head">
        <div>
          <h2>${tr('Invite a student','دعوة طالب')}</h2>
          <p>${tr('Invite your classmates to NEIS Circle and help grow the student community.','ادعُ زملاءك إلى NEIS Circle وساعد في تنمية مجتمع الطلاب.')}</p>
        </div>
        <button class="close" data-close>×</button>
      </div>
      <section class="referral-panel">
        <div class="referral-stat">
          <span>${tr('Successful invites','الدعوات الناجحة')}</span>
          <b>${count}</b>
        </div>
        <label class="field referral-link-field">
          ${tr('Your invite link','رابط الدعوة الخاص بك')}
          <input id="referralInviteLink" dir="ltr" readonly value="${esc(link)}">
        </label>
        <div class="referral-actions">
          <a class="primary referral-whatsapp" href="${esc(wa)}" target="_blank" rel="noopener noreferrer">
            <span aria-hidden="true">↗</span>
            ${tr('Invite via WhatsApp','دعوة عبر واتساب')}
          </a>
          <button type="button" class="secondary" data-copy-referral>
            ${tr('Copy link','نسخ الرابط')}
          </button>
        </div>
        <p class="referral-note">${tr('WhatsApp opens with a ready message. You choose the person and press Send yourself.','سيفتح واتساب برسالة جاهزة، وأنت تختار الشخص وتضغط إرسال بنفسك.')}</p>
      </section>
    `);

    const copy=document.querySelector('[data-copy-referral]');
    if(copy)copy.onclick=()=>copyText(link);
    if(typeof translateTree==='function')translateTree(document.getElementById('modalRoot'));
  }

  function addInviteToSettings(){
    const menu=document.querySelector('#modalRoot .account-menu');
    if(!menu||menu.querySelector('[data-referral-invite]'))return;
    const button=document.createElement('button');
    button.type='button';
    button.className='account-row';
    button.dataset.referralInvite='';
    button.innerHTML=`<span>${tr('Invite a student','دعوة طالب')}</span><b>${tr('WhatsApp invite →','دعوة واتساب ←')}</b>`;
    const adminRow=menu.querySelector('[data-nav="admin"]');
    if(adminRow)menu.insertBefore(button,adminRow);else menu.appendChild(button);
    button.onclick=openReferralInvite;
  }

  captureReferralFromUrl();

  const previousLoad=loadLiveData;
  loadLiveData=async function(){
    await previousLoad();
    await maybeClaimReferral();
  };

  const previousSettings=settings;
  settings=function(){
    const result=previousSettings();
    addInviteToSettings();
    return result;
  };

  window.openReferralInvite=openReferralInvite;

  if(authUser&&state.onboardingComplete===true)setTimeout(maybeClaimReferral,0);
})();