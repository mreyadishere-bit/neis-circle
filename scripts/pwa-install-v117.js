(()=>{
  const isNative=()=>document.documentElement.classList.contains('neis-native-app')||
    /NEISCircleAndroid/i.test(navigator.userAgent||'');
  const isStandalone=()=>window.matchMedia?.('(display-mode: standalone)').matches||
    window.navigator.standalone===true;
  const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent||'');
  let installPrompt=null;

  const txt=(en,ar)=>{
    const lang=(document.documentElement.lang||'en').toLowerCase();
    return lang.startsWith('ar')?ar:en;
  };

  function cardMarkup(){
    return `<section class="pwa-install-card" data-pwa-install-card>
      <div>
        <p class="kicker"><i></i>${txt('Recommended mobile app','التطبيق المقترح للموبايل')}</p>
        <h2>${txt('Install NEIS Circle — no APK required','ثبّت NEIS Circle بدون APK')}</h2>
        <p>${txt(
          'Install the secure web app directly from your browser. It works on Android and iPhone, opens like a standalone app, and receives website updates automatically.',
          'ثبّت تطبيق الويب الآمن مباشرة من المتصفح. يعمل على أندرويد وآيفون، ويفتح كتطبيق مستقل، وتصلك تحديثات الموقع تلقائيًا.'
        )}</p>
        <div class="pwa-install-actions">
          <button type="button" class="primary" data-pwa-install>${txt('Install NEIS Circle','تثبيت NEIS Circle')}</button>
        </div>
      </div>
      <div class="pwa-install-meta">
        <div><b>✓</b><span>${txt('No APK or unknown-app installation permission.','بدون APK أو صلاحية تثبيت تطبيقات من مصادر خارجية.')}</span></div>
        <div><b>✓</b><span>${txt('Automatic website updates without reinstalling.','تحديثات الموقع تصل تلقائيًا بدون إعادة تثبيت.')}</span></div>
        <div><b>✓</b><span>${txt('Android + iPhone/iPad support.','يدعم أندرويد وآيفون وآيباد.')}</span></div>
      </div>
    </section>`;
  }

  function ensureCard(){
    if(isNative()||isStandalone()){
      document.querySelector('[data-pwa-install-card]')?.remove();
      return;
    }
    const view=document.querySelector('#view');
    if(!view||view.querySelector('[data-pwa-install-card]'))return;
    const hero=view.querySelector('.hero');
    if(!hero)return;
    hero.insertAdjacentHTML('afterend',cardMarkup());
  }

  function showIOSHelp(){
    document.querySelector('.pwa-ios-help')?.remove();
    const wrap=document.createElement('div');
    wrap.className='pwa-ios-help';
    wrap.innerHTML=`<div class="pwa-ios-sheet" role="dialog" aria-modal="true">
      <h3>${txt('Install NEIS Circle on iPhone','تثبيت NEIS Circle على iPhone')}</h3>
      <p>${txt('Safari installs web apps through Add to Home Screen.','يتم تثبيت تطبيقات الويب من Safari عن طريق Add to Home Screen.')}</p>
      <div class="pwa-ios-steps">
        <div class="pwa-ios-step">1. ${txt('Tap the Share button in Safari.','اضغط زر المشاركة Share في Safari.')}</div>
        <div class="pwa-ios-step">2. ${txt('Choose “Add to Home Screen”.','اختر “Add to Home Screen”.')}</div>
        <div class="pwa-ios-step">3. ${txt('Tap Add, then open NEIS Circle from your Home Screen.','اضغط Add ثم افتح NEIS Circle من الشاشة الرئيسية.')}</div>
      </div>
      <button type="button" class="primary" data-pwa-ios-close>${txt('Got it','حسنًا')}</button>
    </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click',e=>{
      if(e.target===wrap||e.target.closest('[data-pwa-ios-close]'))wrap.remove();
    });
  }

  async function install(){
    if(isStandalone())return;
    if(installPrompt){
      installPrompt.prompt();
      try{await installPrompt.userChoice}catch(_){}
      installPrompt=null;
      ensureCard();
      return;
    }
    if(isIOS()){
      showIOSHelp();
      return;
    }
    // Some Android browsers do not expose beforeinstallprompt immediately.
    // Give a browser-native fallback instead of sending users to an APK.
    alert(txt(
      'Open your browser menu and choose “Install app” or “Add to Home screen”.',
      'افتح قائمة المتصفح واختر “Install app” أو “Add to Home screen”.'
    ));
  }

  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault();
    installPrompt=e;
    ensureCard();
  });
  window.addEventListener('appinstalled',()=>{
    installPrompt=null;
    document.querySelector('[data-pwa-install-card]')?.remove();
  });

  document.addEventListener('click',e=>{
    const btn=e.target.closest?.('[data-pwa-install]');
    if(btn){e.preventDefault();install();}
  });

  if('serviceWorker' in navigator && !isNative()){
    window.addEventListener('load',()=>{
      navigator.serviceWorker.register('/pwa-sw.js',{scope:'/'}).catch(err=>console.warn('[NEIS PWA]',err));
    },{once:true});
  }

  const observer=new MutationObserver(()=>ensureCard());
  const start=()=>{
    ensureCard();
    const view=document.querySelector('#view');
    if(view)observer.observe(view,{childList:true,subtree:false});
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
