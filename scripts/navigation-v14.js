(function(){
  'use strict';
  var root=document.getElementById('mobileNavRoot');
  if(!root)return;
  var destinations=[
    ['connections','users','Connections','العلاقات'],
    ['library','library','Saved','المحفوظات'],
    ['opportunities','graduation','Opportunities','الفرص'],
    ['gallery','image','Gallery','المعرض'],
    ['articles','article','Articles','المقالات'],
    ['study','book','Study','الدراسة'],
    ['timetable','calendar','Timetable','الجدول'],
    ['admin','shield','Admin','الإدارة','admin']
  ];
  function isArabic(){return document.documentElement.lang==='ar'||document.documentElement.dir==='rtl'}
  function label(en,ar){return isArabic()?ar:en}
  function svg(name){return '<svg aria-hidden="true"><use href="#i-'+name+'"/></svg>'}
  function close(){
    root.innerHTML='';
    document.body.classList.remove('mobile-nav-open');
    var trigger=document.querySelector('[data-mobile-more]');
    if(trigger)trigger.setAttribute('aria-expanded','false');
  }
  function open(){
    var appState=typeof state!=='undefined'?state:null;
    var admin=!!(appState&&appState.isAdmin);
    root.innerHTML='<div class="mobile-nav-layer" role="dialog" aria-modal="true" aria-labelledby="mobileNavTitle">'+
      '<button class="mobile-nav-backdrop" type="button" data-mobile-close aria-label="'+label('Close navigation','إغلاق التنقل')+'"></button>'+
      '<section class="mobile-nav-sheet"><div class="mobile-nav-head"><h2 id="mobileNavTitle">'+label('All tools','كل الأدوات')+'</h2><button class="mobile-nav-close" type="button" data-mobile-close aria-label="'+label('Close','إغلاق')+'">×</button></div>'+
      '<nav class="mobile-nav-list" aria-label="'+label('All navigation destinations','كل وجهات التنقل')+'">'+
      destinations.map(function(item){var cls='mobile-nav-item'+(item[4]==='admin'?' admin-mobile'+(admin?' visible':''):'')+((appState&&appState.view===item[0])?' active':'');return '<button type="button" class="'+cls+'" data-nav="'+item[0]+'">'+svg(item[1])+'<span>'+label(item[2],item[3])+'</span></button>'}).join('')+
      '<button type="button" class="mobile-nav-item neis-mobile-game-entry" data-neis-connect-open><span class="neis-mobile-game-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7.5 8.5h9a4.5 4.5 0 0 1 4.4 3.5l1.1 5.1a2.3 2.3 0 0 1-3.8 2.2l-2.8-2.6h-6.8l-2.8 2.6A2.3 2.3 0 0 1 2 17.1l1.1-5.1a4.5 4.5 0 0 1 4.4-3.5Z"/><path d="M8.4 11v4.7M6.1 13.4h4.6"/><circle cx="15.8" cy="12.1" r=".7"/><circle cx="18" cy="14.1" r=".7"/></svg></span><span>'+label('Games','الألعاب')+'</span></button>'+
      '<button type="button" class="mobile-nav-item" data-action="settings">'+svg('settings')+'<span>'+label('Settings','الإعدادات')+'</span></button>'+
      '</nav></section></div>';
    document.body.classList.add('mobile-nav-open');
    var trigger=document.querySelector('[data-mobile-more]');
    if(trigger)trigger.setAttribute('aria-expanded','true');
    // Start at the first navigation item on every opening, even after a previous scroll.
    // Prevent focus restoration/visualViewport adjustments from scrolling the list.
    var list=root.querySelector('.mobile-nav-list');
    // Android PWA may restore the list's previous scroll offset after focus,
    // viewport resizing, or its bottom-sheet layout settles. Reset until
    // first user interaction, never while the user is actually scrolling.
    if(list){
      var interacted=false;
      ['touchstart','pointerdown','wheel','keydown'].forEach(function(type){
        list.addEventListener(type,function(){interacted=true},{once:true,passive:type!=='keydown'});
      });
      var reset=function(){
        if(!interacted&&list.isConnected&&root.contains(list)){
          list.scrollTop=0;
          list.scrollTo?.({top:0,behavior:'instant'});
        }
      };
      reset();
      root.querySelector('.mobile-nav-close')?.focus({preventScroll:true});
      requestAnimationFrame(function(){reset();requestAnimationFrame(reset)});
      setTimeout(reset,90);
      setTimeout(reset,280);
      // Some native WebViews do one more visualViewport adjustment.
      setTimeout(reset,500);
    }
  }
  document.addEventListener('click',function(event){
    if(event.target.closest('[data-mobile-more]')){event.preventDefault();open();return}
    if(event.target.closest('[data-mobile-close]')){event.preventDefault();close();return}
    if(root.contains(event.target)&&(event.target.closest('[data-nav]')||event.target.closest('[data-action="settings"]')))setTimeout(close,0);
  });
  document.addEventListener('keydown',function(event){if(event.key==='Escape'&&root.firstChild)close()});
  window.addEventListener('resize',function(){if(innerWidth>760&&root.firstChild)close()},{passive:true});
})();
