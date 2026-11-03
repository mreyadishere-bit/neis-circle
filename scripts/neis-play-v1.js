/* NEIS Play v1: isolated opt-in module; no existing navigation/render functions are replaced. */
(function(){
'use strict';
if(window.NEISPlay)return;
const S={open:false,tab:'home',room:null,events:[],seq:0,deck:null,cards:[],decks:[],quizzes:[],quiz:null,quizQuestions:[],quizPosition:0,quizFeedback:null,quizScore:0,quizImport:null,daily:null,dailyResult:null,championships:[],myRooms:[],status:'',busy:false,selected:'',chessFactory:null,sketchPoints:null,originalView:null,timer:null,loadId:0};
const t=(en,ar)=>typeof state!=='undefined'&&state.lang==='ar'?ar:en;
const e=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const api=()=>typeof sb!=='undefined'?sb:null;
const who=()=>typeof authUser!=='undefined'?authUser?.id:null;
const root=()=>document.getElementById('neisPlayRoot');
const label=(game)=>({chess:t('Chess Arena','ساحة الشطرنج'),sketch:t('Sketch & Guess','ارسم وخمّن'),flashcards:t('Flashcard Battles','تحدي البطاقات'),quiz:t('Quiz Clash','تحدي الأسئلة')})[game]||game;
const error=err=>{S.status=String(err?.message||err||t('Something went wrong.','حدث خطأ.')).replace(/[_]/g,' ');render()};
function button(text,action,more=''){return '<button type="button" data-play="'+action+'" '+more+'>'+text+'</button>'}
async function request(q){if(!api()||!who())throw Error(t('Please sign in first.','سجّل الدخول أولاً.'));const res=await q;if(res.error)throw res.error;return res.data}
function roomLink(){return location.origin+location.pathname+'?play='+encodeURIComponent(S.room.code)}
function installNavButtons(){
 if(document.querySelector('[data-neis-play-open]'))return;
 const rail=document.querySelector('.rail-nav');
 if(!rail)return;
 const btn=document.createElement('button');
 btn.type='button';btn.className='nav-btn';btn.dataset.neisPlayOpen='1';btn.title=t('NEIS Play','NEIS ألعاب');btn.setAttribute('aria-label',btn.title);
 btn.innerHTML='<span aria-hidden="true" style="font-size:20px;font-weight:700">♟</span>';
 const saved=rail.querySelector('[data-nav="library"]');
 if(saved)saved.insertAdjacentElement('afterend',btn);else rail.appendChild(btn);
 const mobile=document.querySelector('.bottom-nav');
 if(mobile&&!mobile.querySelector('[data-neis-play-open]')){
  const small=document.createElement('button');small.type='button';small.dataset.neisPlayOpen='1';small.title=t('NEIS Play','NEIS ألعاب');
  small.innerHTML='<span aria-hidden="true" style="font-size:20px">♟</span><span>'+t('Play','ألعاب')+'</span>';
  const more=mobile.querySelector('[data-mobile-more]');if(more)mobile.insertBefore(small,more);else mobile.appendChild(small);
 }
}
function attachActivityEntries(){
 const view=document.getElementById('view');if(!view)return;
 if(typeof state!=='undefined'&&state.view==='home'){
  const column=view.querySelector('.dashboard .main-column');
  if(column&&!column.querySelector('[data-neis-play-home]')){
   const card=document.createElement('section');
   card.className='neis-play-home-shortcut';card.dataset.neisPlayHome='1';
   card.innerHTML='<div><small>'+t('DAILY CHALLENGE','تحدي اليوم')+'</small><strong>'+t('A new question. A new challenge.','سؤال جديد وتحدٍ جديد.')+'</strong><p>'+t('Answer today’s question, or challenge a friend to a game.','أجب عن سؤال اليوم أو تحدَّ صديقًا في لعبة.')+'</p></div><button type="button" data-neis-play-open>'+t('Open Play','افتح الألعاب')+'</button>';
   column.prepend(card);
  }
 }
 for(const form of view.querySelectorAll('#liveChatForm,#circleChatForm')){
  if(form.querySelector('[data-neis-play-open]'))continue;
  const trigger=document.createElement('button');
  trigger.type='button';trigger.className='neis-play-chat-trigger';
  trigger.dataset.neisPlayOpen='1';
  trigger.setAttribute('aria-label',t('Invite friends to play','ادعُ الأصدقاء للعب'));
  trigger.title=t('Start a game','ابدأ لعبة');
  trigger.textContent='♟';
  const textarea=form.querySelector('textarea');
  if(textarea)form.insertBefore(trigger,textarea);else form.appendChild(trigger);
 }
}
function observeApp(){
 const view=document.getElementById('view');if(!view)return;
 attachActivityEntries();
 const observer=new MutationObserver(()=>{if(S.open&&!root())show();else if(!S.open)attachActivityEntries()});
 observer.observe(view,{childList:true,subtree:false});
}
function show(){if(!S.open)return;let r=root();if(!r){r=document.createElement('div');r.id='neisPlayRoot';r.className='neis-play-root';const view=document.getElementById('view');if(!view)throw Error('NEIS page container unavailable');view.replaceChildren(r)}
 r.innerHTML='<div class="neis-play-shell"><header class="neis-play-header"><div><small>NEIS CIRCLE</small><h2>NEIS Play</h2></div><div>'+button(t('Close','إغلاق'),'close','class="neis-play-quiet"')+'</div></header><main class="neis-play-content" id="neisPlayContent"></main></div>';
 render();
}
function render(){
 const el=document.getElementById('neisPlayContent');if(!el)return;
 let body='';
 if(!who()){
  body='<div class="neis-play-empty"><h3>'+t('Sign in to play','سجّل الدخول للعب')+'</h3><p>'+t('Play and compete with real NEIS Circle accounts.','العب وتنافس باستخدام حساب NEIS Circle حقيقي.')+'</p></div>';
 }else if(S.room){body=roomPage()}
 else if(S.tab==='daily')body=dailyPage();
 else if(S.tab==='decks')body=quizStudioPage();
 else if(S.tab==='solo')body=soloQuizPage();
 else if(S.tab==='championships')body=championshipPage();
 else body=homePage();
 const tabs=['home','daily','decks','championships'].map((a,i)=>button([t('Games','الألعاب'),t('Daily Challenge','سؤال اليوم'),t('Quiz Studio','استوديو الاختبارات'),t('Championships','البطولات')][i],a,'class="'+(S.tab===a&&!S.room?'active':'')+'"')).join('');
 el.innerHTML='<nav class="neis-play-tabs">'+tabs+'</nav>'+(S.status?'<div class="neis-play-alert" role="status">'+e(S.status)+'</div>':'')+body;
 if(S.room?.game==='sketch')setupCanvas();
}
function homePage(){
 const items=[['chess','♟',t('Chess Arena','ساحة الشطرنج'),t('Challenge a friend to a casual chess match.','تحدّ صديقك في مباراة شطرنج ودية.')],['sketch','✎',t('Sketch & Guess','ارسم وخمّن'),t('Draw with friends. Guess in the room chat.','ارسم مع أصدقائك وخمّن في دردشة الغرفة.')],['quiz','◎',t('Quiz Clash','تحدي الأسئلة'),t('Create quizzes, invite friends, and compete live.','أنشئ اختبارات وادعُ أصدقاءك للتنافس مباشرًة.')]];
 const cards=items.map(([kind,icon,title,desc])=>'<article class="neis-play-card"><div class="neis-play-symbol">'+icon+'</div><h3>'+title+'</h3><p>'+desc+'</p>'+button(t('Create room','إنشاء غرفة'),'create:'+kind)+'</article>').join('');
 return '<section class="neis-play-hero"><div><small>PLAY • LEARN • CONNECT</small><h1>'+t('Better together.','الأفضل معًا.')+'</h1><p>'+t('Real rooms. Real classmates. No paid subscriptions.','غرف حقيقية وطلاب حقيقيون بدون اشتراكات مدفوعة.')+'</p></div><div class="neis-play-hero-symbol">♟ ✎ ▣</div></section><div class="neis-play-card-grid">'+cards+'</div><section class="neis-play-section"><h3>'+t('Join a friend','انضم إلى صديق')+'</h3><form data-play-form="join" class="neis-play-form-inline"><input name="code" required maxlength="16" placeholder="'+t('Invitation code','رمز الدعوة')+'" autocomplete="off"><button type="submit">'+t('Join room','انضمام')+'</button></form></section><section class="neis-play-section"><h3>'+t('Your active rooms','غرفك النشطة')+'</h3><div class="neis-play-list">'+(S.myRooms.length?S.myRooms.map(r=>'<div class="neis-play-list-item"><span>'+e(label(r.game))+' · '+e(r.status)+'</span>'+button(t('Open','فتح'),'room:'+e(r.id))+'</div>').join(''):'<p class="neis-play-muted">'+t('No active rooms.','لا توجد غرف نشطة.')+'</p>')+'</div></section><p class="neis-play-note">'+t('Casual beta: competitive ratings and automatic anti-cheat results are not enabled.','نسخة تجريبية ودية: التصنيفات التنافسية ونتائج مكافحة الغش لم تُفعّل بعد.')+'</p>';
}
function dailyPage(){
 const d=S.daily;
 if(!d)return '<section class="neis-play-section"><h2>'+t('Question of the Day','سؤال اليوم')+'</h2><p>'+t('No approved daily question has been published.','لم يُنشر سؤال يومي معتمد بعد.')+'</p>'+button(t('Suggest a question','اقترح سؤالاً'),'suggest')+(typeof state!=='undefined'&&state.isAdmin?button(t('Publish a question','انشر سؤالاً'),'publish'):'')+'</section>';
 const options=Array.isArray(d.options)?d.options:[];
 const answered=S.dailyResult;
 return '<section class="neis-play-section"><small>'+e(d.day)+'</small><h2>'+t('Question of the Day','سؤال اليوم')+'</h2><h3>'+e(d.question)+'</h3><div class="neis-play-options">'+options.map((o,i)=>button(e(o)+(answered?' '+(answered.correct===i?'✓':''):'') ,'daily:'+i,'class="'+(answered?.chosen===i?'active':'')+'" '+(answered?'disabled':''))).join('')+'</div>'+(answered?'<p class="neis-play-result">'+(answered.is_correct?t('Correct answer!','إجابة صحيحة!'):t('Keep learning!','استمر في التعلم!'))+' '+e(answered.explanation||'')+'</p>':'')+button(t('Suggest a future question','اقترح سؤالاً جديدًا'),'suggest')+'</section>';
}
function quizStudioPage(){
 const quizzes=S.quizzes||[];
 const own=quizzes.filter(q=>q.owner_id===who());
 const detail=S.quiz;
 let detailHtml='';
 if(detail){
  detailHtml='<section class="neis-play-section"><div class="neis-play-room-top"><div><small class="neis-quiz-step">'+t('QUIZ EDITOR','محرر الاختبار')+'</small><h2>'+e(detail.title)+'</h2><p>'+e(S.quizQuestions.length)+' '+t('questions','أسئلة')+'</p></div>'+button(t('Practice solo','تدرب منفردًا'),'quiz-practice')+'</div>'+
   '<div class="neis-play-quiz-wizard"><div><h3>'+t('Add a question','أضف سؤالًا')+'</h3><form data-play-form="quiz-question" class="neis-play-form"><label>'+t('Question','السؤال')+'<textarea name="prompt" minlength="5" maxlength="600" required rows="2"></textarea></label>'+
   [0,1,2,3].map(i=>'<label>'+String.fromCharCode(65+i)+'<input name="option'+i+'" maxlength="200" required></label>').join('')+
   '<label>'+t('Correct answer','الإجابة الصحيحة')+'<select name="correct"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select></label><label>'+t('Explanation (optional)','الشرح اختياري')+'<textarea name="explanation" rows="2" maxlength="1000"></textarea></label><button type="submit">'+t('Add question','إضافة السؤال')+'</button></form></div>'+
   '<div><h3>'+t('Import or generate','استيراد أو إنشاء')+'</h3><div class="neis-quiz-import"><p>'+t('Upload an HTML/TXT AI summary, or paste notes. The text is read safely without executing HTML.','ارفع ملخص HTML أو TXT، أو الصق ملاحظاتك. لا يتم تشغيل أي كود HTML.')+'</p>'+
   '<form data-play-form="quiz-generate" class="neis-play-form"><label>'+t('Topic or study notes','الموضوع أو الملاحظات')+'<textarea name="notes" id="neisQuizNotes" rows="6" maxlength="18000" placeholder="Electricity: Ohm’s law, resistance, power..."></textarea></label><label>'+t('Optional HTML or TXT file','ملف HTML أو TXT اختياري')+'<input id="neisQuizFile" name="file" type="file" accept=".html,.htm,.txt,text/plain,text/html"></label><label>'+t('Number of questions','عدد الأسئلة')+'<select name="count"><option value="5">5</option><option value="10">10</option><option value="15">15</option></select></label><button type="submit">'+t('Generate questions with AI','إنشاء الأسئلة بالذكاء الاصطناعي')+'</button></form></div></div></div>'+
   (S.pendingQuizQuestions?.length?'<div class="neis-play-section neis-quiz-review"><h3>'+t('Review AI suggestions','راجع مقترحات الذكاء الاصطناعي')+'</h3><p>'+t('These questions are not saved yet. Review their accuracy before publishing.','هذه الأسئلة لم تُحفظ بعد. راجع دقتها قبل النشر.')+'</p>'+S.pendingQuizQuestions.map((q,i)=>'<div class="neis-play-list-item"><div><strong>'+(i+1)+'. '+e(q.prompt)+'</strong><p>'+q.options.map((o,j)=>String.fromCharCode(65+j)+'. '+e(o)+(j===q.correct_index?' ✓':'')).join(' · ')+'</p></div>'+button(t('Remove','حذف'),'quiz-remove:'+i)+'</div>').join('')+button(t('Save reviewed questions','حفظ الأسئلة بعد المراجعة'),'quiz-save-ai')+'</div>':'')+
   '<div class="neis-play-list">'+S.quizQuestions.map((q,i)=>'<div class="neis-play-list-item"><strong>'+(i+1)+'. '+e(q.prompt)+'</strong><span>'+e(q.options?.length||0)+' options</span></div>').join('')+'</div></section>';
 }
 return '<div class="neis-play-quiz-wizard"><section class="neis-play-section"><small class="neis-quiz-step">CREATE</small><h2>'+t('Quiz Studio','استوديو الاختبارات')+'</h2><p>'+t('Build a quiz from scratch, or turn your own notes into review questions. Every generated question is editable before you share it.','أنشئ اختبارًا يدويًا أو حوّل ملاحظاتك إلى أسئلة، مع مراجعتها قبل المشاركة.')+'</p><form data-play-form="quiz-new" class="neis-play-form"><label>'+t('Quiz title','عنوان الاختبار')+'<input name="title" minlength="3" maxlength="100" required placeholder="Physics • Chapter 3"></label><label>'+t('Subject','المادة')+'<input name="subject" maxlength="90"></label><button type="submit">'+t('Create quiz','إنشاء اختبار')+'</button></form></section><section class="neis-play-section"><small class="neis-quiz-step">YOUR LIBRARY</small><h3>'+t('My quizzes','اختباراتي')+'</h3><div class="neis-play-list">'+(own.length?own.map(q=>'<div class="neis-play-list-item"><span>'+e(q.title)+'</span>'+button(t('Edit','تعديل'),'quiz-open:'+e(q.id))+'</div>').join(''):'<p>'+t('No quizzes yet. Make your first one.','لا توجد اختبارات بعد.')+'</p>')+'</div></section></div>'+
 (detailHtml||'<section class="neis-play-section"><h3>'+t('Explore community quizzes','اختبارات المجتمع')+'</h3><div class="neis-play-list">'+quizzes.slice(0,25).map(q=>'<div class="neis-play-list-item"><span>'+e(q.title)+' · '+e(q.subject||'')+'</span>'+button(t('Practice','تدرب'),'quiz-open:'+e(q.id))+'</div>').join('')+'</div></section>');
}
function soloQuizPage(){
 const q=S.quizQuestions[S.quizPosition];
 const grade=S.quizFeedback;
 return '<section class="neis-play-section"><small class="neis-quiz-step">'+t('SOLO PRACTICE','تدريب فردي')+'</small><h2>'+e(S.quiz?.title||'Quiz')+'</h2><div class="neis-quiz-progress"><span style="width:'+Math.round(100*S.quizPosition/Math.max(1,S.quizQuestions.length))+'%"></span></div>'+
 (q?'<p class="neis-quiz-question">'+e(q.prompt)+'</p><div class="neis-quiz-option-grid">'+q.options.map((o,i)=>button(String.fromCharCode(65+i)+'. '+e(o),'solo-answer:'+i,'class="'+(grade?(grade.correct_index===i?'correct':grade.chosen===i?'wrong':''):'')+'" '+(grade?'disabled':''))).join('')+'</div>'+(grade?'<p>'+e(grade.is_correct?t('Correct!','إجابة صحيحة!'):t('Not quite.','ليست صحيحة.'))+' '+e(grade.explanation||'')+'</p>'+button(t('Next question','السؤال التالي'),'solo-next'):''):'<h3>'+t('Completed!','أكملت الاختبار!')+' '+S.quizScore+'/'+S.quizQuestions.length+'</h3>')+'</section>';
}
function quizBattlePage(){
 if(!S.quiz||!S.quizQuestions.length)return '<section class="neis-play-section"><h3>'+t('Quiz is unavailable','الاختبار غير متاح')+'</h3></section>';
 const answeredByMe=new Set(S.events.filter(x=>x.type==='answer'&&x.user_id===who()).map(x=>x.payload.card_id));
 const question=S.quizQuestions.find(q=>!answeredByMe.has(q.id));
 const current=S.quizQuestions.length-answeredByMe.size;
 return '<section class="neis-play-game-layout"><div class="neis-play-section"><small class="neis-quiz-step">'+t('LIVE QUIZ','اختبار مباشر')+'</small><h2>'+e(S.quiz.title)+'</h2><div class="neis-quiz-progress"><span style="width:'+Math.min(100,Math.max(0,100*(current-1)/S.quizQuestions.length))+'%"></span></div>'+(question?'<p class="neis-quiz-question">'+e(question.prompt)+'</p><div class="neis-quiz-option-grid">'+question.options.map((o,i)=>button(String.fromCharCode(65+i)+'. '+e(o),'quiz-answer:'+e(question.id)+':'+i)).join('')+'</div>':'<h3>'+t('All questions answered!','أجبت عن جميع الأسئلة!')+'</h3>')+'</div><div class="neis-play-section"><h3>'+t('Live standings','الترتيب المباشر')+'</h3><div class="neis-play-list">'+(S.quizScores||[]).map((a,i)=>'<div class="neis-play-list-item"><strong>'+(i+1)+'. '+(a.user_id===who()?t('You','أنت'):t('Player','لاعب'))+'</strong><span>'+a.correct+'/'+a.answered+'</span></div>').join('')+'</div><p class="neis-play-muted">'+t('Scores are verified on the server; each student can answer a question once.','النقاط معتمدة من الخادم، وكل طالب يجيب عن السؤال مرة واحدة فقط.')+'</p></div></section>';
}
function championshipPage(){
 const circles=Array.isArray(state?.circleRows)?state.circleRows:[];
 const options=circles.map(c=>'<option value="'+e(c.id)+'">'+e(c.name)+'</option>').join('');
 return '<section class="neis-play-section"><h2>'+t('Circle Championships','بطولات المجتمعات')+'</h2><p>'+t('Create a real event, register Circle members, and organize matches. Automatic brackets are coming after game integrity checks.','أنشئ حدثًا وسجّل أعضاء المجتمع ونظّم المباريات. الجداول التلقائية بعد اختبارات النزاهة.')+'</p><form data-play-form="championship" class="neis-play-form"><label>'+t('Circle','المجتمع')+'<select name="circle" required>'+options+'</select></label><label>'+t('Event name','اسم البطولة')+'<input name="title" maxlength="100" minlength="3" required></label><label>'+t('Game','اللعبة')+'<select name="game"><option value="chess">Chess</option><option value="sketch">Sketch & Guess</option><option value="flashcards">Flashcards</option></select></label><label>'+t('Start time','وقت البداية')+'<input name="starts" type="datetime-local" required></label><button type="submit">'+t('Create championship (Circle moderators)','إنشاء بطولة (مشرفي المجتمع)')+'</button></form></section><div class="neis-play-list">'+(S.championships.length?S.championships.map(c=>'<article class="neis-play-list-item"><div><strong>'+e(c.title)+'</strong><p>'+e(label(c.game))+' · '+e(new Date(c.starts_at).toLocaleString())+'</p></div>'+button(t('Register','تسجيل'),'register:'+e(c.id))+'</article>').join(''):'<p class="neis-play-muted">'+t('No upcoming Circle championships.','لا توجد بطولات قادمة.')+'</p>')+'</div>';
}
function invitationPanel(){
 const people=Array.isArray(state.follows)?state.follows:[];
 const mine=who();
 const outgoing=new Set(people.filter(x=>x.follower_id===mine&&x.status==='accepted').map(x=>x.following_id));
 const mutual=[...new Set(people.filter(x=>x.following_id===mine&&x.status==='accepted'&&outgoing.has(x.follower_id)).map(x=>x.follower_id))];
 const circles=(state.circleMembers||[]).filter(x=>x.user_id===mine&&x.status==='active').map(x=>state.circleRows?.find(c=>c.id===x.circle_id)).filter(Boolean);
 const contacts=mutual.map(id=>{const p=(state.members||[]).find(x=>x.id===id);return '<button type="button" data-play="invite-user:'+e(id)+'" class="neis-invite-choice"><span class="neis-invite-avatar">'+e((p?.full_name||'?').slice(0,1))+'</span><span>'+e(p?.full_name||p?.username||'Student')+'</span><small>Send invite</small></button>'}).join('');
 const groups=circles.map(c=>'<button type="button" class="neis-invite-choice" data-play="invite-circle:'+e(c.id)+'"><span class="neis-invite-avatar">◈</span><span>'+e(c.name)+'</span><small>Circle chat</small></button>').join('');
 return '<section class="neis-play-section neis-invite-panel"><div class="neis-play-invite-heading"><h3>'+t('Invite classmates','ادعُ زملاءك')+'</h3>'+button(t('Hide','إخفاء'),'hide-invite','class="neis-play-quiet"')+'</div><p>'+t('Choose a mutual connection or one of your Circles. Invitations are sent directly, not left as drafts.','اختر صديقًا متابعًا لك أو أحد مجتمعاتك. تُرسل الدعوات مباشرة وليس كمسودة.')+'</p><div class="neis-invite-groups"><div><h4>'+t('Mutual connections','الأصدقاء المتبادلون')+'</h4><div class="neis-invite-list">'+(contacts||'<small>'+t('No mutual connections yet.','لا توجد علاقات متبادلة بعد.')+'</small>')+'</div></div><div><h4>'+t('My Circles','مجتمعاتي')+'</h4><div class="neis-invite-list">'+(groups||'<small>'+t('Join a Circle first.','انضم لمجتمع أولاً.')+'</small>')+'</div></div></div></section>';
}
async function sendInvitation(kind,id){
 if(!S.room)throw Error('Room is not selected');
 const text=t('♟ NEIS Play invitation · ','♟ دعوة NEIS Play · ')+label(S.room.game)+'\n'+roomLink()+'\n'+t('Join using your NEIS Circle account.','انضم بحسابك على NEIS Circle.');
 if(kind==='circle'){
  const membership=(state.circleMembers||[]).find(m=>m.circle_id===id&&m.user_id===who()&&m.status==='active');
  if(!membership)throw Error(t('You must be a member of this Circle.','يجب أن تكون عضوًا في هذا المجتمع.'));
  await request(api().from('circle_messages').insert({circle_id:id,sender_id:who(),body:text}));
 }else{
  const follows=state.follows||[];
  if(!follows.some(f=>f.follower_id===who()&&f.following_id===id&&f.status==='accepted')||
     !follows.some(f=>f.follower_id===id&&f.following_id===who()&&f.status==='accepted'))throw Error(t('Only mutual connections can receive direct invitations.','الدعوات المباشرة للأصدقاء المتبادلين فقط.'));
  const conversation=await request(api().rpc('start_direct_conversation',{target_user:id}));
  await request(api().from('messages').insert({conversation_id:conversation,sender_id:who(),body:text}));
 }
 S.status=t('Invitation delivered.','تم إرسال الدعوة بنجاح.');S.invitesOpen=false;render();
}
function roomPage(){
 const r=S.room;
 const members=r.members||[];
 const host=r.creator_id===who();
 const header='<section class="neis-play-section"><div class="neis-play-room-top"><div><small>'+e(label(r.game))+'</small><h2>'+e(r.title||t('Friendly room','غرفة ودية'))+'</h2><p>'+t('Room code','رمز الغرفة')+': <strong>'+e(r.code)+'</strong> · '+members.length+'/'+(r.game==='chess'?'2':r.game==='sketch'?'12':'8')+' · '+e(r.status)+'</p></div><div>'+button(t('Copy invitation','نسخ الدعوة'),'invite')+button(t('Invite friends','دعوة الأصدقاء'),'show-invite')+button(t('Back to Play','العودة'),'leave')+'</div></div></section>';
 let game='';
 if(r.status==='waiting')game='<div class="neis-play-section"><h3>'+t('Waiting for players','في انتظار اللاعبين')+'</h3><p>'+members.map((m,i)=>e(m.id===who()?t('You','أنت'):t('Player','لاعب')+' '+(i+1))).join(' • ')+'</p>'+(host?button(t('Start game','ابدأ اللعبة'),'start','class="neis-play-primary"'):'<p>'+t('The host will start the game.','المضيف سيبدأ اللعبة.')+'</p>')+'</div>';
 else if(r.status==='finished')game='<section class="neis-play-section"><h3>'+t('Room finished','انتهت الغرفة')+'</h3></section>';
 else if(r.game==='chess')game=chessPage();
 else if(r.game==='sketch')game=sketchPage();
 else if(r.game==='quiz')game=quizBattlePage();
 else game=flashcardPage();
 return header+(S.invitesOpen?invitationPanel():'')+game+(r.status==='playing'&&host?'<div class="neis-play-section">'+button(t('End room','إنهاء الغرفة'),'end','class="neis-play-danger"')+'</div>':'');
}
function chessPage(){
 if(!S.chessFactory)return '<div class="neis-play-section"><p>'+t('Loading free chess rules engine…','تحميل محرك قواعد الشطرنج المجاني…')+'</p></div>';
 const chess=new S.chessFactory();
 try{for(const x of S.events.filter(x=>x.type==='move')){const u=x.payload.uci;const ok=chess.move({from:u.slice(0,2),to:u.slice(2,4),promotion:u[4]||'q'});if(!ok)throw Error('Invalid remote move')}}catch{return '<div class="neis-play-alert">'+t('Game history failed validation. Moves disabled to protect players.','تعذر التحقق من تاريخ النقلات. تم إيقاف اللعب لحماية اللاعبين.')+'</div>'}
 const team=(S.room.members||[]).findIndex(m=>m.id===who());
 const myTurn=(team===0&&chess.turn()==='w')||(team===1&&chess.turn()==='b');
 const rows=Array.from({length:8},(_,rank)=>Array.from({length:8},(_,file)=>({file,rank,sq:'abcdefgh'[file]+(8-rank)})));
 const symbols={k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟',K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙'};
 const targets=S.selected?chess.moves({square:S.selected,verbose:true}).map(x=>x.to):[];
 const board='<div class="neis-play-board">'+rows.flat().map(({file,rank,sq})=>{const piece=chess.get(sq);const name=piece?(piece.color==='w'?piece.type.toUpperCase():piece.type):'';return button(symbols[name]||'','sq:'+sq,'class="neis-play-square '+((rank+file)%2?'dark':'light')+(S.selected===sq?' selected':'')+(targets.includes(sq)?' target':'')+'" aria-label="'+sq+'" '+(!myTurn||chess.isGameOver()?'disabled':'') )}).join('')+'</div>';
 return '<section class="neis-play-game-layout"><div>'+board+'</div><div class="neis-play-section"><h3>'+t('Chess Arena','ساحة الشطرنج')+'</h3><p>'+e(chess.isCheckmate()?t('Checkmate','كش مات'):chess.isDraw()?t('Draw','تعادل'):chess.isCheck()?t('Check','كش'):myTurn?t('Your turn','دورك'):t('Opponent’s turn','دور المنافس'))+'</p><p>'+t('Move history','سجل النقلات')+': '+e(chess.history().join(' · '))+'</p><p class="neis-play-muted">'+t('Unranked: server checks identity and turns; formal anti-cheat certification is not yet enabled.','مباراة غير مصنفة: الخادم يتحقق من الهوية والدور، ولم يتم بعد اعتماد نظام مكافحة الغش.')+'</p></div></section>';
}
function sketchPage(){
 return '<section class="neis-play-game-layout"><div class="neis-play-section"><h3>'+t('Sketch & Guess','ارسم وخمّن')+'</h3><p>'+t('Draw on the canvas and send a guess below. Strokes sync as finished lines.','ارسم على اللوحة وأرسل تخمينك. تتم مزامنة الخطوط بعد انتهاء رسمها.')+'</p><canvas id="neisPlayCanvas" width="720" height="420" class="neis-play-canvas" aria-label="Shared drawing canvas"></canvas><p class="neis-play-muted">'+t('Drawing is currently open to room members. A private word/automatic-score host mode will follow.','الرسم متاح لأعضاء الغرفة حاليًا. نظام الكلمات السرية والنقاط التلقائية قيد التطوير.')+'</p></div><div class="neis-play-section"><h3>'+t('Room guesses','تخمينات الغرفة')+'</h3><div class="neis-play-guesses">'+S.events.filter(x=>x.type==='guess').slice(-20).map(x=>'<div>'+e(x.payload.text)+'</div>').join('')+'</div><form class="neis-play-form-inline" data-play-form="guess"><input name="guess" maxlength="80" required placeholder="'+t('Your guess','تخمينك')+'"><button type="submit">'+t('Send','إرسال')+'</button></form></div></section>';
}
function flashcardPage(){
 const deck=S.deck;
 if(!deck)return '<div class="neis-play-section"><p>'+t('This room has no accessible deck.','لا توجد مجموعة بطاقات متاحة.')+'</p></div>';
 const answers=S.events.filter(x=>x.type==='answer');
 const position=answers.length%Math.max(S.cards.length,1);
 const card=S.cards[position];
 return '<section class="neis-play-game-layout"><div class="neis-play-section"><h3>'+e(deck.title)+'</h3>'+(card?'<div class="neis-play-flashcard"><small>'+t('Card','بطاقة')+' '+(position+1)+'/'+S.cards.length+'</small><h2>'+e(card.question)+'</h2></div><form class="neis-play-form-inline" data-play-form="answer"><input name="answer" maxlength="300" placeholder="'+t('Your answer','إجابتك')+'" required><button type="submit">'+t('Submit','إرسال')+'</button></form>':'<p>'+t('The deck has no cards yet.','المجموعة لا تحتوي على بطاقات بعد.')+'</p>')+'</div><div class="neis-play-section"><h3>'+t('Practice progress','تقدم المراجعة')+'</h3><p>'+answers.length+' '+t('answers submitted','إجابات مُرسلة')+'</p><p>'+t('This is a collaborative practice room; competitive scoring is disabled until server-side answer evaluation is available.','هذه غرفة مراجعة جماعية، والتصنيف التنافسي غير مفعّل حتى تكتمل مراجعة الإجابات على الخادم.')+'</p></div></section>';
}
async function fetchLists(){
 try{
  const db=api();if(!db||!who())return;
  const [decks,daily,champ,rooms,quizzes]=await Promise.all([
   request(db.from('neis_play_decks').select('id,owner_id,title,subject,created_at').order('created_at',{ascending:false}).limit(100)),
   request(db.from('neis_play_daily').select('day,question,options').lte('day',new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())).order('day',{ascending:false}).limit(1)),
   request(db.from('neis_play_championships').select('id,circle_id,title,game,starts_at,status').gte('starts_at',new Date().toISOString()).order('starts_at',{ascending:true}).limit(40)),
   request(db.rpc('neis_play_my_rooms')),
   request(db.from('neis_quizzes').select('id,owner_id,title,subject,visibility,created_at').order('created_at',{ascending:false}).limit(100))
  ]);
  S.decks=decks||[];S.quizzes=quizzes||[];S.daily=daily?.[0]||null;S.championships=champ||[];S.myRooms=rooms||[];
  S.status='';render();
 }catch(err){error(err)}
}
async function loadQuiz(id){
 const existing=S.quizzes.find(q=>q.id===id);
 let quiz=existing;
 if(!quiz){const rows=await request(api().from('neis_quizzes').select('id,owner_id,title,subject').eq('id',id).limit(1));quiz=rows?.[0]}
 if(!quiz)throw Error(t('Quiz is not available.','الاختبار غير متاح.'));
 S.quiz=quiz;S.quizQuestions=await request(api().from('neis_quiz_questions').select('id,quiz_id,prompt,options,sort_order').eq('quiz_id',quiz.id).order('sort_order').limit(60));
 S.quizPosition=0;S.quizScore=0;S.quizFeedback=null;
}
async function quizGrading(question,choice){
 const result=await request(api().rpc('neis_quiz_grade',{p_question:question,p_choice:choice}));
 S.quizScore+=result.is_correct?1:0;S.quizFeedback=result;render();
}
async function openRoom(id){
 try{
  S.room=await request(api().rpc('neis_play_room_snapshot',{p_id:id,p_after:0}));
  S.events=S.room.events||[];S.seq=S.events.at(-1)?.id||0;S.tab='home';S.selected='';
  await prepareGame();render();schedule();
 }catch(err){error(err)}
}
async function prepareGame(){
 if(S.room?.game==='chess'){
  try{if(!S.chessFactory){const m=await import('https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm');S.chessFactory=m.Chess}}catch(err){S.status=t('The chess rules library could not load.','تعذر تحميل مكتبة قواعد الشطرنج.')}
 }
 if(S.room?.game==='flashcards'){
  const id=S.room.settings?.deck_id;
  S.deck=S.decks.find(d=>d.id===id)||null;
  if(id&&!S.deck){
   const rows=await request(api().from('neis_play_decks').select('id,owner_id,title,subject').eq('id',id).limit(1));
   S.deck=rows[0]||null;
  }
  if(id)S.cards=await request(api().from('neis_play_cards').select('id,deck_id,question,answer').eq('deck_id',id).order('created_at').limit(80));
 }
}
async function fetchQuizScores(){
 if(S.room?.game!=='quiz')return;
 try{S.quizScores=await request(api().rpc('neis_quiz_room_scores',{p_room:S.room.id}))}catch{S.quizScores=[]}
}
function schedule(){
 clearInterval(S.timer);if(!S.room)return;
 S.timer=setInterval(async()=>{
  if(!S.open||!S.room||document.visibilityState==='hidden')return;
  const id=S.room.id;
  try{
   const r=await request(api().rpc('neis_play_room_snapshot',{p_id:id,p_after:S.seq}));
   if(!S.room||S.room.id!==id)return;
   const delta=r.events||[];
   S.room={...r,events:[]};
   if(delta.length){S.events.push(...delta);S.seq=delta.at(-1).id;}
   if(delta.length||r.status!==S.lastStatus||r.members.length!==S.lastMembers){S.lastStatus=r.status;S.lastMembers=r.members.length;if(S.room?.game==='quiz'&&delta.length)await fetchQuizScores();render()}
  }catch(err){S.status=t('Room connection needs attention. Retry by reopening the room.','اتصال الغرفة يحتاج إعادة فتح.');render()}
 },4000);
}
function setupCanvas(){
 const canvas=document.getElementById('neisPlayCanvas');if(!canvas)return;
 const ctx=canvas.getContext('2d');
 ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#256da8';ctx.lineWidth=3;
 for(const stroke of S.events.filter(x=>x.type==='stroke')){
  const points=stroke.payload.points;if(!Array.isArray(points)||points.length<2||!points.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1)))continue;
  ctx.beginPath();points.forEach(([x,y],i)=>{if(i===0)ctx.moveTo(x*canvas.width,y*canvas.height);else ctx.lineTo(x*canvas.width,y*canvas.height)});ctx.stroke();
 }
 function point(ev){const rect=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(ev.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,(ev.clientY-rect.top)/rect.height))]}
 canvas.onpointerdown=ev=>{if(S.room?.status!=='playing')return;canvas.setPointerCapture(ev.pointerId);S.sketchPoints=[point(ev)]};
 canvas.onpointermove=ev=>{
  if(!S.sketchPoints)return;const pt=point(ev),prev=S.sketchPoints.at(-1);if(Math.hypot(pt[0]-prev[0],pt[1]-prev[1])<0.005)return;
  if(S.sketchPoints.length<119)S.sketchPoints.push(pt);
  ctx.beginPath();ctx.moveTo(prev[0]*canvas.width,prev[1]*canvas.height);ctx.lineTo(pt[0]*canvas.width,pt[1]*canvas.height);ctx.stroke();
 };
 canvas.onpointerup=async ev=>{
  const pts=S.sketchPoints;S.sketchPoints=null;if(!pts||pts.length<2)return;
  try{await send('stroke',{points:pts})}catch(err){error(err)}
 };
 canvas.onpointercancel=()=>{S.sketchPoints=null;render()};
}
async function send(type,payload){
 const id=S.room?.id;if(!id)return;
 await request(api().rpc('neis_play_send_event',{p_room:id,p_type:type,p_payload:payload}));
 await syncNow();
}
async function syncNow(){
 if(!S.room)return;
 const r=await request(api().rpc('neis_play_room_snapshot',{p_id:S.room.id,p_after:S.seq}));
 const delta=r.events||[];
 S.room={...r,events:[]};if(delta.length){S.events.push(...delta);S.seq=delta.at(-1).id}
 if(S.room.game==='quiz')await fetchQuizScores();render();
}
async function open(){
 if(S.open)return;S.open=true;S.originalView=typeof state!=='undefined'?state.view:null;
 show();await fetchLists();
 const match=new URLSearchParams(location.search).get('play');
 if(match&&/^[A-F0-9]{16}$/.test(match)){try{const id=await request(api().rpc('neis_play_join_room',{p_code:match}));await openRoom(id)}catch(err){error(err)}}
}
function close(){
 S.open=false;clearInterval(S.timer);S.timer=null;S.room=null;S.events=[];S.seq=0;S.selected='';const r=root();if(r)r.remove();if(typeof nav==='function')nav('home');const u=new URL(location.href);if(u.searchParams.has('play')){u.searchParams.delete('play');history.replaceState(null,'',u.pathname+u.search+u.hash)}
}
async function join(code){const id=await request(api().rpc('neis_play_join_room',{p_code:String(code).trim()}));await openRoom(id)}
async function create(game){
 let title=label(game),settings={};
 if(game==='quiz'){
  const candidates=S.quizzes.filter(q=>q.owner_id===who()||q.visibility==='public');
  if(!candidates.length){S.tab='decks';render();throw Error(t('Create a quiz first.','أنشئ اختبارًا أولاً.'))}
  const answer=prompt(t('Choose a quiz number:\n','اختر رقم الاختبار:\n')+candidates.map((x,i)=>(i+1)+'. '+x.title).join('\n'),'1');
  if(!answer)return;
  const quiz=candidates[Number(answer)-1];
  if(!quiz)throw Error(t('Invalid selection.','اختيار غير صحيح.'));
  await loadQuiz(quiz.id);
  if(!S.quizQuestions.length)throw Error(t('Add at least one question first.','أضف سؤالًا واحدًا على الأقل.'));
  title=quiz.title;settings={quiz_id:quiz.id};
 }
 const data=await request(api().rpc('neis_play_create_room',{p_game:game,p_title:title,p_settings:settings}));
 await openRoom(data[0].room_id);
}
async function chessSquare(sq){
 if(!S.chessFactory||!S.room)return;
 const chess=new S.chessFactory();
 try{for(const ev of S.events.filter(x=>x.type==='move')){const u=ev.payload.uci;chess.move({from:u.slice(0,2),to:u.slice(2,4),promotion:u[4]||'q'})}}catch{return}
 const index=S.room.members.findIndex(m=>m.id===who());
 if(index<0||(index===0&&chess.turn()!=='w')||(index===1&&chess.turn()!=='b'))return;
 if(!S.selected){if(chess.get(sq)?.color===chess.turn()){S.selected=sq;render()}return}
 const legal=chess.moves({square:S.selected,verbose:true}).find(m=>m.to===sq);
 if(!legal){S.selected=chess.get(sq)?.color===chess.turn()?sq:'';render();return}
 const uci=legal.from+legal.to+(legal.promotion||'');
 S.selected='';await send('move',{uci});
}
function copyInvite(){navigator.clipboard.writeText(roomLink()).then(()=>{S.status=t('Invitation copied.','تم نسخ الدعوة.');render()}).catch(()=>error(t('Could not copy invitation.','تعذر نسخ الدعوة.')))}
function currentChatInvite(){
 const link=roomLink();close();
 const field=document.querySelector('#circleChatInput')||document.querySelector('#liveChatInput');
 if(field){field.value=(field.value?field.value+'\n':'')+t('Join my NEIS Play game: ','انضم للعبتي في NEIS Play: ')+link;field.dispatchEvent(new Event('input',{bubbles:true}));field.focus();return}
 navigator.clipboard.writeText(link).then(()=>{if(typeof toast==='function')toast(t('Invitation copied. Paste it into a DM or Circle chat.','تم نسخ الدعوة. الصقها في الرسائل أو دردشة المجتمع.'))}).catch(()=>{});
}
async function action(a){
 S.status='';
 try{
  if(['home','daily','decks','championships'].includes(a)){S.room=null;clearInterval(S.timer);S.tab=a;S.selected='';render();return}
  if(a==='close'){close();return}
  if(a==='leave'){S.room=null;S.events=[];S.seq=0;clearInterval(S.timer);S.tab='home';render();await fetchLists();return}
  if(a.startsWith('create:'))return await create(a.slice(7));
  if(a.startsWith('room:'))return await openRoom(a.slice(5));
  if(a.startsWith('deck:')){
   const id=a.slice(5);S.deck=S.decks.find(x=>x.id===id)||null;
   S.cards=await request(api().from('neis_play_cards').select('id,deck_id,question,answer,created_at').eq('deck_id',id).order('created_at').limit(100));render();return;
  }
  if(a.startsWith('sq:'))return await chessSquare(a.slice(3));
  if(a.startsWith('daily:')){
   if(S.dailyResult)return;
   const choice=Number(a.slice(6));S.dailyResult=await request(api().rpc('neis_play_answer_daily',{p_day:S.daily.day,p_choice:choice}));render();return;
  }
  if(a.startsWith('quiz-remove:')){S.pendingQuizQuestions.splice(Number(a.slice(12)),1);render();return}
  if(a==='quiz-save-ai'){
   if(!S.quiz||S.quiz.owner_id!==who())throw Error(t('Quiz creator only.','صاحب الاختبار فقط.'));
   const pending=[...(S.pendingQuizQuestions||[])];
   for(const q of pending){
    await request(api().rpc('neis_quiz_add_question',{p_quiz:S.quiz.id,p_prompt:q.prompt,p_options:q.options,p_correct:q.correct_index,p_explanation:q.explanation||''}));
   }
   S.pendingQuizQuestions=[];await loadQuiz(S.quiz.id);
   S.status=t('Generated questions saved.','تم حفظ الأسئلة.');render();return;
  }
  if(a.startsWith('quiz-open:')){await loadQuiz(a.slice(10));S.tab='decks';render();return}
  if(a==='solo-next'){S.quizPosition++;S.quizFeedback=null;render();return}
  if(a.startsWith('solo-answer:')){const choice=Number(a.slice(12));const q=S.quizQuestions[S.quizPosition];if(!q||S.quizFeedback)return;const data=await request(api().rpc('neis_quiz_grade',{p_question:q.id,p_choice:choice}));S.quizFeedback={...data,chosen:choice};S.quizScore+=data.is_correct?1:0;render();return}
  if(a==='quiz-practice'){S.quizPosition=0;S.quizScore=0;S.quizFeedback=null;S.tab='solo';render();return}
  if(a.startsWith('quiz-answer:')){
   const parts=a.slice(12).split(':');const question=parts[0],choice=Number(parts[1]);
   if(S.room?.game==='quiz'){await send('answer',{card_id:question,choice});return}
   await quizGrading(question,choice);return;
  }
  if(a.startsWith('register:')){await request(api().rpc('neis_play_register_championship',{p_id:a.slice(9)}));S.status=t('Registration confirmed.','تم التسجيل.');render();return}
  if(a==='start'||a==='end')return await send(a,{});
  if(a==='show-invite'){S.invitesOpen=true;render();return}
  if(a==='hide-invite'){S.invitesOpen=false;render();return}
  if(a.startsWith('invite-user:')){await sendInvitation('dm',a.slice(12));return}
  if(a.startsWith('invite-circle:')){await sendInvitation('circle',a.slice(14));return}
  if(a==='invite'){copyInvite();return}
  if(a==='chatinvite'){currentChatInvite();return}
  if(a==='suggest'){
   const q=prompt(t('Your suggested daily question:','سؤالك المقترح:'));if(!q)return;
   await request(api().from('neis_play_daily_suggestions').insert({author_id:who(),question:q.trim()}));
   S.status=t('Your question was submitted for review.','أُرسل سؤالك للمراجعة.');render();return;
  }
  if(a==='publish'){
   if(!state.isAdmin)return;
   const day=prompt('Date (YYYY-MM-DD)',new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));if(!day)return;
   const question=prompt(t('Question:','السؤال:'));if(!question)return;
   const opts=[];for(let i=0;i<4;i++){const v=prompt('Option '+(i+1));if(!v)return;opts.push(v)}
   const correct=Number(prompt(t('Correct option 1–4:','رقم الإجابة الصحيحة 1–4:'),'1'))-1;
   const explanation=prompt(t('Explanation:','الشرح:'),'')||'';
   await request(api().rpc('neis_play_publish_daily',{p_day:day,p_question:question,p_options:opts,p_correct:correct,p_explanation:explanation}));
   await fetchLists();return;
  }
 }catch(err){error(err)}
}
async function form(form){
 try{
  const data=new FormData(form),kind=form.dataset.playForm;
  if(kind==='join'){await join(data.get('code'));return}
  if(kind==='deck'){
   const title=String(data.get('title')||'').trim(),subject=String(data.get('subject')||'').trim();
   await request(api().from('neis_play_decks').insert({owner_id:who(),title,subject}));S.status=t('Deck created.','تم إنشاء المجموعة.');await fetchLists();return;
  }
  if(kind==='card'){
   await request(api().from('neis_play_cards').insert({deck_id:S.deck.id,question:String(data.get('question')).trim(),answer:String(data.get('answer')).trim()}));
   S.cards=await request(api().from('neis_play_cards').select('id,deck_id,question,answer').eq('deck_id',S.deck.id).order('created_at').limit(100));render();return;
  }
  if(kind==='quiz-new'){
   const title=String(data.get('title')||'').trim();
   const subject=String(data.get('subject')||'').trim().slice(0,90);
   const created=await request(api().from('neis_quizzes').insert({owner_id:who(),title,subject}).select('id,owner_id,title,subject,visibility').single());
   S.quizzes.unshift(created);await loadQuiz(created.id);render();return;
  }
  if(kind==='quiz-question'){
   if(!S.quiz||S.quiz.owner_id!==who())throw Error(t('Only the quiz creator can edit it.','صاحب الاختبار فقط يمكنه التعديل.'));
   const opts=[0,1,2,3].map(i=>String(data.get('option'+i)||'').trim());
   await request(api().rpc('neis_quiz_add_question',{p_quiz:S.quiz.id,p_prompt:String(data.get('prompt')||'').trim(),p_options:opts,p_correct:Number(data.get('correct')),p_explanation:String(data.get('explanation')||'')}));
   await loadQuiz(S.quiz.id);S.status=t('Question added.','تمت إضافة السؤال.');render();return;
  }
  if(kind==='quiz-generate'){
   if(!S.quiz||S.quiz.owner_id!==who())throw Error(t('Only the quiz creator can generate questions.','صاحب الاختبار فقط يمكنه إنشاء الأسئلة.'));
   const upload=data.get('file');let notes=String(data.get('notes')||'').trim();
   if(upload&&upload.size){
    if(upload.size>300000)throw Error(t('Choose a file under 300 KB.','اختر ملفًا أصغر من 300 كيلوبايت.'));
    if(!/\.(txt|html|htm)$/i.test(upload.name))throw Error(t('Only TXT or HTML summaries are supported.','يُسمح بملفات TXT أو HTML فقط.'));
    const raw=await upload.text();
    const extracted=/\.html?$/i.test(upload.name)?new DOMParser().parseFromString(raw,'text/html').body.textContent:raw;
    notes=(notes+'\n'+(extracted||'')).trim().slice(0,18000);
   }
   if(notes.length<30)throw Error(t('Add at least 30 characters of topic or study notes.','أضف 30 حرفًا على الأقل من الملاحظات.'));
   const count=Math.min(15,Math.max(5,Number(data.get('count'))||5));
   S.status=t('Generating your questions…','جارٍ إنشاء أسئلتك…');render();
   const {data:result,error:failed}=await api().functions.invoke('neis-quiz-ai',{body:{notes,topic:S.quiz.subject||S.quiz.title,count}});
   if(failed||!Array.isArray(result?.questions))throw Error(t('AI generation is temporarily unavailable. You can add questions manually.','خدمة الذكاء الاصطناعي غير متاحة حاليًا. يمكنك إضافة الأسئلة يدويًا.'));
   S.pendingQuizQuestions=result.questions.slice(0,15).filter(q=>typeof q.prompt==='string'&&Array.isArray(q.options)&&q.options.length===4&&Number.isInteger(q.correct_index)&&q.correct_index>=0&&q.correct_index<4);
   if(!S.pendingQuizQuestions.length)throw Error(t('No valid questions were generated.','لم يتم إنشاء أسئلة صالحة.'));
   S.status=t('Review the generated questions before saving them.','راجع الأسئلة قبل حفظها.');render();return;
  }
  if(kind==='championship'){
   const id=await request(api().rpc('neis_play_create_championship',{p_circle:data.get('circle'),p_title:String(data.get('title')).trim(),p_game:data.get('game'),p_start:new Date(data.get('starts')).toISOString()}));
   S.status=t('Championship created.','تم إنشاء البطولة.');await fetchLists();return;
  }
  if(kind==='guess'){await send('guess',{text:String(data.get('guess')).trim()});return}
  if(kind==='answer'){
   const card=S.cards[S.events.filter(x=>x.type==='answer').length%S.cards.length];if(!card)return;
   await send('answer',{card_id:card.id,text:String(data.get('answer')).trim().slice(0,300)});return;
  }
 }catch(err){error(err)}
}
document.addEventListener('click',event=>{
 const ordinaryNav=event.target.closest('[data-nav]');
 if(S.open&&ordinaryNav&&!ordinaryNav.closest('#neisPlayRoot')){
   S.open=false;clearInterval(S.timer);S.timer=null;S.room=null;const r=root();if(r)r.remove();
 }
 const openBtn=event.target.closest('[data-neis-play-open]');
 if(openBtn){event.preventDefault();event.stopPropagation();open();return}
 const control=event.target.closest('#neisPlayRoot [data-play]');
 if(!control)return;event.preventDefault();if(S.busy)return;
 S.busy=true;Promise.resolve(action(control.dataset.play)).finally(()=>{S.busy=false});
},true);
document.addEventListener('submit',event=>{
 const form=event.target.closest('#neisPlayRoot [data-play-form]');
 if(!form)return;event.preventDefault();if(S.busy)return;S.busy=true;Promise.resolve(formHandler(form)).finally(()=>{S.busy=false});
},true);
async function formHandler(f){await form(f)}
document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&S.open&&!S.busy)close()});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{installNavButtons();observeApp()},{once:true});else{installNavButtons();observeApp()}
window.NEISPlay={open,close,get active(){return S.open}};
})();
