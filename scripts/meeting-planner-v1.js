/* NEIS Circle — weekly Meeting Planner post type.
   Users add multiple availability ranges per day; aggregate results rank the best overlaps. */
(function(){
  'use strict';
  if(window.__neisMeetingPlannerV1)return;
  window.__neisMeetingPlannerV1=true;

  var store={planners:[],results:[],myRanges:[],loading:false,loaded:false,signature:''};
  var realtime=null,refreshTimer=null,observer=null;
  var DAYS_EN=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  var DAYS_AR=['الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت','الأحد'];

  function tr(en,ar){return typeof state!=='undefined'&&state.lang==='ar'?ar:en}
  function same(a,b){return String(a??'')===String(b??'')}
  function plannerPosts(){return (typeof state!=='undefined'&&Array.isArray(state.posts)?state.posts:[]).filter(function(p){return p&&p.post_type==='meeting_availability'})}
  function plannerIds(){return plannerPosts().map(function(p){return String(p.id)}).sort()}
  function signature(){return plannerIds().join('|')}
  function plannerFor(postId){return store.planners.find(function(x){return same(x.post_id,postId)})}
  function myRangesFor(postId){return store.myRanges.filter(function(x){return same(x.post_id,postId)}).sort(function(a,b){return a.day_of_week-b.day_of_week||a.start_minute-b.start_minute})}
  function rowsFor(postId){return store.results.filter(function(x){return same(x.post_id,postId)})}
  function dayName(day){return (state.lang==='ar'?DAYS_AR:DAYS_EN)[Number(day)]||''}
  function pad(n){return String(n).padStart(2,'0')}
  function minuteLabel(minute){
    minute=Math.max(0,Math.min(1440,Number(minute)||0));
    if(minute===1440)return state.lang==='ar'?'12:00 ص':'12:00 AM';
    var h=Math.floor(minute/60),m=minute%60,h12=h%12||12,period=h<12?'AM':'PM';
    return state.lang==='ar'?h12+':'+pad(m)+' '+(period==='AM'?'ص':'م'):h12+':'+pad(m)+' '+period;
  }
  function timeInputValue(minute){minute=Number(minute||0);if(minute===1440)return '00:00';var h=Math.floor(minute/60),m=minute%60;return pad(h)+':'+pad(m)}
  function timeToMinute(value){var parts=String(value||'').split(':');if(parts.length<2)return NaN;return Number(parts[0])*60+Number(parts[1])}
  function safeError(error){
    console.error('[NEIS Meeting Planner]',error);
    if(window.neisFriendlyError)try{return window.neisFriendlyError(error,'meeting planner')}catch(_){}
    return error?.message||tr('Something went wrong. Please try again.','حدث خطأ. حاول مرة أخرى.');
  }
  function circleContext(){
    if(state?.view==='circle-detail'&&state?.activeCircleId)return state.activeCircleId;
    return null;
  }

  async function load(force,rerender){
    if(typeof sb==='undefined'||typeof authUser==='undefined'||!sb||!authUser||store.loading)return;
    var ids=plannerIds(),sig=ids.join('|');
    if(!force&&store.loaded&&store.signature===sig){decorateAll();return}
    store.loading=true;
    if(force||store.signature!==sig)store.loaded=false;
    store.signature=sig;
    try{
      store.planners=[];store.results=[];store.myRanges=[];
      if(ids.length){
        var responses=await Promise.all([
          sb.from('meeting_planners').select('*').in('post_id',ids),
          sb.rpc('get_meeting_planner_results',{p_post_ids:ids}),
          sb.from('meeting_availability_ranges').select('*').in('post_id',ids).eq('user_id',authUser.id)
        ]);
        if(responses[0].error)throw responses[0].error;
        if(responses[1].error)throw responses[1].error;
        if(responses[2].error)throw responses[2].error;
        store.planners=responses[0].data||[];
        store.results=responses[1].data||[];
        store.myRanges=responses[2].data||[];
      }
      store.loaded=true;
      setupRealtime();
      if(rerender&&typeof render==='function')render();
      queueMicrotask(decorateAll);
    }catch(error){
      console.error('[NEIS Meeting Planner load]',error);
    }finally{store.loading=false}
  }

  function setupRealtime(){
    if(!sb)return;
    if(realtime){try{sb.removeChannel(realtime)}catch(_){}}
    realtime=sb.channel('neis-meeting-planners-v1')
      .on('postgres_changes',{event:'*',schema:'public',table:'meeting_planners'},function(payload){
        var id=(payload.new&&payload.new.post_id)||(payload.old&&payload.old.post_id);
        if(id&&plannerIds().some(function(x){return same(x,id)}))scheduleRefresh();
      }).subscribe();
  }
  function scheduleRefresh(){
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(function(){load(true,false)},100);
  }

  function windowsFor(postId){
    var planner=plannerFor(postId),duration=Number(planner?.meeting_duration_minutes||60);
    var rows=rowsFor(postId).filter(function(r){return Number(r.available_count||0)>0});
    var windows=rows.map(function(row){
      return {
        day:Number(row.day_of_week),
        start:Number(row.slot_start),
        end:Number(row.slot_start)+duration,
        count:Number(row.available_count||0),
        total:Number(row.participant_count||0)
      };
    });
    windows.sort(function(a,b){
      var aPerfect=a.total>0&&a.count===a.total?1:0,bPerfect=b.total>0&&b.count===b.total?1:0;
      return bPerfect-aPerfect||b.count-a.count||a.day-b.day||a.start-b.start;
    });
    return windows;
  }

  function heatFor(postId,day){
    var rows=rowsFor(postId).filter(function(r){return Number(r.day_of_week)===day}),max=0;
    rows.forEach(function(r){max=Math.max(max,Number(r.available_count||0))});
    if(!rows.length||!max)return '<span class="meeting-day-empty"></span>';
    var buckets=new Array(24).fill(0);
    rows.forEach(function(r){
      var hour=Math.floor(Number(r.slot_start||0)/60);
      buckets[hour]=Math.max(buckets[hour],Number(r.available_count||0)/max);
    });
    return '<span class="meeting-day-heat">'+buckets.map(function(v){return '<i style="opacity:'+(0.12+0.88*v).toFixed(2)+'"></i>'}).join('')+'</span>';
  }

  function markup(post){
    var planner=plannerFor(post.id);
    if(!planner)return '<section class="meeting-planner-card meeting-planner-loading">'+tr('Loading availability…','جارٍ تحميل المواعيد…')+'</section>';
    var allRows=rowsFor(post.id),windows=windowsFor(post.id),mine=myRangesFor(post.id),participantCount=Number(allRows[0]?.participant_count||0);
    var best=windows[0],perfect=best&&best.total>0&&best.count===best.total;
    var bestHtml=best
      ?'<div class="meeting-best-time"><span class="meeting-best-icon">✓</span><div><small>'+tr(perfect?'Best match · everyone is free':'Best match so far',perfect?'أفضل موعد · الجميع متاح':'أفضل موعد حتى الآن')+'</small><b>'+dayName(best.day)+' · '+minuteLabel(best.start)+'–'+minuteLabel(best.end)+'</b><em>'+best.count+'/'+best.total+' '+tr('available','متاح')+'</em></div></div>'
      :'<div class="meeting-best-time is-empty"><span class="meeting-best-icon">⌁</span><div><small>'+tr('Waiting for availability','في انتظار المواعيد')+'</small><b>'+tr('Be the first to add your free times','كن أول من يضيف أوقات فراغه')+'</b></div></div>';
    var suggestions=windows.slice(0,3).map(function(w,index){
      var all=w.total>0&&w.count===w.total;
      return '<div class="meeting-suggestion"><span>'+(index+1)+'</span><div><b>'+dayName(w.day)+' · '+minuteLabel(w.start)+'–'+minuteLabel(w.end)+'</b><small>'+w.count+'/'+w.total+' '+tr('students free','طالب متاح')+(all?' · '+tr('Perfect','مثالي'):'')+'</small></div></div>';
    }).join('');
    var week=DAYS_EN.map(function(_,day){
      return '<div class="meeting-week-day"><b>'+dayName(day).slice(0,state.lang==='ar'?3:3)+'</b>'+heatFor(post.id,day)+'</div>';
    }).join('');
    return '<section class="meeting-planner-card" data-meeting-planner="'+esc(post.id)+'" data-meeting-rev="'+esc(planner.updated_at||'')+'" data-meeting-lang="'+esc(state.lang||'en')+'">'+
      '<div class="meeting-planner-head"><div><span class="meeting-planner-kicker">◷ '+tr('Meeting planner','منظم اجتماع')+'</span><small>'+tr('Add every time you are free this week. The best overlap updates live.','أضف كل الأوقات المتاحة لك هذا الأسبوع. أفضل وقت يتحدث مباشرة.')+'</small></div><div class="meeting-planner-badges"><span class="meeting-timezone">'+esc(planner.timezone||'Africa/Cairo')+'</span><span class="meeting-timezone">'+Number(planner.meeting_duration_minutes||60)+' '+tr('min meeting','دقيقة للاجتماع')+'</span></div></div>'+
      bestHtml+
      '<div class="meeting-week-heat">'+week+'</div>'+
      (suggestions?'<div class="meeting-suggestions">'+suggestions+'</div>':'')+
      '<div class="meeting-planner-foot"><span>'+participantCount+' '+tr(participantCount===1?'participant':'participants','مشارك')+'</span><button type="button" class="primary" data-meeting-availability="'+esc(post.id)+'">'+(mine.length?tr('Edit my availability','تعديل أوقاتي'):tr('Add my availability','إضافة أوقاتي'))+'</button></div>'+
    '</section>';
  }

  function decoratePost(post){
    var card=document.querySelector('.post[data-post="'+CSS.escape(String(post.id))+'"]');
    if(!card)return;
    var planner=plannerFor(post.id);
    var existing=card.querySelector('[data-meeting-planner="'+CSS.escape(String(post.id))+'"]');
    if(existing&&planner&&existing.dataset.meetingRev===String(planner.updated_at||'')&&existing.dataset.meetingLang===String(state.lang||'en')){
      bindPlannerControls(card);return;
    }
    var html=markup(post);
    if(existing){existing.outerHTML=html}
    else{
      var tagRow=card.querySelector('.tag-row'),actions=card.querySelector('.post-actions'),anchor=tagRow||actions;
      if(anchor)anchor.insertAdjacentHTML('beforebegin',html);else card.insertAdjacentHTML('beforeend',html);
    }
    bindPlannerControls(card);
  }
  function decorateAll(){
    if(!store.loaded)return;
    plannerPosts().forEach(decoratePost);
    injectTypeOptions();
  }

  function bindPlannerControls(root){
    root.querySelectorAll('[data-meeting-availability]').forEach(function(button){
      if(button.dataset.bound==='1')return;button.dataset.bound='1';
      button.addEventListener('click',function(event){event.preventDefault();event.stopPropagation();openAvailability(button.dataset.meetingAvailability)});
    });
  }

  function mergeRanges(ranges){
    var byDay={};
    ranges.slice().sort(function(a,b){return a.day-b.day||a.start-b.start}).forEach(function(r){
      var list=byDay[r.day]||(byDay[r.day]=[]),last=list[list.length-1];
      if(last&&r.start<=last.end)last.end=Math.max(last.end,r.end);else list.push({day:r.day,start:r.start,end:r.end});
    });
    return Object.values(byDay).flat();
  }

  function availabilityEditorRows(host,ranges){
    host.innerHTML=DAYS_EN.map(function(_,day){
      var dayRanges=ranges.filter(function(r){return r.day===day});
      return '<section class="meeting-day-editor" data-meeting-day="'+day+'"><header><div><b>'+dayName(day)+'</b><small>'+tr('Add one or more free-time ranges','أضف فترة أو أكثر من أوقات فراغك')+'</small></div><button type="button" class="secondary" data-add-meeting-range="'+day+'">+ '+tr('Range','فترة')+'</button></header><div class="meeting-range-list">'+(dayRanges.length?dayRanges.map(function(r,index){
        return '<div class="meeting-range-row" data-range-key="'+day+'-'+index+'"><label>'+tr('From','من')+'<input type="time" step="900" value="'+timeInputValue(r.start)+'" data-range-start></label><span>→</span><label>'+tr('To','إلى')+'<input type="time" step="900" value="'+timeInputValue(r.end)+'" data-range-end></label><button type="button" class="meeting-range-remove" data-remove-range aria-label="'+tr('Remove range','حذف الفترة')+'">×</button></div>';
      }).join(''):'<p class="meeting-no-ranges">'+tr('Not available / not added yet','غير متاح / لم تتم الإضافة بعد')+'</p>')+'</div></section>';
    }).join('');

    function read(){
      var output=[];
      host.querySelectorAll('.meeting-day-editor').forEach(function(daySection){
        var day=Number(daySection.dataset.meetingDay);
        daySection.querySelectorAll('.meeting-range-row').forEach(function(row){
          var start=timeToMinute(row.querySelector('[data-range-start]').value),end=timeToMinute(row.querySelector('[data-range-end]').value);
          if(end===0&&start>0)end=1440;
          if(Number.isFinite(start)&&Number.isFinite(end))output.push({day:day,start:start,end:end});
        });
      });
      return output;
    }
    function redraw(next){availabilityEditorRows(host,next)}
    host.querySelectorAll('[data-add-meeting-range]').forEach(function(button){
      button.onclick=function(){
        var current=read(),day=Number(button.dataset.addMeetingRange),sameDay=current.filter(function(r){return r.day===day}),start=sameDay.length?sameDay[sameDay.length-1].end:18*60,end=Math.min(1440,start+60);
        if(start>=1440){start=18*60;end=19*60}
        current.push({day:day,start:start,end:end});redraw(current);
      };
    });
    host.querySelectorAll('[data-remove-range]').forEach(function(button){
      button.onclick=function(){
        var row=button.closest('.meeting-range-row'),section=button.closest('.meeting-day-editor'),day=Number(section.dataset.meetingDay),rows=[].slice.call(section.querySelectorAll('.meeting-range-row')),index=rows.indexOf(row);
        var current=read(),dayItems=current.filter(function(r){return r.day===day}),target=dayItems[index];
        if(target){var removed=false;current=current.filter(function(r){if(!removed&&r.day===target.day&&r.start===target.start&&r.end===target.end){removed=true;return false}return true})}
        redraw(current);
      };
    });
    host._readMeetingRanges=read;
  }

  function openAvailability(postId){
    var planner=plannerFor(postId);if(!planner)return;
    var initial=myRangesFor(postId).map(function(r){return {day:Number(r.day_of_week),start:Number(r.start_minute),end:Number(r.end_minute)}});
    openModal('<div class="modal-head"><div><p class="kicker"><i></i>'+tr('Availability','المواعيد المتاحة')+'</p><h2>'+tr('When are you free?','متى تكون متاحًا؟')+'</h2><p>'+tr('Add as many ranges as you need for the whole week. Example: Friday 7:00 PM–10:00 PM.','أضف كل الفترات التي تناسبك خلال الأسبوع. مثال: الجمعة من 7 إلى 10 مساءً.')+'</p></div><button class="close" data-close>×</button></div><form id="meetingAvailabilityForm"><div class="meeting-timezone-note">◷ '+tr('All times use','كل الأوقات بتوقيت')+' <b>'+esc(planner.timezone||'Africa/Cairo')+'</b></div><div id="meetingAvailabilityDays" class="meeting-days-editor"></div><div class="modal-actions"><button type="button" class="secondary" data-close>'+tr('Cancel','إلغاء')+'</button><button class="primary" id="meetingAvailabilitySave">'+tr('Save availability','حفظ المواعيد')+'</button></div></form>',true);
    var host=document.querySelector('#meetingAvailabilityDays');availabilityEditorRows(host,initial);
    document.querySelector('#meetingAvailabilityForm').onsubmit=async function(event){
      event.preventDefault();
      var button=document.querySelector('#meetingAvailabilitySave'),raw=host._readMeetingRanges?host._readMeetingRanges():[];
      for(var r of raw){
        if(r.start<0||r.end>1440||r.end<=r.start||r.start%15||r.end%15){toast(tr('Check every time range. End time must be after start time.','راجع كل الفترات. وقت النهاية يجب أن يكون بعد البداية.'));return}
      }
      var merged=mergeRanges(raw);
      button.disabled=true;
      var result=await sb.rpc('save_meeting_availability',{p_post_id:postId,p_ranges:merged});
      if(result.error){toast(safeError(result.error));button.disabled=false;return}
      closeModal();await load(true,false);toast(tr('Availability saved.','تم حفظ المواعيد.'));
    };
  }

  function openComposer(){
    if(typeof requireAccount==='function'&&!requireAccount())return;
    var circleId=circleContext(),timezone;
    try{timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'Africa/Cairo'}catch(_){timezone='Africa/Cairo'}
    openModal('<div class="modal-head"><div><p class="kicker"><i></i>'+tr('Smart scheduling','تنسيق ذكي')+'</p><h2>'+tr('Find the best meeting time','اعثر على أفضل وقت للاجتماع')+'</h2><p>'+tr('Everyone adds all the times they are free during the week. NEIS Circle finds the strongest overlap automatically.','كل شخص يضيف جميع أوقات فراغه خلال الأسبوع، والمنصة تحسب أفضل وقت تلقائيًا.')+'</p></div><button class="close" data-close>×</button></div><form id="meetingPlannerCreate"><label class="field">'+tr('Meeting / activity','الاجتماع / النشاط')+'<input id="meetingPlannerTitle" required minlength="3" maxlength="140" placeholder="'+tr('e.g. Physics project meeting','مثال: اجتماع مشروع الفيزياء')+'"></label><label class="field">'+tr('Context','التفاصيل')+'<textarea id="meetingPlannerBody" required rows="4" maxlength="6000" placeholder="'+tr('What are you trying to schedule?','ما الاجتماع الذي تحاولون تحديد موعده؟')+'"></textarea></label><div class="row"><label class="field">'+tr('Meeting duration','مدة الاجتماع')+'<select id="meetingPlannerDuration"><option value="30">30 '+tr('minutes','دقيقة')+'</option><option value="45">45 '+tr('minutes','دقيقة')+'</option><option value="60" selected>60 '+tr('minutes','دقيقة')+'</option><option value="90">90 '+tr('minutes','دقيقة')+'</option><option value="120">120 '+tr('minutes','دقيقة')+'</option></select></label><label class="field">'+tr('Start-time precision','دقة وقت البداية')+'<select id="meetingPlannerSlot"><option value="15">15 '+tr('minutes','دقيقة')+'</option><option value="30" selected>30 '+tr('minutes','دقيقة')+'</option><option value="60">60 '+tr('minutes','دقيقة')+'</option></select></label></div><label class="field">'+tr('Timezone','المنطقة الزمنية')+'<input id="meetingPlannerTimezone" value="'+esc(timezone)+'" readonly></label><label class="field">'+tr('Tags','الوسوم')+'<input id="meetingPlannerTags" placeholder="Meeting, Project, Grade11"></label><div class="meeting-create-preview"><span>◷</span><div><b>'+tr('How it works','كيف تعمل')+'</b><small>'+tr('Students can enter ranges such as “Friday 7–10 PM”. Results update live and rank the best common windows.','يمكن للطلاب إدخال فترات مثل «الجمعة من 7 إلى 10 مساءً». النتائج تتحدث مباشرة وترتب أفضل الفترات المشتركة.')+'</small></div></div><div class="modal-actions"><button type="button" class="secondary" data-close>'+tr('Cancel','إلغاء')+'</button><button class="primary" id="meetingPlannerPublish">'+tr('Publish planner','نشر منظم الاجتماع')+'</button></div></form>',true);
    document.querySelector('#meetingPlannerCreate').onsubmit=async function(event){
      event.preventDefault();
      var button=document.querySelector('#meetingPlannerPublish');button.disabled=true;
      var result=await sb.rpc('create_meeting_planner_post',{
        p_title:document.querySelector('#meetingPlannerTitle').value.trim(),
        p_body:document.querySelector('#meetingPlannerBody').value.trim(),
        p_tags:document.querySelector('#meetingPlannerTags').value.split(',').map(function(x){return x.trim()}).filter(Boolean).slice(0,8),
        p_circle_id:circleId,
        p_timezone:document.querySelector('#meetingPlannerTimezone').value||'Africa/Cairo',
        p_slot_minutes:Number(document.querySelector('#meetingPlannerSlot').value||30),
        p_duration_minutes:Number(document.querySelector('#meetingPlannerDuration').value||60)
      });
      if(result.error){toast(safeError(result.error));button.disabled=false;return}
      closeModal();await loadLiveData();store.loaded=false;await load(true,false);
      if(circleId){state.circleTab='home';render()}else nav('home');
      toast(tr('Meeting planner published.','تم نشر منظم الاجتماع.'));
    };
  }

  function addTypeOption(select){
    if(!select||[].slice.call(select.options).some(function(option){return option.value==='Meeting Planner'}))return;
    var option=document.createElement('option');option.value='Meeting Planner';option.textContent=tr('Meeting planner','منظم اجتماع');select.appendChild(option);
  }
  function injectTypeOptions(){document.querySelectorAll('#postKind,#cpKind').forEach(addTypeOption)}

  document.addEventListener('change',function(event){
    var select=event.target;
    if(!select||!['postKind','cpKind'].includes(select.id)||select.value!=='Meeting Planner')return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openComposer();
  },true);

  function boot(){
    injectTypeOptions();
    if(typeof authUser!=='undefined'&&typeof sb!=='undefined'&&authUser&&sb)load(false,false);
    if(!observer){
      observer=new MutationObserver(function(){
        injectTypeOptions();
        var ready=typeof authUser!=='undefined'&&typeof sb!=='undefined'&&authUser&&sb;
        var sig=signature();
        if(ready&&!store.loading&&(!store.loaded||store.signature!==sig))load(false,false);
        else if(store.loaded)decorateAll();
      });
      observer.observe(document.body,{childList:true,subtree:true});
    }
  }
  window.addEventListener('pageshow',boot);
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')boot()});
  window.NEISMeetingPlanner={load:load,openComposer:openComposer,decorate:decorateAll,store:store};
  setTimeout(boot,0);
})();