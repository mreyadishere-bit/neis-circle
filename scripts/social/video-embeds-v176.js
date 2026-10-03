/* NEIS Circle video embed parser — YouTube + Google Drive without changing post storage schema. */
(function(){
  function clean(value){return String(value||'').trim()}

  function youtubeVideoId(value){
    try{
      const url=new URL(clean(value));
      if(url.protocol!=='https:')return '';
      const host=url.hostname.toLowerCase().replace(/^www\./,'');
      let id='';
      if(host==='youtu.be')id=url.pathname.split('/').filter(Boolean)[0]||'';
      else if(host==='youtube.com'||host==='m.youtube.com'||host==='music.youtube.com'||host==='youtube-nocookie.com'){
        if(url.pathname==='/watch')id=url.searchParams.get('v')||'';
        else{
          const parts=url.pathname.split('/').filter(Boolean);
          if(['shorts','embed','live'].includes(parts[0]))id=parts[1]||'';
        }
      }
      return /^[A-Za-z0-9_-]{11}$/.test(id)?id:'';
    }catch{return ''}
  }

  function googleDriveFileId(value){
    try{
      const url=new URL(clean(value));
      if(url.protocol!=='https:')return '';
      const host=url.hostname.toLowerCase().replace(/^www\./,'');
      if(host!=='drive.google.com')return '';
      const parts=url.pathname.split('/').filter(Boolean);
      let id='';
      const fileIndex=parts.indexOf('file');
      if(fileIndex>=0&&parts[fileIndex+1]==='d')id=parts[fileIndex+2]||'';
      if(!id&&parts[0]==='open')id=url.searchParams.get('id')||'';
      if(!id&&parts[0]==='uc')id=url.searchParams.get('id')||'';
      return /^[A-Za-z0-9_-]{10,}$/.test(id)?id:'';
    }catch{return ''}
  }

  function parse(value){
    const original=clean(value);
    const youtubeId=youtubeVideoId(original);
    if(youtubeId){
      return {
        provider:'youtube',
        id:youtubeId,
        original,
        embedUrl:`https://www.youtube-nocookie.com/embed/${youtubeId}`
      };
    }
    const driveId=googleDriveFileId(original);
    if(driveId){
      return {
        provider:'google-drive',
        id:driveId,
        original,
        embedUrl:`https://drive.google.com/file/d/${driveId}/preview`
      };
    }
    return null;
  }

  window.NEISVideoEmbeds={
    version:'176.0',
    parse,
    isValid:value=>!!parse(value),
    youtubeVideoId,
    googleDriveFileId
  };
})();
