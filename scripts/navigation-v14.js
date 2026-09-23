(function(){
  'use strict';
  var root=document.getElementById('mobileNavRoot');
  if(!root)return;
  var destinations=[
    ['connections','users','Connections','العلاقات'],
    ['library','library','Saved','المحفوظات'],
    ['opportunities','calendar','Opportunities','الفرص'],
    ['gallery','image','Gallery','المعرض'],
    ['articles','article','Articles','المقالات'],
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
      '<button type="button" class="mobile-nav-item" data-action="settings">'+svg('settings')+'<span>'+label('Settings','الإعدادات')+'</span></button>'+
      '</nav></section></div>';
    document.body.classList.add('mobile-nav-open');
    var trigger=document.querySelector('[data-mobile-more]');
    if(trigger)trigger.setAttribute('aria-expanded','true');
    root.querySelector('.mobile-nav-close').focus();
  }
  document.addEventListener('click',function(event){
    if(event.target.closest('[data-mobile-more]')){event.preventDefault();open();return}
    if(event.target.closest('[data-mobile-close]')){event.preventDefault();close();return}
    if(root.contains(event.target)&&(event.target.closest('[data-nav]')||event.target.closest('[data-action="settings"]')))setTimeout(close,0);
  });
  document.addEventListener('keydown',function(event){if(event.key==='Escape'&&root.firstChild)close()});
  window.addEventListener('resize',function(){if(innerWidth>760&&root.firstChild)close()},{passive:true});
})();
