/* NEIS Circle v161 — public feed polls + unified post type choices.
   Reuses the existing Circle poll database model without changing Circle behavior. */
(function(){
  'use strict';

  var store={polls:[],options:[],results:[],loaded:false,loading:false,signature:''};
  var realtime=null,realtimeRefreshTimer=null;
  var closeTimers=new Map();
  var MAIN_ADMIN_ID_FALLBACK='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd';
  function isMainAdminUser(){
    var id=(typeof NEIS_ADMIN_ID!=='undefined'&&NEIS_ADMIN_ID)?NEIS_ADMIN_ID:MAIN_ADMIN_ID_FALLBACK;
    return !!authUser&&String(authUser.id)===String(id);
  }

  function isPublicPollPost(post){
    return !!post && !post.circle_id && (post.kind==='Poll'||post.post_type==='poll');
  }
  function currentPublicPollIds(){
    return (Array.isArray(state.posts)?state.posts:[]).filter(isPublicPollPost).map(function(p){return String(p.id)}).sort();
  }
  function currentSignature(){return currentPublicPollIds().join('|')}
  function scheduleRealtimeRefresh(){
    clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer=setTimeout(async function(){
      realtimeRefreshTimer=null;
      await loadPublicPolls(true,false);
      if(state.view==='home')render();
    },90);
  }
  function pollForPost(postId){
    return store.polls.find(function(p){return same(p.post_id,postId)});
  }
  function pollOptions(pollId){
    return store.options.filter(function(o){return same(o.poll_id,pollId)}).sort(function(a,b){return (a.sort_order||0)-(b.sort_order||0)});
  }
  function pollResults(pollId){
    return store.results.filter(function(r){return same(r.poll_id,pollId)});
  }
  function pollClosed(poll){
    return !!poll && (!!poll.closed_at || (poll.closes_at && new Date(poll.closes_at).getTime()<=Date.now()));
  }
  function localDateTime(value){
    if(!value)return '';
    var d=new Date(value),pad=function(n){return String(n).padStart(2,'0')};
    return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
  }
  function pollWhen(poll){
    if(pollClosed(poll))return t('Poll closed','تم إغلاق التصويت');
    if(!poll || !poll.closes_at)return t('No closing time','بدون موعد إغلاق');
    try{
      return t('Closes','يغلق')+' '+new Intl.DateTimeFormat(state.lang==='ar'?'ar-EG':'en-GB',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(poll.closes_at));
    }catch(_){return ''}
  }
  function scheduleCloseRefresh(poll){
    if(!poll||!poll.closes_at||poll.closed_at)return;
    var key=String(poll.id),existing=closeTimers.get(key);
    if(existing){clearTimeout(existing);closeTimers.delete(key)}
    var remaining=new Date(poll.closes_at).getTime()-Date.now();
    if(remaining<=0)return;
    var delay=Math.min(remaining+150,2147480000);
    closeTimers.set(key,setTimeout(async function(){
      closeTimers.delete(key);
      if(delay<remaining){scheduleCloseRefresh(poll);return}
      await loadPublicPolls(true,false);
      if(state.view==='home')render();
    },delay));
  }

  async function loadPublicPolls(force,rerender){
    if(!sb||!authUser||store.loading)return;
    var ids=currentPublicPollIds(),signature=ids.join('|');
    if(!force&&store.loaded&&store.signature===signature)return;
    store.loading=true;
    try{
      store.polls=[];store.options=[];store.results=[];store.loaded=true;store.signature=signature;
      if(ids.length){
        var pollRes=await sb.from('circle_polls').select('*').in('post_id',ids).order('created_at',{ascending:false});
        if(pollRes.error){console.error('[NEIS public polls]',pollRes.error);return}
        store.polls=pollRes.data||[];
        var pollIds=store.polls.map(function(p){return p.id});
        if(pollIds.length){
          var responses=await Promise.all([
            sb.from('circle_poll_options').select('*').in('poll_id',pollIds).order('sort_order'),
            sb.rpc('get_circle_poll_results',{p_poll_ids:pollIds})
          ]);
          if(!responses[0].error)store.options=responses[0].data||[];else console.error('[NEIS public poll options]',responses[0].error);
          if(!responses[1].error)store.results=responses[1].data||[];else console.error('[NEIS public poll results]',responses[1].error);
        }
      }
      if(realtime){try{await sb.removeChannel(realtime)}catch(_){}}
      realtime=sb.channel('neis-public-polls')
        .on('postgres_changes',{event:'*',schema:'public',table:'circle_polls'},function(payload){
          var pollId=(payload.new&&payload.new.id)||(payload.old&&payload.old.id);
          var postId=(payload.new&&payload.new.post_id)||(payload.old&&payload.old.post_id);
          if(store.polls.some(function(p){return same(p.id,pollId)})||
             (postId&&state.posts.some(function(p){return same(p.id,postId)&&isPublicPollPost(p)})))scheduleRealtimeRefresh();
        })
        .on('postgres_changes',{event:'*',schema:'public',table:'circle_poll_votes'},function(payload){
          var pollId=(payload.new&&payload.new.poll_id)||(payload.old&&payload.old.poll_id);
          if(store.polls.some(function(p){return same(p.id,pollId)}))scheduleRealtimeRefresh();
        })
        .on('postgres_changes',{event:'*',schema:'public',table:'circle_poll_options'},function(payload){
          var pollId=(payload.new&&payload.new.poll_id)||(payload.old&&payload.old.poll_id);
          if(store.polls.some(function(p){return same(p.id,pollId)}))scheduleRealtimeRefresh();
        }).subscribe();
      if(rerender&&state.view==='home')render();
    }finally{
      store.loading=false;
    }
  }

  function markup(post){
    var poll=pollForPost(post.id);
    if(!poll)return '<section class="circle-poll-card circle-poll-loading"><small>'+t('Loading poll…','جارٍ تحميل التصويت…')+'</small></section>';
    scheduleCloseRefresh(poll);
    var options=pollOptions(poll.id),results=pollResults(poll.id),resultMap=new Map(results.map(function(r){return [String(r.option_id),r]}));
    var first=results[0]||{},canView=!!first.can_view_results,hasVoted=results.some(function(r){return !!r.my_vote}),closed=pollClosed(poll);
    var canVote=!!authUser&&!closed&&(!hasVoted||poll.allow_vote_change);
    var total=canView?Number(first.total_voters||0):0,hasAnyVotes=canView&&total>0,inputType=poll.selection_type==='multiple'?'checkbox':'radio';
    var own=same(poll.creator_id,authUser&&authUser.id),mainAdmin=isMainAdminUser(),admin=!!state.isAdmin;
    var canManageSettings=(own||mainAdmin)&&!closed,canClose=(own||mainAdmin||admin)&&!closed;
    var canViewVoters=!poll.anonymous&&hasAnyVotes&&(hasVoted||closed||own||mainAdmin||admin);
    var chooseLabel=poll.selection_type==='multiple'?(poll.max_selections?t('Choose up to','اختر حتى')+' '+poll.max_selections:t('Choose one or more','اختر خيارًا أو أكثر')):t('Choose one','اختر خيارًا واحدًا');
    var optionHtml=options.map(function(option){
      var row=resultMap.get(String(option.id))||{},mine=!!row.my_vote,count=hasAnyVotes?Number(row.vote_count||0):0,pct=hasAnyVotes&&total>0?Math.round(count/total*100):0;
      return '<div class="circle-poll-option '+(mine?'selected ':'')+(hasAnyVotes?'has-results':'')+'"><label class="circle-poll-option-row"><input type="'+inputType+'" name="public-poll-'+esc(poll.id)+'" value="'+esc(option.id)+'" '+(mine?'checked ':'')+(canVote?'':'disabled')+'><b>'+esc(option.option_text)+'</b>'+(hasAnyVotes?'<strong>'+pct+'%</strong>':'')+'</label>'+(hasAnyVotes?'<span class="circle-poll-progress"><i style="width:'+pct+'%"></i></span><div class="circle-poll-option-foot"><small>'+count+' '+t(count===1?'vote':'votes','صوت')+'</small>'+(canViewVoters&&count>0?'<button type="button" class="circle-poll-voter-link" data-public-poll-voters="'+esc(poll.id)+'" data-public-poll-option-voters="'+esc(option.id)+'">'+t('View voters','عرض المصوتين')+'</button>':'')+'</div>':'')+'</div>';
    }).join('');
    var note=!canView?(poll.results_visibility==='after_close'?t('Results appear when the poll closes.','تظهر النتائج بعد إغلاق التصويت.'):t('Vote to see the results.','صوّت لرؤية النتائج.')):(!hasAnyVotes?t('No votes yet.','لا توجد أصوات بعد.'):'');
    return '<section class="circle-poll-card" data-public-poll-card="'+esc(poll.id)+'"><div class="circle-poll-meta"><span>'+esc(chooseLabel)+'</span><span>·</span><span>'+esc(pollWhen(poll))+'</span>'+(poll.anonymous?'<span>· '+t('Anonymous','مجهول')+'</span>':'')+'</div><div class="circle-poll-options">'+optionHtml+'</div>'+(note?'<p class="circle-poll-results-note">'+note+'</p>':'')+'<div class="circle-poll-footer"><span>'+(hasAnyVotes?total+' '+t(total===1?'voter':'voters','مشارك'):canView?t('No votes yet','لا توجد أصوات بعد'):t('Results hidden','النتائج مخفية'))+'</span><div>'+(canManageSettings?'<button type="button" class="secondary circle-poll-mini" data-public-poll-settings="'+esc(poll.id)+'">'+t('Poll settings','إعدادات التصويت')+'</button>':'')+(canClose?'<button type="button" class="secondary circle-poll-mini" data-close-public-poll="'+esc(poll.id)+'">'+t('Close','إغلاق')+'</button>':'')+(canVote?'<button type="button" class="primary circle-poll-vote" data-vote-public-poll="'+esc(poll.id)+'">'+(hasVoted?t('Change vote','تغيير التصويت'):t('Vote','تصويت'))+'</button>':hasVoted&&!poll.allow_vote_change?'<span class="circle-poll-locked">'+t('Vote submitted','تم التصويت')+'</span>':'')+'</div></div></section>';
  }

  async function openPublicPollVoters(pollId,optionId){
    var poll=store.polls.find(function(p){return same(p.id,pollId)}),option=pollOptions(pollId).find(function(o){return same(o.id,optionId)});
    if(!poll||!option||poll.anonymous)return;
    var result=await sb.rpc('get_circle_poll_option_voters',{p_poll_id:pollId,p_option_id:optionId});
    if(result.error){toast(safeError(result.error,'view these voters'));return}
    var voters=result.data||[];
    openModal('<div class="modal-head"><div><p class="kicker"><i></i>'+t('Poll voters','المصوتون')+'</p><h2>'+esc(option.option_text)+'</h2><p>'+voters.length+' '+t(voters.length===1?'voter':'voters','مشارك')+'</p></div><button class="close" data-close>×</button></div><div class="circle-poll-voter-list">'+(voters.length?voters.map(function(v){return '<div class="circle-poll-voter-row">'+profileAvatar(v)+'<div><b>'+esc(v.full_name||v.username||t('Student','طالب'))+'</b><span>'+(v.username?'@'+esc(v.username):'')+'</span><small>'+[v.grade,v.branch,v.campus].filter(function(value,index,array){return value&&array.indexOf(value)===index}).map(esc).join(' · ')+'</small></div></div>'}).join(''):'<p class="circle-poll-voter-empty">'+t('No voters yet.','لا يوجد مصوتون بعد.')+'</p>')+'</div>',true);
  }

  function addTypeOption(select,value){
    if(!select)return;
    var exists=[].slice.call(select.options).some(function(option){return option.value===value||option.textContent.trim()===value});
    if(!exists){
      var option=document.createElement('option');
      option.value=value;option.textContent=value;
      select.appendChild(option);
    }
  }

  function drawOptionEditors(host,values,prefix,locked){
    host.innerHTML=values.map(function(value,index){
      return '<div class="circle-poll-option-editor"><span>'+(index+1)+'</span><input data-'+prefix+'-option="'+index+'" maxlength="180" value="'+esc(value)+'" '+(locked?'disabled':'')+'><button type="button" data-'+prefix+'-remove="'+index+'" '+(locked||values.length<=2?'disabled':'')+'>×</button></div>';
    }).join('');
  }

  function openPublicPollComposer(){
    if(!requireAccount())return;
    openModal('<div class="modal-head"><div><p class="kicker"><i></i>'+t('Create','إنشاء')+'</p><h2>'+t('Create a poll','إنشاء تصويت')+'</h2><p>'+t('Public polls appear in the main feed and update live.','تظهر التصويتات العامة في الصفحة الرئيسية وتتحدث مباشرة.')+'</p></div><button class="close" data-close>×</button></div>'+
      '<form id="publicPollForm"><label class="field">'+t('Poll question','سؤال التصويت')+'<input id="ppTitle" required minlength="3" maxlength="140"></label><label class="field">'+t('Description / context (optional)','الوصف / السياق (اختياري)')+'<textarea id="ppBody" rows="5" maxlength="6000"></textarea></label>'+
      '<section class="circle-poll-composer"><div class="circle-poll-composer-head"><div><b>'+t('Poll options','خيارات التصويت')+'</b><small>'+t('Add between 2 and 10 unique answers.','أضف من خيارين إلى 10 اختيارات مختلفة.')+'</small></div><button type="button" class="secondary" id="ppAdd">+ '+t('Add option','إضافة اختيار')+'</button></div><div id="ppOptions" class="circle-poll-option-editors"></div>'+
      '<div class="circle-poll-settings"><label class="field">'+t('Voting type','نوع التصويت')+'<select id="ppSelection"><option value="single">'+t('Single choice','اختيار واحد')+'</option><option value="multiple">'+t('Multiple choice','اختيارات متعددة')+'</option></select></label><label class="field hidden" id="ppMaxWrap">'+t('Maximum choices','الحد الأقصى للاختيارات')+'<input id="ppMax" type="number" min="1" max="10" placeholder="'+t('No limit','بدون حد')+'"></label><label class="field">'+t('Results visibility','ظهور النتائج')+'<select id="ppResults"><option value="after_vote" selected>'+t('After voting','بعد التصويت')+'</option><option value="always">'+t('Always visible','ظاهرة دائمًا')+'</option><option value="after_close">'+t('After closing','بعد الإغلاق')+'</option></select></label><label class="field">'+t('Closing','الإغلاق')+'<select id="ppClosing"><option value="none">'+t('No end date','بدون موعد انتهاء')+'</option><option value="custom">'+t('Custom date & time','تاريخ ووقت مخصص')+'</option></select></label><label class="field hidden" id="ppCloseWrap">'+t('Close at','يغلق في')+'<input id="ppCloseAt" type="datetime-local"></label></div>'+
      '<div class="circle-poll-toggles"><label><input id="ppAllowChange" type="checkbox" checked><span><b>'+t('Allow vote changes','السماح بتغيير التصويت')+'</b><small>'+t('People can update their vote while the poll is open.','يمكن للمستخدمين تعديل تصويتهم أثناء فتح التصويت.')+'</small></span></label><label><input id="ppAnonymous" type="checkbox"><span><b>'+t('Anonymous voting','تصويت مجهول')+'</b><small>'+t('Voter identities stay hidden.','تظل هوية المصوتين مخفية.')+'</small></span></label></div></section>'+
      '<div class="row"><label class="field">'+t('Tags','الوسوم')+'<input id="ppTags"></label><label class="field">'+t('Images (up to 8)','الصور (حتى 8)')+'<input id="ppImages" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple></label></div>'+
      '<div class="post-image-display-setting"><span>'+t('Image display','عرض الصور')+'</span><div class="post-image-display-options"><label><input type="radio" name="ppImageMode" value="fit" checked><b>Fit</b><small>'+t('Show the whole image.','إظهار الصورة كاملة.')+'</small></label><label><input type="radio" name="ppImageMode" value="fill"><b>Fill</b><small>'+t('Fill the gallery frame; edges may be cropped.','ملء مساحة المعرض وقد يتم قص الأطراف.')+'</small></label></div></div>'+
      '<div id="ppImagePreview" class="post-upload-preview-grid hidden"></div><div class="modal-actions"><button type="button" class="secondary" data-close>'+t('Cancel','إلغاء')+'</button><button class="primary" id="ppSubmit">'+t('Publish','نشر')+'</button></div></form>',true);

    var values=['',''],selectedFiles=[];
    var host=$('#ppOptions');
    function redraw(){
      drawOptionEditors(host,values,'pp',false);
      host.querySelectorAll('[data-pp-option]').forEach(function(input){input.oninput=function(){values[Number(input.dataset.ppOption)]=input.value}});
      host.querySelectorAll('[data-pp-remove]').forEach(function(button){button.onclick=function(){if(values.length<=2)return;values.splice(Number(button.dataset.ppRemove),1);redraw()}});
      $('#ppAdd').disabled=values.length>=10;
    }
    redraw();
    $('#ppAdd').onclick=function(){if(values.length<10){values.push('');redraw()}};
    $('#ppSelection').onchange=function(){$('#ppMaxWrap').classList.toggle('hidden',$('#ppSelection').value!=='multiple')};
    $('#ppClosing').onchange=function(){$('#ppCloseWrap').classList.toggle('hidden',$('#ppClosing').value!=='custom')};

    var imageInput=$('#ppImages'),preview=$('#ppImagePreview');
    function drawImages(){
      preview.innerHTML=selectedFiles.map(function(file,index){return '<div class="post-upload-preview-item"><img src="'+URL.createObjectURL(file)+'" alt="'+esc(t('Selected image','صورة مختارة'))+' '+(index+1)+'"><span>'+(index+1)+'</span></div>'}).join('');
      preview.classList.toggle('hidden',!selectedFiles.length);
    }
    imageInput.onchange=function(){
      selectedFiles=[].slice.call(imageInput.files||[]).slice(0,8);
      if((imageInput.files&&imageInput.files.length||0)>8)toast(t('You can add up to 8 images per post.','يمكنك إضافة حتى 8 صور في المنشور.'));
      drawImages();
    };

    $('#publicPollForm').onsubmit=async function(event){
      event.preventDefault();
      var button=$('#ppSubmit'),clean=values.map(function(v){return v.trim()}).filter(Boolean);
      if(clean.length<2||clean.length>10){toast(t('Add between 2 and 10 poll options.','أضف من خيارين إلى 10 خيارات للتصويت.'));return}
      if(new Set(clean.map(function(v){return v.toLowerCase()})).size!==clean.length){toast(t('Poll options must be unique.','يجب أن تكون خيارات التصويت مختلفة.'));return}
      if($('#ppClosing').value==='custom'&&!$('#ppCloseAt').value){toast(t('Choose a closing date and time.','اختر تاريخ ووقت الإغلاق.'));return}
      button.disabled=true;
      var imageUrls=[];
      for(var file of selectedFiles){
        var url=await uploadMedia(file,'posts');
        if(!url){for(var oldUrl of imageUrls)await removeMediaUrl(oldUrl);button.disabled=false;return}
        imageUrls.push(url);
      }
      var selection=$('#ppSelection').value,rawMax=$('#ppMax').value.trim();
      var maxSelections=selection==='single'?1:(rawMax?Math.min(clean.length,Math.max(1,Number(rawMax)||1)):null);
      var closeValue=$('#ppClosing').value==='custom'?$('#ppCloseAt').value:'';
      var result=await sb.rpc('create_public_poll_post',{
        p_title:$('#ppTitle').value.trim(),
        p_body:$('#ppBody').value.trim(),
        p_tags:$('#ppTags').value.split(',').map(function(v){return v.trim()}).filter(Boolean).slice(0,8),
        p_image_url:imageUrls[0]||'',
        p_image_urls:imageUrls,
        p_image_display_mode:document.querySelector('input[name="ppImageMode"]:checked')&&document.querySelector('input[name="ppImageMode"]:checked').value==='fill'?'fill':'fit',
        p_options:clean,
        p_selection_type:selection,
        p_max_selections:maxSelections,
        p_allow_vote_change:$('#ppAllowChange').checked,
        p_anonymous:$('#ppAnonymous').checked,
        p_results_visibility:$('#ppResults').value,
        p_closes_at:closeValue?new Date(closeValue).toISOString():null
      });
      if(result.error){for(var failedUrl of imageUrls)await removeMediaUrl(failedUrl);toast(safeError(result.error,'create this poll'));button.disabled=false;return}
      closeModal();await loadLiveData();await loadPublicPolls(true,false);nav('home');toast(t('Poll published.','تم نشر التصويت.'));
    };
  }

  async function openSettings(pollId){
    var poll=store.polls.find(function(p){return same(p.id,pollId)}),post=poll&&state.posts.find(function(p){return same(p.id,poll.post_id)});
    var canManage=same(poll&&poll.creator_id,authUser&&authUser.id)||isMainAdminUser();
    if(!poll||!post||!canManage)return;
    if(pollClosed(poll)){toast(t('Closed polls cannot be edited.','لا يمكن تعديل التصويت بعد إغلاقه.'));return}
    var lock=await sb.rpc('get_circle_poll_edit_state',{p_poll_id:poll.id});
    if(lock.error){toast(safeError(lock.error,'open this poll'));return}
    var locked=!!(lock.data&&lock.data[0]&&lock.data[0].has_votes),values=pollOptions(poll.id).map(function(o){return o.option_text});
    openModal('<div class="modal-head"><div><h2>'+t('Poll settings','إعدادات التصويت')+'</h2><p>'+(locked?t('Voting has started. Answer options and voting type are now locked.','بدأ التصويت، لذلك تم تثبيت الخيارات ونوع التصويت.'):t('Customize the poll before the first vote.','خصص التصويت قبل أول صوت.'))+'</p></div><button class="close" data-close>×</button></div>'+
      '<form id="publicPollSettings"><label class="field">'+t('Poll question','سؤال التصويت')+'<input id="ppsTitle" required maxlength="140" value="'+esc(post.title||'')+'"></label><label class="field">'+t('Description / context (optional)','الوصف / السياق (اختياري)')+'<textarea id="ppsBody" rows="5" maxlength="6000">'+esc(String(post.body||'').trim())+'</textarea></label>'+
      '<div class="circle-poll-composer-head"><div><b>'+t('Answer options','خيارات الإجابة')+'</b></div>'+(locked?'':'<button type="button" class="secondary" id="ppsAdd">+ '+t('Add option','إضافة خيار')+'</button>')+'</div><div id="ppsOptions" class="circle-poll-option-editors"></div>'+
      '<div class="circle-poll-settings"><label class="field">'+t('Voting type','نوع التصويت')+'<select id="ppsSelection" '+(locked?'disabled':'')+'><option value="single" '+(poll.selection_type==='single'?'selected':'')+'>'+t('Single choice','اختيار واحد')+'</option><option value="multiple" '+(poll.selection_type==='multiple'?'selected':'')+'>'+t('Multiple choice','اختيارات متعددة')+'</option></select></label><label class="field '+(poll.selection_type==='multiple'?'':'hidden')+'" id="ppsMaxWrap">'+t('Maximum choices','الحد الأقصى للاختيارات')+'<input id="ppsMax" type="number" min="1" max="10" value="'+(poll.max_selections==null?'':poll.max_selections)+'" '+(locked?'disabled':'')+'></label><label class="field">'+t('Results visibility','ظهور النتائج')+'<select id="ppsResults"><option value="after_vote" '+(poll.results_visibility==='after_vote'?'selected':'')+'>'+t('After voting','بعد التصويت')+'</option><option value="always" '+(poll.results_visibility==='always'?'selected':'')+'>'+t('Always visible','ظاهرة دائمًا')+'</option><option value="after_close" '+(poll.results_visibility==='after_close'?'selected':'')+'>'+t('After closing','بعد الإغلاق')+'</option></select></label><label class="field">'+t('Closing','الإغلاق')+'<select id="ppsClosing"><option value="none" '+(poll.closes_at?'':'selected')+'>'+t('No end date','بدون موعد انتهاء')+'</option><option value="custom" '+(poll.closes_at?'selected':'')+'>'+t('Custom date & time','تاريخ ووقت مخصص')+'</option></select></label><label class="field '+(poll.closes_at?'':'hidden')+'" id="ppsCloseWrap">'+t('Close at','يغلق في')+'<input id="ppsCloseAt" type="datetime-local" value="'+esc(localDateTime(poll.closes_at))+'"></label></div>'+
      '<div class="circle-poll-toggles"><label><input id="ppsAllowChange" type="checkbox" '+(poll.allow_vote_change?'checked':'')+'><span><b>'+t('Allow vote changes','السماح بتغيير التصويت')+'</b><small>'+t('People can update their vote while the poll is open.','يمكن للمستخدمين تعديل تصويتهم أثناء فتح التصويت.')+'</small></span></label><label><input id="ppsAnonymous" type="checkbox" '+(poll.anonymous?'checked':'')+'><span><b>'+t('Anonymous voting','تصويت مجهول')+'</b><small>'+t('Voter identities stay hidden.','تظل هوية المصوتين مخفية.')+'</small></span></label></div><label class="field">'+t('Tags','الوسوم')+'<input id="ppsTags" value="'+esc((post.tags||[]).join(', '))+'"></label>'+
      '<div class="post-image-display-setting"><span>'+t('Image display','عرض الصور')+'</span><div class="post-image-display-options"><label><input type="radio" name="ppsImageMode" value="fit" '+(post.image_display_mode==='fill'?'':'checked')+'><b>Fit</b><small>'+t('Show the whole image.','إظهار الصورة كاملة.')+'</small></label><label><input type="radio" name="ppsImageMode" value="fill" '+(post.image_display_mode==='fill'?'checked':'')+'><b>Fill</b><small>'+t('Fill the gallery frame.','ملء مساحة المعرض.')+'</small></label></div></div>'+
      '<div class="modal-actions"><button type="button" class="secondary" data-close>'+t('Cancel','إلغاء')+'</button><button class="primary" id="ppsSave">'+t('Save changes','حفظ التغييرات')+'</button></div></form>',true);

    var host=$('#ppsOptions');
    function draw(){
      drawOptionEditors(host,values,'pps',locked);
      host.querySelectorAll('[data-pps-option]').forEach(function(input){input.oninput=function(){values[Number(input.dataset.ppsOption)]=input.value}});
      host.querySelectorAll('[data-pps-remove]').forEach(function(button){button.onclick=function(){if(locked||values.length<=2)return;values.splice(Number(button.dataset.ppsRemove),1);draw()}});
      if($('#ppsAdd'))$('#ppsAdd').disabled=values.length>=10;
    }
    draw();
    if($('#ppsAdd'))$('#ppsAdd').onclick=function(){if(values.length<10){values.push('');draw()}};
    $('#ppsSelection').onchange=function(){$('#ppsMaxWrap').classList.toggle('hidden',$('#ppsSelection').value!=='multiple')};
    $('#ppsClosing').onchange=function(){$('#ppsCloseWrap').classList.toggle('hidden',$('#ppsClosing').value!=='custom')};

    $('#publicPollSettings').onsubmit=async function(event){
      event.preventDefault();
      var button=$('#ppsSave'),clean=values.map(function(v){return v.trim()}).filter(Boolean);
      if(clean.length<2||clean.length>10){toast(t('Add between 2 and 10 poll options.','أضف من خيارين إلى 10 خيارات للتصويت.'));return}
      if(new Set(clean.map(function(v){return v.toLowerCase()})).size!==clean.length){toast(t('Poll options must be unique.','يجب أن تكون خيارات التصويت مختلفة.'));return}
      if($('#ppsClosing').value==='custom'&&!$('#ppsCloseAt').value){toast(t('Choose a closing date and time.','اختر تاريخ ووقت الإغلاق.'));return}
      button.disabled=true;
      var selection=$('#ppsSelection').value,rawMax=$('#ppsMax').value.trim(),max=selection==='single'?1:(rawMax?Math.min(clean.length,Math.max(1,Number(rawMax)||1)):null);
      var closeValue=$('#ppsClosing').value==='custom'?$('#ppsCloseAt').value:'';
      var result=await sb.rpc('update_circle_poll_post',{
        p_poll_id:poll.id,p_title:$('#ppsTitle').value.trim(),p_body:$('#ppsBody').value.trim(),p_tags:$('#ppsTags').value.split(',').map(function(v){return v.trim()}).filter(Boolean).slice(0,8),
        p_image_url:post.image_url||'',p_image_urls:postImages(post),p_image_display_mode:(document.querySelector('input[name="ppsImageMode"]:checked')&&document.querySelector('input[name="ppsImageMode"]:checked').value==='fill')?'fill':'fit',p_options:clean,
        p_selection_type:selection,p_max_selections:max,p_allow_vote_change:$('#ppsAllowChange').checked,p_anonymous:$('#ppsAnonymous').checked,p_results_visibility:$('#ppsResults').value,
        p_closes_at:closeValue?new Date(closeValue).toISOString():null
      });
      if(result.error){toast(safeError(result.error,'update this poll'));button.disabled=false;return}
      closeModal();await loadLiveData();await loadPublicPolls(true,false);render();toast(t('Poll updated.','تم تحديث التصويت.'));
    };
  }

  async function openSettingsForPost(postId){
    var post=(Array.isArray(state.posts)?state.posts:[]).find(function(item){return same(item.id,postId)});
    if(!post||!isPublicPollPost(post))return false;
    var poll=pollForPost(postId);
    if(!poll){
      await loadPublicPolls(true,false);
      poll=pollForPost(postId);
    }
    if(!poll){
      toast(t('Poll data could not be loaded. Please refresh and try again.','تعذر تحميل بيانات التصويت. حدّث الصفحة وحاول مرة أخرى.'));
      return false;
    }
    await openSettings(poll.id);
    return true;
  }

  function fallbackPublicPollPostCard(post){
    var own=same(post&&post.author_id,authUser&&authUser.id),mainAdmin=isMainAdminUser();
    var canDelete=own||mainAdmin||state.isAdmin;
    var menu=(own||mainAdmin)
      ?'<button class="post-owner-menu" data-edit-post="'+esc(post.id)+'" aria-label="'+t('Edit poll','تعديل التصويت')+'">•••</button>'+(canDelete?'<button class="danger" data-delete-post="'+esc(post.id)+'" aria-label="'+t('Delete post','حذف المنشور')+'">×</button>':'')
      :(canDelete?'<button class="danger" data-delete-post="'+esc(post.id)+'" aria-label="'+t('Delete post','حذف المنشور')+'">×</button>':'<button class="post-report-menu" data-report-target="post" data-report-id="'+esc(post.id)+'" aria-label="'+t('Report post','الإبلاغ عن المنشور')+'">⚑</button>');
    var tags=Array.isArray(post.tags)?post.tags:[];
    return '<article class="post" id="post-'+esc(post.id)+'" data-post="'+esc(post.id)+'">'+
      '<div class="post-top"><div class="post-person"><b>'+esc(post.user||t('NEIS Student','طالب NEIS'))+'</b><small>'+esc(post.meta||'NEIS Circle')+(post.time?' · '+esc(post.time):'')+'</small></div><div class="post-meta-actions"><span class="post-kind">'+esc(post.kind||'Poll')+'</span><div class="post-menu">'+menu+'</div></div></div>'+
      '<h3 dir="auto">'+esc(post.title||'')+'</h3><p class="post-body" dir="auto">'+esc(post.body||'')+'</p>'+
      '<div class="tag-row">'+tags.map(function(tag){return '<button class="chip" data-topic="'+esc(tag)+'">#'+esc(tag)+'</button>'}).join('')+'</div>'+
      '<div class="post-actions"><button class="action" data-action="like" data-id="'+esc(post.id)+'"><span>'+t('Helpful','مفيد')+'</span><b>'+Number(post.likes||0)+'</b></button><button class="action" data-action="comments" data-id="'+esc(post.id)+'"><span>'+t('Replies','الردود')+'</span><b>'+Number(post.comments||0)+'</b></button><button class="action save" data-action="save" data-id="'+esc(post.id)+'"><span>'+t('Save','حفظ')+'</span></button><button class="action" data-action="share" data-id="'+esc(post.id)+'"><span>'+t('Share','مشاركة')+'</span></button></div></article>';
  }

  function decoratePostCard(post,html){
    if(!isPublicPollPost(post)||typeof html!=='string')return html;
    if(html.indexOf('data-public-poll-card=')>=0||html.indexOf('circle-poll-loading')>=0)return html;
    var pollMarkup='';
    try{pollMarkup=markup(post)}
    catch(error){
      console.error('[NEIS public poll markup render]',error,post);
      pollMarkup='<section class="circle-poll-card circle-poll-loading"><small>'+t('Poll is loading.','جارٍ تحميل التصويت.')+'</small></section>';
    }
    if(html.includes('<div class="tag-row">'))html=html.replace('<div class="tag-row">',pollMarkup+'<div class="tag-row">');
    else if(html.includes('<div class="post-actions">'))html=html.replace('<div class="post-actions">',pollMarkup+'<div class="post-actions">');
    else html+=pollMarkup;
    html=html.replace('data-edit-post="'+esc(post.id)+'"','data-public-poll-settings-post="'+esc(post.id)+'"');
    return html;
  }

  var previousLoadLiveDataForPublicPolls=loadLiveData;
  loadLiveData=async function(){
    var result=await previousLoadLiveDataForPublicPolls.apply(this,arguments);
    if(sb&&authUser){
      var signature=currentSignature();
      if(signature&&(!store.loaded||store.signature!==signature))await loadPublicPolls(true,false);
      else if(!signature&&store.signature){
        store.polls=[];store.options=[];store.results=[];store.signature='';store.loaded=true;
      }
    }
    return result;
  };

  var basePostCard=postCard;
  postCard=function(post){
    var html='';
    try{html=basePostCard(post)}
    catch(error){
      console.error('[NEIS public poll base card render]',error,post);
      html=fallbackPublicPollPostCard(post);
    }
    return decoratePostCard(post,html);
  };

  var baseHome=home;
  home=function(){
    var signature=currentSignature();
    if(signature&&(!store.loaded||store.signature!==signature)&&!store.loading){
      setTimeout(function(){loadPublicPolls(true,true)},0);
    }else if(!signature&&store.signature){
      store.polls=[];store.options=[];store.results=[];store.signature='';store.loaded=true;
    }
    return baseHome();
  };

  if(typeof openCirclePost==='function'){
    var baseCirclePost=openCirclePost;
    openCirclePost=function(){
      baseCirclePost();
      var select=$('#cpKind');
      if(!select)return;
      ['Discussion','Question','Resource','Experience','Announcement','Poll'].forEach(function(value){addTypeOption(select,value)});
    };
  }

  var baseBindV6=bindV6;
  bindV6=function(){
    baseBindV6();
    var root=$('#view');
    if(!root)return;
    root.querySelectorAll('[data-public-poll-card] input').forEach(function(input){
      input.onchange=function(){
        var poll=store.polls.find(function(p){return same(p.id,input.closest('[data-public-poll-card]').dataset.publicPollCard)});
        if(!poll)return;
        input.closest('[data-public-poll-card]').querySelectorAll('.circle-poll-option').forEach(function(row){row.classList.toggle('selected',!!(row.querySelector('input')&&row.querySelector('input').checked))});
        if(poll.selection_type==='multiple'&&poll.max_selections){
          var checked=[].slice.call(input.closest('[data-public-poll-card]').querySelectorAll('input[type="checkbox"]:checked'));
          if(checked.length>poll.max_selections){input.checked=false;input.closest('.circle-poll-option').classList.remove('selected');toast(t('You can choose up to','يمكنك اختيار حتى')+' '+poll.max_selections)}
        }
      };
    });
    root.querySelectorAll('[data-vote-public-poll]').forEach(function(button){
      button.onclick=async function(){
        var card=button.closest('[data-public-poll-card]'),poll=store.polls.find(function(p){return same(p.id,button.dataset.votePublicPoll)});
        if(!card||!poll||button.disabled)return;
        var picked=[].slice.call(card.querySelectorAll('input:checked')).map(function(input){return input.value});
        if(!picked.length){toast(t('Choose an option first.','اختر اختيارًا أولًا.'));return}
        button.disabled=true;
        var result=await sb.rpc('cast_circle_poll_vote',{p_poll_id:poll.id,p_option_ids:picked});
        if(result.error){toast(safeError(result.error,'submit this vote'));button.disabled=false;return}
        await loadPublicPolls(true,false);render();toast(t('Vote submitted.','تم تسجيل تصويتك.'));
      };
    });
    root.querySelectorAll('[data-close-public-poll]').forEach(function(button){
      button.onclick=async function(){
        var poll=store.polls.find(function(p){return same(p.id,button.dataset.closePublicPoll)});
        if(!poll||button.disabled)return;
        if(!await confirmAction(t('Close this poll?','إغلاق هذا التصويت؟'),t('People will no longer be able to vote.','لن يتمكن المستخدمون من التصويت بعد ذلك.')))return;
        button.disabled=true;
        var result=await sb.rpc('close_circle_poll',{p_poll_id:poll.id});
        if(result.error){toast(safeError(result.error,'close this poll'));button.disabled=false;return}
        await loadPublicPolls(true,false);render();toast(t('Poll closed.','تم إغلاق التصويت.'));
      };
    });
    root.querySelectorAll('[data-public-poll-voters]').forEach(function(button){
      button.onclick=function(){openPublicPollVoters(button.dataset.publicPollVoters,button.dataset.publicPollOptionVoters)};
    });
    root.querySelectorAll('[data-public-poll-settings]').forEach(function(button){button.onclick=function(){openSettings(button.dataset.publicPollSettings)}});
    root.querySelectorAll('[data-public-poll-settings-post]').forEach(function(button){button.onclick=async function(event){
      event.stopPropagation();
      await openSettingsForPost(button.dataset.publicPollSettingsPost);
    }});
  };

  window.NEISPublicPolls={load:loadPublicPolls,openComposer:function(){return compose('Poll')},openSettingsForPost:openSettingsForPost,decoratePostCard:decoratePostCard,isPublicPollPost:isPublicPollPost,store:store};
})();