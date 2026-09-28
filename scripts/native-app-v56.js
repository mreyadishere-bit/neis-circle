/* NEIS Circle v56 — native-only UI adapter.
   IMPORTANT: this file must never change the normal web experience. */
(function(){
  'use strict';
  if(!document.documentElement.classList.contains('neis-native-app'))return;

  const lang=(en,ar)=>typeof state!=='undefined'&&state.lang==='ar'?ar:en;

  function useLatestAsNativeDefault(){
    try{
      if(typeof state==='undefined')return;
      if(!sessionStorage.getItem('neis-native-latest-defaulted')){
        sessionStorage.setItem('neis-native-latest-defaulted','1');
        if(state.filter==='For you')state.filter='Latest';
      }
      const tabs=document.querySelector('.tabs');
      const latest=tabs?.querySelector('[data-filter="Latest"]');
      if(latest&&tabs.firstElementChild!==latest)tabs.prepend(latest);
    }catch(_){}
  }

  function adaptSettings(){
    document.querySelectorAll('.modal .account-menu>.account-row').forEach(row=>{
      if(row.dataset.nativeSettingsReady==='1')return;
      const children=[...row.children];
      if(children.length<2)return;
      if(row.querySelector(':scope > .settings-row-end')){row.dataset.nativeSettingsReady='1';return}
      row.dataset.nativeSettingsReady='1';
      row.classList.add('settings-row');
      const first=children[0],last=children[children.length-1];
      if(first)first.classList.add('settings-row-label');
      if(last&&last!==first){
        const end=document.createElement('span');
        end.className='settings-row-end';
        last.classList.add('settings-row-value');
        last.replaceWith(end);
        end.append(last);
        if(row.tagName==='BUTTON'&&!row.matches('[data-action="admin-connection"]')){
          const chevron=document.createElement('i');
          chevron.className='settings-chevron';
          chevron.setAttribute('aria-hidden','true');
          end.append(chevron);
        }
      }
    });
  }

  function flattenReplyTree(){
    const tree=document.querySelector('#replyContent .reply-tree');
    if(!tree||tree.dataset.nativeFlat==='1')return;
    tree.dataset.nativeFlat='1';
    const roots=[...tree.children].filter(el=>el.classList?.contains('reply-card'));
    roots.forEach(root=>{
      const descendants=[...root.querySelectorAll('.reply-card')];
      if(!descendants.length)return;
      const wrap=document.createElement('div');
      wrap.className='reply-children hidden';
      descendants.forEach(reply=>{reply.classList.add('nested');wrap.append(reply)});
      const toggle=document.createElement('button');
      toggle.type='button';
      toggle.className='reply-thread-toggle';
      toggle.setAttribute('aria-expanded','false');
      toggle.innerHTML='<span aria-hidden="true"></span>'+lang('View replies','عرض الردود')+' ('+descendants.length+')';
      toggle.onclick=()=>{
        const opening=wrap.classList.contains('hidden');
        wrap.classList.toggle('hidden',!opening);
        toggle.setAttribute('aria-expanded',opening?'true':'false');
        toggle.innerHTML='<span aria-hidden="true"></span>'+(opening?lang('Hide replies','إخفاء الردود'):lang('View replies','عرض الردود'))+' ('+descendants.length+')';
      };
      root.after(toggle,wrap);
    });
  }

  function flattenArticleComments(){
    document.querySelectorAll('.article-comment-list').forEach(list=>{
      if(list.dataset.nativeFlat==='1')return;
      list.dataset.nativeFlat='1';
      const roots=[...list.children].filter(el=>el.classList?.contains('article-comment'));
      roots.forEach(root=>{
        const descendants=[...root.querySelectorAll('.article-comment')];
        if(!descendants.length)return;
        const wrap=document.createElement('div');
        wrap.className='article-comment-replies hidden';
        descendants.forEach(reply=>{reply.classList.add('is-reply');wrap.append(reply)});
        const toggle=document.createElement('button');
        toggle.type='button';
        toggle.className='article-replies-toggle';
        toggle.setAttribute('aria-expanded','false');
        toggle.innerHTML='<span aria-hidden="true"></span>'+lang('View replies','عرض الردود')+' ('+descendants.length+')';
        toggle.onclick=()=>{
          const opening=wrap.classList.contains('hidden');
          wrap.classList.toggle('hidden',!opening);
          toggle.setAttribute('aria-expanded',opening?'true':'false');
          toggle.innerHTML='<span aria-hidden="true"></span>'+(opening?lang('Hide replies','إخفاء الردود'):lang('View replies','عرض الردود'))+' ('+descendants.length+')';
        };
        root.after(toggle,wrap);
      });
    });
  }

  function collapseModeration(){
    document.querySelectorAll('.module-card').forEach(card=>{
      if(card.dataset.nativeModerationReady==='1')return;
      const heading=card.querySelector('h2');
      const title=(heading?.textContent||'').trim().toLowerCase();
      if(!title.includes('content moderation')&&!title.includes('إدارة المحتوى'))return;
      card.dataset.nativeModerationReady='1';
      card.classList.add('native-moderation-collapsed');
      const titleBlock=card.querySelector('.page-title');
      const list=card.querySelector('.admin-content-list');
      if(!list)return;
      list.hidden=true;
      const toggle=document.createElement('button');
      toggle.type='button';
      toggle.className='secondary native-moderation-toggle';
      toggle.textContent=lang('Open moderation','فتح الإشراف');
      toggle.onclick=()=>{
        const opening=list.hidden;
        list.hidden=!opening;
        card.classList.toggle('open',opening);
        toggle.textContent=opening?lang('Hide moderation','إخفاء الإشراف'):lang('Open moderation','فتح الإشراف');
      };
      titleBlock?.append(toggle);
    });
  }

  function syncNativeTheme(){
    try{
      const theme=document.documentElement.dataset.theme||localStorage.getItem('neis-theme')||'light';
      window.NeisAndroid?.setSystemTheme?.(theme);
    }catch(_){}
  }

  function apply(){
    syncNativeTheme();
    useLatestAsNativeDefault();
    adaptSettings();
    flattenReplyTree();
    flattenArticleComments();
    collapseModeration();
  }

  let queued=false;
  const queue=()=>{
    if(queued)return;
    queued=true;
    requestAnimationFrame(()=>{queued=false;apply()});
  };
  new MutationObserver(queue).observe(document.body,{childList:true,subtree:true});
  new MutationObserver(syncNativeTheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  document.addEventListener('click',()=>setTimeout(queue,0),true);
  apply();
})();