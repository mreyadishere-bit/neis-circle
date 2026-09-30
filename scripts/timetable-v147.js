/* NEIS Circle Timetable — private weekly schedule for the signed-in user only. */
(function(){
  'use strict';

  const tt=state.timetable={
    rows:[],loading:false,error:'',ready:false,dayFilter:'all',request:0
  };
  const tr=(en,ar)=>state.lang==='ar'?ar:en;
  const same=(a,b)=>String(a)===String(b);
  const days=[
    {id:0,en:'Sunday',ar:'الأحد'},
    {id:1,en:'Monday',ar:'الاثنين'},
    {id:2,en:'Tuesday',ar:'الثلاثاء'},
    {id:3,en:'Wednesday',ar:'الأربعاء'},
    {id:4,en:'Thursday',ar:'الخميس'},
    {id:5,en:'Friday',ar:'الجمعة'},
    {id:6,en:'Saturday',ar:'السبت'}
  ];
  const palette=['#2f7db8','#7a52d8','#10a879','#efb83f','#ec6fb7','#e56d57','#5e6a78','#22a6b3'];
  const categories=['Class','Lab','Study','Exam','Activity','Other'];

  function dayName(id){const d=days.find(x=>x.id===Number(id));return d?(state.lang==='ar'?d.ar:d.en):''}
  function clean(v){return String(v||'').trim()}
  function fmtTime(value){
    const raw=String(value||'').slice(0,5);
    if(!raw)return '';
    const [h,m]=raw.split(':').map(Number);
    const date=new Date();date.setHours(h,m,0,0);
    return new Intl.DateTimeFormat(state.lang==='ar'?'ar-EG':'en-US',{hour:'numeric',minute:'2-digit'}).format(date);
  }
  function minutes(value){const [h,m]=String(value||'00:00').slice(0,5).split(':').map(Number);return h*60+m}
  function friendly(error){console.error('[NEIS Timetable]',error);return window.neisFriendlyError?.(error,'load your timetable')||tr('Could not load your timetable.','تعذر تحميل جدولك.')}
  function sortRows(rows){return [...rows].sort((a,b)=>Number(a.day_of_week)-Number(b.day_of_week)||minutes(a.start_time)-minutes(b.start_time)||String(a.title).localeCompare(String(b.title)))}
  function currentDay(){return new Date().getDay()}
  function currentMinutes(){const d=new Date();return d.getHours()*60+d.getMinutes()}
  function extraDaysKey(){return 'neis_timetable_extra_days_'+String(authUser?.id||'guest')}
  function savedExtraDays(){
    try{
      const parsed=JSON.parse(localStorage.getItem(extraDaysKey())||'[]');
      return Array.isArray(parsed)?parsed.map(Number).filter(day=>day===5||day===6):[];
    }catch{return []}
  }
  function rememberExtraDay(day){
    day=Number(day);if(day!==5&&day!==6)return;
    const next=[...new Set([...savedExtraDays(),day])];
    try{localStorage.setItem(extraDaysKey(),JSON.stringify(next))}catch{}
  }
  function schoolDays(){
    const used=new Set(tt.rows.map(r=>Number(r.day_of_week)));
    const enabled=new Set(savedExtraDays());
    const base=[0,1,2,3,4];
    for(const extra of [5,6])if(used.has(extra)||enabled.has(extra))base.push(extra);
    return base;
  }
  function rowsForDay(day){return tt.rows.filter(r=>Number(r.day_of_week)===Number(day)).sort((a,b)=>minutes(a.start_time)-minutes(b.start_time))}
  function nextEntry(){
    const nowDay=currentDay(),now=currentMinutes();
    const sorted=sortRows(tt.rows);
    return sorted.find(r=>Number(r.day_of_week)===nowDay&&minutes(r.end_time)>=now)
      ||sorted.find(r=>Number(r.day_of_week)>nowDay)
      ||sorted[0]
      ||null;
  }
  function isNow(row){
    return Number(row.day_of_week)===currentDay()&&currentMinutes()>=minutes(row.start_time)&&currentMinutes()<minutes(row.end_time);
  }
  function categoryLabel(value){
    const ar={Class:'حصة',Lab:'معمل',Study:'مذاكرة',Exam:'اختبار',Activity:'نشاط',Other:'أخرى'};
    return state.lang==='ar'?(ar[value]||value):value;
  }

  async function load(){
    if(!sb||!authUser)return;
    const request=++tt.request;tt.loading=true;tt.error='';renderTimetable();
    const {data,error}=await sb.from('user_timetable_entries')
      .select('*')
      .eq('user_id',authUser.id)
      .order('day_of_week')
      .order('start_time');
    if(request!==tt.request)return;
    tt.loading=false;tt.ready=true;
    if(error){tt.error=friendly(error);tt.rows=[]}else tt.rows=sortRows(data||[]);
    renderTimetable();
  }

  function eventCard(row){
    return '<article class="tt-event '+(isNow(row)?'is-now':'')+'" data-tt-edit="'+esc(row.id)+'" tabindex="0" style="--tt-color:'+esc(row.color||palette[0])+'">'+
      '<span class="tt-event-bar"></span>'+
      '<div class="tt-event-main"><div class="tt-event-title"><b>'+esc(row.title)+'</b><span>'+esc(categoryLabel(row.category))+'</span></div>'+
      '<div class="tt-time-row"><time><strong>'+esc(fmtTime(row.start_time))+'</strong><span>→</span><strong>'+esc(fmtTime(row.end_time))+'</strong></time>'+(row.reminder_enabled?'<em>'+esc(row.reminder_minutes)+'m '+esc(tr('before','قبل'))+'</em>':'')+'</div>'+
      (row.location?'<span class="tt-location-pill">'+esc(row.location)+'</span>':'')+
      (row.notes?'<p>'+esc(row.notes)+'</p>':'')+
      '</div>'+
      '<button type="button" class="tt-event-menu" data-tt-menu="'+esc(row.id)+'" aria-label="'+esc(tr('Timetable options','خيارات الجدول'))+'">•••</button>'+
      '</article>';
  }

  function emptyDay(day){
    return '<button class="tt-empty-day" data-tt-add-day="'+day+'" type="button"><span>+</span><b>'+esc(tr('Add a class','أضف حصة'))+'</b><small>'+esc(tr('Nothing scheduled yet','لا يوجد شيء مجدول'))+'</small></button>';
  }

  function desktopBoard(){
    const visible=schoolDays();
    return '<section class="tt-board tt-days-'+visible.length+'">'+visible.map(day=>{
      const rows=rowsForDay(day);
      return '<section class="tt-day '+(day===currentDay()?'today':'')+'"><header><div><span>'+esc(dayName(day))+'</span>'+(day===currentDay()?'<b>'+esc(tr('Today','اليوم'))+'</b>':'')+'</div><button type="button" data-tt-add-day="'+day+'" aria-label="'+esc(tr('Add','إضافة'))+'">+</button></header><div class="tt-day-body">'+(rows.length?rows.map(eventCard).join(''):emptyDay(day))+'</div></section>';
    }).join('')+'</section>';
  }

  function mobileBoard(){
    let selected=tt.dayFilter==='all'?currentDay():Number(tt.dayFilter);
    if(!schoolDays().includes(selected))selected=schoolDays()[0]??0;
    const rows=rowsForDay(selected);
    return '<div class="tt-mobile-days">'+schoolDays().map(day=>'<button class="'+(day===selected?'active':'')+'" data-tt-day="'+day+'"><b>'+esc(dayName(day).slice(0,3))+'</b><span>'+rowsForDay(day).length+'</span></button>').join('')+'</div>'+
      '<section class="tt-mobile-day"><header><div><h2>'+esc(dayName(selected))+'</h2><p>'+esc(selected===currentDay()?tr('Today','اليوم'):tr('Your schedule','جدولك'))+'</p></div><button class="primary" data-tt-add-day="'+selected+'">+ '+esc(tr('Add','إضافة'))+'</button></header><div class="tt-mobile-list">'+(rows.length?rows.map(eventCard).join(''):emptyDay(selected))+'</div></section>';
  }

  function summary(){
    const next=nextEntry();
    const today=rowsForDay(currentDay());
    const total=tt.rows.length;
    return '<section class="tt-summary">'+
      '<article><span>'+esc(tr('Today','اليوم'))+'</span><b>'+today.length+'</b><small>'+esc(tr(today.length===1?'class':'classes','حصة'))+'</small></article>'+
      '<article><span>'+esc(tr('This week','هذا الأسبوع'))+'</span><b>'+total+'</b><small>'+esc(tr('scheduled items','عنصر مجدول'))+'</small></article>'+
      '<article class="tt-next"><span>'+esc(tr('Next up','التالي'))+'</span>'+(next?'<b>'+esc(next.title)+'</b><small>'+esc(dayName(next.day_of_week))+' · '+esc(fmtTime(next.start_time))+'</small>':'<b>'+esc(tr('All clear','لا يوجد'))+'</b><small>'+esc(tr('Add your first class','أضف أول حصة'))+'</small>')+'</article>'+
      '</section>';
  }

  function view(){
    if(tt.loading&&!tt.ready)return '<section class="tt-shell"><div class="tt-loading">'+Array.from({length:5},()=>'<i></i>').join('')+'</div></section>';
    if(tt.error)return '<section class="tt-shell"><div class="empty"><b>'+esc(tr('Timetable could not load','تعذر تحميل الجدول'))+'</b><span>'+esc(tt.error)+'</span><button class="primary" data-tt-retry>'+esc(tr('Try again','حاول مرة أخرى'))+'</button></div></section>';
    return '<section class="tt-head"><div><p class="kicker"><i></i>'+esc(tr('Private weekly planner','مخطط أسبوعي خاص'))+'</p><h1>'+esc(tr('My Timetable','جدولي'))+'</h1><p>'+esc(tr('Build your week once, then see every class clearly at a glance. Only you can access this timetable.','رتّب أسبوعك مرة واحدة وشاهد حصصك بوضوح. أنت فقط تستطيع الوصول إلى هذا الجدول.'))+'</p></div><div class="tt-head-actions"><button class="secondary" data-tt-today>'+esc(tr('Today','اليوم'))+'</button><button class="secondary" data-tt-extra-day>+ '+esc(tr('Add day','إضافة يوم'))+'</button><button class="primary" data-tt-new>+ '+esc(tr('Add class','إضافة حصة'))+'</button></div></section>'+
      summary()+
      '<div class="tt-desktop-only">'+desktopBoard()+'</div>'+
      '<div class="tt-mobile-only">'+mobileBoard()+'</div>';
  }

  function renderTimetable(){
    if(state.view!=='timetable'||!authUser||state.onboardingComplete!==true)return;
    const root=$('#view');if(!root)return;
    document.body.classList.add('app-ready');
    root.innerHTML=view();
    $$('[data-nav]').forEach(button=>button.classList.toggle('active',button.dataset.nav==='timetable'));
    bind();
    const targetId=new URLSearchParams((location.hash.split('?')[1]||'')).get('entry');
    if(targetId){
      const target=root.querySelector('[data-tt-edit="'+CSS.escape(String(targetId))+'"]');
      if(target){
        target.classList.add('notification-target-highlight');
        setTimeout(()=>target.scrollIntoView({behavior:'smooth',block:'center'}),60);
        setTimeout(()=>target.classList.remove('notification-target-highlight'),2800);
      }
    }
    if(typeof syncChrome==='function')syncChrome();
  }

  function extraDayPicker(){
    const visible=new Set(schoolDays());
    const available=[5,6].filter(day=>!visible.has(day));
    if(!available.length){toast(tr('Friday and Saturday are already available.','الجمعة والسبت مضافان بالفعل.'));return}
    openModal('<div class="modal-head"><div><p class="kicker"><i></i>'+esc(tr('Optional days','أيام اختيارية'))+'</p><h2>'+esc(tr('Add another day','إضافة يوم آخر'))+'</h2><p>'+esc(tr('Your timetable stays Sunday–Thursday by default. Add Friday or Saturday only when you need them.','جدولك يظل من الأحد إلى الخميس افتراضيًا. أضف الجمعة أو السبت فقط عند الحاجة.'))+'</p></div><button class="close" data-close>×</button></div><div class="tt-extra-day-options">'+available.map(day=>'<button type="button" class="secondary" data-tt-enable-day="'+day+'"><b>+ '+esc(dayName(day))+'</b><small>'+esc(tr('Add this day to my timetable','أضف هذا اليوم إلى جدولي'))+'</small></button>').join('')+'</div>');
    $$('[data-tt-enable-day]').forEach(button=>button.onclick=()=>{
      const day=Number(button.dataset.ttEnableDay);
      rememberExtraDay(day);
      tt.dayFilter=String(day);
      closeModal();
      renderTimetable();
      setTimeout(()=>editor(null,day),0);
    });
  }

  function editor(row=null,presetDay=null){
    const editing=!!row,day=editing?Number(row.day_of_week):(presetDay!=null?Number(presetDay):currentDay());
    const start=editing?String(row.start_time).slice(0,5):'08:00';
    const end=editing?String(row.end_time).slice(0,5):'09:00';
    const color=editing?row.color:palette[(rowsForDay(day).length)%palette.length];
    openModal('<div class="modal-head"><div><p class="kicker"><i></i>'+esc(tr(editing?'Edit timetable item':'New timetable item',editing?'تعديل عنصر الجدول':'عنصر جديد في الجدول'))+'</p><h2>'+esc(editing?tr('Edit class','تعديل الحصة'):tr('Add to your week','أضف لأسبوعك'))+'</h2><p>'+esc(tr('This is private and visible only to your account.','هذا خاص ولا يظهر إلا لحسابك.'))+'</p></div><button class="close" data-close>×</button></div>'+
      '<form id="ttForm">'+
      '<div class="row"><label class="field">'+esc(tr('Day','اليوم'))+'<select id="ttDay">'+days.map(d=>'<option value="'+d.id+'" '+(d.id===day?'selected':'')+'>'+esc(state.lang==='ar'?d.ar:d.en)+'</option>').join('')+'</select></label>'+
      '<label class="field">'+esc(tr('Type','النوع'))+'<select id="ttCategory">'+categories.map(v=>'<option value="'+esc(v)+'" '+((row?.category||'Class')===v?'selected':'')+'>'+esc(categoryLabel(v))+'</option>').join('')+'</select></label></div>'+
      '<label class="field">'+esc(tr('Class / activity name','اسم الحصة أو النشاط'))+'<input id="ttTitle" maxlength="100" required value="'+esc(row?.title||'')+'" placeholder="'+esc(tr('e.g. Physics L2','مثال: Physics L2'))+'"></label>'+
      '<div class="row"><label class="field">'+esc(tr('Starts','البداية'))+'<input id="ttStart" type="time" required value="'+esc(start)+'"></label><label class="field">'+esc(tr('Ends','النهاية'))+'<input id="ttEnd" type="time" required value="'+esc(end)+'"></label></div>'+
      '<label class="field">'+esc(tr('Room / place (optional)','المكان (اختياري)'))+'<input id="ttLocation" maxlength="120" value="'+esc(row?.location||'')+'" placeholder="'+esc(tr('Room 12, Lab, Online…','فصل 12، معمل، أونلاين…'))+'"></label>'+
      '<label class="field">'+esc(tr('Notes (optional)','ملاحظات (اختياري)'))+'<textarea id="ttNotes" rows="3" maxlength="1000" placeholder="'+esc(tr('Books, reminders, homework…','كتب، تذكيرات، واجب…'))+'">'+esc(row?.notes||'')+'</textarea></label>'+
      '<div class="row"><label class="field">'+esc(tr('Reminder','التذكير'))+'<select id="ttReminder"><option value="0" '+(row&&row.reminder_enabled===false?'selected':'')+'>'+esc(tr('Off','إيقاف'))+'</option>'+[5,10,15,30,60].map(v=>'<option value="'+v+'" '+((row?.reminder_enabled!==false&&Number(row?.reminder_minutes||15)===v)?'selected':'')+'>'+esc(v+' '+tr('minutes before','دقيقة قبل'))+'</option>').join('')+'</select></label><div class="tt-reminder-note"><b>'+esc(tr('Device reminder','تذكير على الجهاز'))+'</b><span>'+esc(tr('Sent as a mobile/web notification — not email.','يُرسل كإشعار موبايل/ويب وليس بريدًا إلكترونيًا.'))+'</span></div></div>'+
      '<div class="tt-color-field"><span>'+esc(tr('Color','اللون'))+'</span><div class="tt-palette">'+palette.map(c=>'<button type="button" class="'+(c.toLowerCase()===String(color).toLowerCase()?'active':'')+'" data-tt-color="'+c+'" style="--swatch:'+c+'" aria-label="'+c+'"></button>').join('')+'<label class="tt-custom-color"><input id="ttColor" type="color" value="'+esc(color)+'"><span>'+esc(tr('Custom','مخصص'))+'</span></label></div></div>'+
      '<div class="modal-actions">'+(editing?'<button type="button" class="secondary danger" data-tt-delete="'+esc(row.id)+'">'+esc(tr('Delete','حذف'))+'</button><button type="button" class="secondary" data-tt-duplicate="'+esc(row.id)+'">'+esc(tr('Duplicate','نسخ'))+'</button>':'')+'<button type="button" class="secondary" data-close>'+esc(tr('Cancel','إلغاء'))+'</button><button class="primary" id="ttSave">'+esc(editing?tr('Save changes','حفظ التغييرات'):tr('Done','تم'))+'</button></div>'+
      '</form>',true);
    $('#modalRoot .modal')?.classList.add('tt-editor-modal');
    $('#ttForm').onsubmit=e=>saveEntry(e,row);
    $$('[data-tt-color]').forEach(btn=>btn.onclick=()=>{$$('[data-tt-color]').forEach(x=>x.classList.remove('active'));btn.classList.add('active');$('#ttColor').value=btn.dataset.ttColor});
    const picker=$('#ttColor');if(picker)picker.oninput=()=>$$('[data-tt-color]').forEach(x=>x.classList.toggle('active',x.dataset.ttColor.toLowerCase()===picker.value.toLowerCase()));
    $('[data-tt-delete]')?.addEventListener('click',()=>removeEntry(row.id));
    $('[data-tt-duplicate]')?.addEventListener('click',()=>duplicateEntry(row));
  }

  async function saveEntry(event,row){
    event.preventDefault();
    const button=$('#ttSave');if(button.disabled)return;
    const start=$('#ttStart').value,end=$('#ttEnd').value;
    if(!start||!end||minutes(end)<=minutes(start)){toast(tr('End time must be after start time.','يجب أن يكون وقت النهاية بعد البداية.'));return}
    const payload={
      user_id:authUser.id,
      day_of_week:Number($('#ttDay').value),
      title:clean($('#ttTitle').value),
      start_time:start,
      end_time:end,
      notes:clean($('#ttNotes').value),
      location:clean($('#ttLocation').value),
      category:categories.includes($('#ttCategory').value)?$('#ttCategory').value:'Class',
      color:$('#ttColor').value,
      reminder_enabled:Number($('#ttReminder').value)>0,
      reminder_minutes:Number($('#ttReminder').value)||15
    };
    if(!payload.title){toast(tr('Add a name first.','أضف اسمًا أولًا.'));return}
    if(payload.day_of_week===5||payload.day_of_week===6)rememberExtraDay(payload.day_of_week);
    button.disabled=true;
    const query=row
      ?sb.from('user_timetable_entries').update(payload).eq('id',row.id).eq('user_id',authUser.id).select('*').single()
      :sb.from('user_timetable_entries').insert(payload).select('*').single();
    const {data,error}=await query;
    if(error){button.disabled=false;toast(friendly(error));return}
    if(row)tt.rows=tt.rows.map(x=>same(x.id,row.id)?data:x);else tt.rows.push(data);
    tt.rows=sortRows(tt.rows);closeModal();renderTimetable();toast(row?tr('Timetable updated.','تم تحديث الجدول.'):tr('Added to your timetable.','تمت الإضافة إلى جدولك.'));
  }

  async function removeEntry(id){
    const row=tt.rows.find(x=>same(x.id,id));if(!row)return;
    if(!confirm(tr('Delete this timetable item?','حذف هذا العنصر من الجدول؟')))return;
    const {error}=await sb.from('user_timetable_entries').delete().eq('id',id).eq('user_id',authUser.id);
    if(error){toast(friendly(error));return}
    tt.rows=tt.rows.filter(x=>!same(x.id,id));closeModal();renderTimetable();toast(tr('Removed from timetable.','تم الحذف من الجدول.'));
  }

  async function duplicateEntry(row){
    const copy={user_id:authUser.id,day_of_week:row.day_of_week,title:row.title,start_time:String(row.start_time).slice(0,5),end_time:String(row.end_time).slice(0,5),notes:row.notes||'',location:row.location||'',category:row.category||'Class',color:row.color||palette[0],reminder_enabled:row.reminder_enabled!==false,reminder_minutes:Number(row.reminder_minutes||15)};
    const {data,error}=await sb.from('user_timetable_entries').insert(copy).select('*').single();
    if(error){toast(friendly(error));return}
    tt.rows=sortRows([...tt.rows,data]);closeModal();renderTimetable();toast(tr('Class duplicated.','تم نسخ الحصة.'));
  }

  function actions(id){
    const row=tt.rows.find(x=>same(x.id,id));if(!row)return;
    openModal('<div class="modal-head"><div><h2>'+esc(row.title)+'</h2><p>'+esc(dayName(row.day_of_week))+' · '+esc(fmtTime(row.start_time))+' – '+esc(fmtTime(row.end_time))+'</p></div><button class="close" data-close>×</button></div><div class="account-menu"><button class="account-row" data-tt-action-edit><span><b>'+esc(tr('Edit','تعديل'))+'</b><small>'+esc(tr('Change time, notes, color or details','غيّر الوقت أو الملاحظات أو اللون'))+'</small></span><b>→</b></button><button class="account-row" data-tt-action-copy><span><b>'+esc(tr('Duplicate','نسخ'))+'</b><small>'+esc(tr('Create another copy quickly','أنشئ نسخة أخرى بسرعة'))+'</small></span><b>⧉</b></button><button class="account-row danger" data-tt-action-delete><span><b>'+esc(tr('Delete','حذف'))+'</b></span><b>×</b></button></div>');
    $('[data-tt-action-edit]').onclick=()=>{closeModal();setTimeout(()=>editor(row),0)};
    $('[data-tt-action-copy]').onclick=()=>duplicateEntry(row);
    $('[data-tt-action-delete]').onclick=()=>removeEntry(row.id);
  }

  function bind(){
    $$('[data-tt-new]').forEach(b=>b.onclick=()=>editor());
    $$('[data-tt-extra-day]').forEach(b=>b.onclick=extraDayPicker);
    $$('[data-tt-add-day]').forEach(b=>b.onclick=()=>editor(null,Number(b.dataset.ttAddDay)));
    $$('[data-tt-edit]').forEach(card=>card.onclick=e=>{if(e.target.closest('[data-tt-menu]'))return;editor(tt.rows.find(x=>same(x.id,card.dataset.ttEdit)))});
    $$('[data-tt-menu]').forEach(b=>b.onclick=e=>{e.stopPropagation();actions(b.dataset.ttMenu)});
    $$('[data-tt-day]').forEach(b=>b.onclick=()=>{tt.dayFilter=b.dataset.ttDay;renderTimetable()});
    $('[data-tt-today]')?.addEventListener('click',()=>{tt.dayFilter=String(currentDay());renderTimetable();setTimeout(()=>document.querySelector('.tt-mobile-day,.tt-day.today')?.scrollIntoView({behavior:'smooth',block:'start'}),30)});
    $('[data-tt-retry]')?.addEventListener('click',load);
  }

  const previousRender=render;
  render=function(){
    if(state.view!=='timetable'){previousRender();return}
    if(!authUser||state.onboardingComplete!==true){previousRender();return}
    renderTimetable();
    if(!tt.ready&&!tt.loading)load();
  };
})();
