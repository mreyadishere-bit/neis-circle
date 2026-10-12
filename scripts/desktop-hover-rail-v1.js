/* NEIS Circle: light/dark-aware, RTL-safe desktop hover sidebar.
   Only enhances existing navigation buttons; it never intercepts routes/auth. */
(()=>{
'use strict';
const KEY='neis-desktop-sidebar-pinned-v1';
const screen=window.matchMedia('(min-width: 1024px)');
const hoverCapable=window.matchMedia('(hover: hover) and (pointer: fine)');
const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
let initialized=false;

function init(){
  if(initialized)return;
  const rail=document.querySelector('.rail');
  if(!rail)return false;
  const nav=rail.querySelector('.rail-nav');
  const logo=rail.querySelector('button.logo[data-nav="home"]');
  if(!nav||!logo||nav.querySelectorAll('.nav-btn').length<5)return false;
  initialized=true;
  let pinned=false;
  try{pinned=localStorage.getItem(KEY)==='true'}catch(_){}
  let over=false,focusByKeyboard=false,lastKeyboard=false;
  let enterTimer=null,exitTimer=null;

  const brand=document.createElement('div');
  brand.className='neis-rail-brand';
  logo.parentNode.insertBefore(brand,logo);
  brand.append(logo);
  const brandName=document.createElement('span');
  brandName.className='neis-rail-brand-name';
  brandName.setAttribute('aria-hidden','true');
  const brandTitle=document.createElement('strong');
  brandTitle.textContent='NEIS Circle';
  const brandSub=document.createElement('small');
  brandSub.textContent='student network';
  brandName.append(brandTitle,brandSub);
  brand.append(brandName);

  const buttons=[...nav.querySelectorAll('button.nav-btn')];
  const titles={
    home:['Home','الرئيسية'],
    discover:['Discover','اكتشف'],
    circles:['Circles','المجتمعات'],
    messages:['Messages','الرسائل'],
    connections:['Connections','العلاقات'],
    library:['Saved','المحفوظات'],
    opportunities:['Opportunities','الفرص'],
    gallery:['Gallery','المعرض'],
    articles:['Articles','المقالات'],
    study:['Study','الدراسة'],
    timetable:['Timetable','الجدول'],
    admin:['Admin','الإدارة'],
    settings:['Settings','الإعدادات']
  };
  for(const b of buttons){
    const label=document.createElement('span');
    label.className='neis-rail-label';
    label.setAttribute('aria-hidden','true');
    b.append(label);
  }
  nav.id=nav.id||'neis-desktop-rail-navigation';
  const footer=document.createElement('div');
  footer.className='neis-rail-footer';
  const pin=document.createElement('button');
  pin.type='button';
  pin.className='neis-rail-pin';
  pin.setAttribute('aria-controls',nav.id);
  pin.setAttribute('aria-pressed','false');
  pin.setAttribute('aria-expanded','false');
  // Icon is decorative and uses the same vector stroke style as the site.
  pin.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M16 3l5 5-3.1 1.1-.9 4-2.4 2.4-3.2-3.2-5.2 5.2-1.6-1.6 5.2-5.2-3.2-3.2L9 5.1l4-.9L16 3Z"/><path d="m8 16-5 5"/></svg>';
  const pinLabel=document.createElement('span');
  pinLabel.className='neis-rail-pin-label';
  pin.append(pinLabel);
  footer.append(pin);
  rail.append(footer);

  function rtl(){return document.body.classList.contains('rtl') ||
    document.documentElement.getAttribute('dir')==='rtl'}
  function refreshLabels(){
    const arabic=rtl();
    brandSub.textContent=arabic?'شبكة الطلاب':'student network';
    pinLabel.textContent=pinned?(arabic?'إلغاء التثبيت':'Unpin sidebar'):(arabic?'تثبيت القائمة':'Pin sidebar');
    pin.setAttribute('aria-label',pinLabel.textContent);
    for(const b of buttons){
      const key=b.dataset.nav||b.dataset.action;
      const text=b.getAttribute('title')||b.getAttribute('aria-label')||
        titles[key]?.[arabic?1:0]||key||'';
      const label=b.querySelector('.neis-rail-label');
      if(label && label.textContent!==text)label.textContent=text;
    }
  }
  function clearTimers(){
    if(enterTimer!==null){clearTimeout(enterTimer);enterTimer=null}
    if(exitTimer!==null){clearTimeout(exitTimer);exitTimer=null}
  }
  function expand(){
    const show=screen.matches&&(pinned||over||focusByKeyboard);
    rail.classList.toggle('is-expanded',show);
    rail.classList.toggle('is-pinned',pinned);
    rail.setAttribute('data-expanded',String(show));
    pin.setAttribute('aria-expanded',String(show));
    pin.setAttribute('aria-pressed',String(pinned));
    pin.tabIndex=show?0:-1;
  }
  function onEnter(ev){
    if(!screen.matches||!hoverCapable.matches||ev.pointerType==='touch')return;
    over=true;
    if(exitTimer!==null){clearTimeout(exitTimer);exitTimer=null}
    if(pinned){expand();return}
    if(enterTimer!==null)clearTimeout(enterTimer);
    enterTimer=setTimeout(()=>{enterTimer=null;expand()},reduceMotion.matches?0:75);
  }
  function onLeave(){
    over=false;
    if(enterTimer!==null){clearTimeout(enterTimer);enterTimer=null}
    if(pinned||focusByKeyboard){expand();return}
    if(exitTimer!==null)clearTimeout(exitTimer);
    exitTimer=setTimeout(()=>{exitTimer=null;expand()},reduceMotion.matches?0:140);
  }
  rail.addEventListener('pointerenter',onEnter);
  rail.addEventListener('pointerleave',onLeave);
  rail.addEventListener('pointerdown',()=>{
    lastKeyboard=false;
    focusByKeyboard=false;
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Tab'||event.key.startsWith('Arrow'))lastKeyboard=true;
  },true);
  rail.addEventListener('focusin',()=>{
    if(!screen.matches||!lastKeyboard)return;
    focusByKeyboard=true;
    clearTimers();
    expand();
  });
  rail.addEventListener('focusout',()=>{
    requestAnimationFrame(()=>{
      if(!rail.contains(document.activeElement)){
        focusByKeyboard=false;
        expand();
      }
    });
  });
  rail.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!pinned){
      focusByKeyboard=false;
      over=false;
      clearTimers();
      expand();
      const focused=rail.querySelector(':focus');
      focused?.blur();
    }
  });
  pin.addEventListener('click',event=>{
    event.preventDefault();
    event.stopPropagation();
    if(!screen.matches)return;
    pinned=!pinned;
    try{localStorage.setItem(KEY,String(pinned))}catch(_){}
    refreshLabels();
    expand();
  });

  function viewportChanged(){
    clearTimers();
    if(!screen.matches){
      over=false;focusByKeyboard=false;
    }
    expand();
  }
  screen.addEventListener?.('change',viewportChanged);
  hoverCapable.addEventListener?.('change',viewportChanged);

  const changes=new MutationObserver(records=>{
    if(records.some(r=>r.attributeName==='title'))refreshLabels();
  });
  for(const b of buttons)changes.observe(b,{attributes:true,attributeFilter:['title']});
  const directionChange=new MutationObserver(()=>refreshLabels());
  directionChange.observe(document.body,{attributes:true,attributeFilter:['class','dir']});
  directionChange.observe(document.documentElement,{attributes:true,attributeFilter:['dir','lang']});
  rail.classList.add('neis-hover-rail');
  refreshLabels();
  expand();
  return true;
}
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',init,{once:true});
}else init();
})();