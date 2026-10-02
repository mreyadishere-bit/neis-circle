/* v162 — hard fix for main-feed Poll selector.
   Delegated listener is intentionally independent of composer wrappers so Poll always opens its full composer. */
(function(){
  'use strict';
  document.addEventListener('change',function(event){
    var select=event.target;
    if(!select||select.id!=='postKind'||select.value!=='Poll')return;
    if(window.NEISPublicPolls&&typeof window.NEISPublicPolls.openComposer==='function'){
      event.stopImmediatePropagation();
      window.NEISPublicPolls.openComposer();
    }
  },true);
})();