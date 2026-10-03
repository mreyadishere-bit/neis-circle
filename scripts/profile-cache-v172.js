/* NEIS Circle Profile Cache v172
   Short-lived session cache for the public member directory.
   Never use cached rows as an authorization source. */
(function(){
  'use strict';
  if(window.__neisProfileCacheV172)return;
  window.__neisProfileCacheV172=true;

  const PREFIX='neis-profile-directory-v172:';
  const TTL_MS=5*60*1000;

  function key(userId){return PREFIX+String(userId||'guest')}

  function read(userId){
    if(!userId)return null;
    try{
      const raw=sessionStorage.getItem(key(userId));
      if(!raw)return null;
      const parsed=JSON.parse(raw);
      const rows=Array.isArray(parsed?.rows)?parsed.rows:null;
      const savedAt=Number(parsed?.savedAt||0);
      if(!rows||!savedAt)return null;
      const ageMs=Math.max(0,Date.now()-savedAt);
      return {rows,savedAt,ageMs,fresh:ageMs<TTL_MS};
    }catch(error){
      console.warn('[NEIS Profile Cache] read failed',error);
      return null;
    }
  }

  function write(userId,rows){
    if(!userId||!Array.isArray(rows))return false;
    try{
      sessionStorage.setItem(key(userId),JSON.stringify({
        savedAt:Date.now(),
        rows
      }));
      return true;
    }catch(error){
      console.warn('[NEIS Profile Cache] write failed',error);
      return false;
    }
  }

  function clear(userId){
    try{
      if(userId)sessionStorage.removeItem(key(userId));
      else{
        for(let i=sessionStorage.length-1;i>=0;i--){
          const itemKey=sessionStorage.key(i);
          if(itemKey?.startsWith(PREFIX))sessionStorage.removeItem(itemKey);
        }
      }
    }catch(error){
      console.warn('[NEIS Profile Cache] clear failed',error);
    }
  }

  window.NEISProfileCache={
    version:'172.0',
    ttlMs:TTL_MS,
    read,
    write,
    clear
  };
})();