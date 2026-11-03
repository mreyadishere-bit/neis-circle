/* NEIS Play v1: isolated opt-in module; no existing navigation/render functions are replaced. */
(function(){
'use strict';
if(window.NEISPlay)return;
const S={open:false,tab:'home',room:null,events:[],seq:0,deck:null,cards:[],decks:[],daily:null,dailyResult:null,championships:[],myRooms:[],status:'',busy:false,selected:'',chessFactory:null,sketchPoints:null,originalView:null,timer:null,loadId:0};
const t=(en,ar)=>typeof state!=='undefined'&&state.lang==='ar'?ar:en;
const e=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const api=()=>typeof sb!=='undefined'?sb:null;
const who=()=>typeof authUser!=='undefined'?authUser?.id:null;
const root=()=>document.getElementById('neisPlayRoot');
const label=(game)=>({chess:t('Chess Arena','ساحة الشطرنج'),sketch:t('Sketch & Guess','ارسم وخمّن'),flashcards:t('Flashcard Battles','تحدي البطاقات')})[game]||game;
const error=err=>{S.status=String(err?.message||err||t('Something went wrong.','حدث خطأ.')).replace(/[_]/g,' ');render()};
function button(text,action,more=''){return '<button type="button" data-play="'+action+'" '+more+'>'+text+'</button>'}
async function request(q){if(!api()||!who())throw Error(t('Please sign in first.','سجّل الدخول أولاً.'));const res=await q;if(res.error)throw res.error;return res.data}
function roomLink(){return location.origin+location.pathname+'?play='+encodeURIComponent(S.room.code)}
function nav(){
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
function show(){if(!S.open)return;let r=root();if(!r){r=document.createElement('div');r.id='neisPlayRoot';r.className='neis-play-root';document.body.appendChild(r)}
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
 else if(S.tab==='decks')body=decksPage();
 else if(S.tab==='championships')body=championshipPage();
 else body=homePage();
 const tabs=['home','daily','decks','championships'].map((a,i)=>button([t('Games','الألعاب'),t('Daily Challenge','سؤال اليوم'),t('Flashcards','البطاقات'),t('Championships','البطولات')][i],a,'class="'+(S.tab===a&&!S.room?'active':'')+'"')).join('');
 el.innerHTML='<nav class="neis-play-tabs">'+tabs+'</nav>'+(S.status?'<div class="neis-play-alert" role="status">'+e(S.status)+'</div>':'')+body;
 if(S.room?.game==='sketch')setupCanvas();
}
function homePage(){
 const items=[['chess','♟',t('Chess Arena','ساحة الشطرنج'),t('Challenge a friend to a casual chess match.','تحدّ صديقك في مباراة شطرنج ودية.')],['sketch','✎',t('Sketch & Guess','ارسم وخمّن'),t('Draw with friends. Guess in the room chat.','ارسم مع أصدقائك وخمّن في دردشة الغرفة.')],['flashcards','▣',t('Flashcard Battles','تحدي البطاقات'),t('Review a shared deck in a multiplayer room.','راجع مجموعة بطاقات مع أصدقائك.')]];
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
function decksPage(){
 return '<section class="neis-play-section"><h2>'+t('Flashcard decks','مجموعات البطاقات')+'</h2><p>'+t('Create real study decks and use them in Flashcard Battles.','أنشئ بطاقات مذاكرة حقيقية واستخدمها في التحديات.')+'</p><form data-play-form="deck" class="neis-play-form"><label>'+t('Deck title','اسم المجموعة')+'<input name="title" minlength="3" maxlength="90" required placeholder="Physics — Electricity"></label><label>'+t('Subject','المادة')+'<input name="subject" maxlength="80"></label><button type="submit">'+t('Create deck','إنشاء مجموعة')+'</button></form></section><div class="neis-play-card-grid">'+(S.decks.length?S.decks.map(d=>'<article class="neis-play-card"><h3>'+e(d.title)+'</h3><p>'+e(d.subject)+'</p>'+button(t('View cards','عرض البطاقات'),'deck:'+e(d.id))+'</article>').join(''):'<p class="neis-play-muted">'+t('No decks have been created yet.','لم يتم إنشاء بطاقات بعد.')+'</p>')+'</div>'+(S.deck?'<section class="neis-play-section"><h3>'+e(S.deck.title)+'</h3><div class="neis-play-list">'+S.cards.map(c=>'<div class="neis-play-list-item"><div><strong>'+e(c.question)+'</strong><p>'+e(c.answer)+'</p></div></div>').join('')+'</div>'+(S.deck.owner_id===who()?'<form data-play-form="card" class="neis-play-form"><label>'+t('Question','السؤال')+'<input name="question" minlength="3" maxlength="300" required></label><label>'+t('Answer','الإجابة')+'<input name="answer" maxlength="300" required></label><button type="submit">'+t('Add card','إضافة بطاقة')+'</button></form>':'')+'</section>':'');
}
function championshipPage(){
 const circles=Array.isArray(state?.circleRows)?state.circleRows:[];
 const options=circles.map(c=>'<option value="'+e(c.id)+'">'+e(c.name)+'</option>').join('');
 return '<section class="neis-play-section"><h2>'+t('Circle Championships','بطولات المجتمعات')+'</h2><p>'+t('Create a real event, register Circle members, and organize matches. Automatic brackets are coming after game integrity checks.','أنشئ حدثًا وسجّل أعضاء المجتمع ونظّم المباريات. الجداول التلقائية بعد اختبارات النزاهة.')+'</p><form data-play-form="championship" class="neis-play-form"><label>'+t('Circle','المجتمع')+'<select name="circle" required>'+options+'</select></label><label>'+t('Event name','اسم البطولة')+'<input name="title" maxlength="100" minlength="3" required></label><label>'+t('Game','اللعبة')+'<select name="game"><option value="chess">Chess</option><option value="sketch">Sketch & Guess</option><option value="flashcards">Flashcards</option></select></label><label>'+t('Start time','وقت البداية')+'<input name="starts" type="datetime-local" required></label><button type="submit">'+t('Create championship (Circle moderators)','إنشاء بطولة (مشرفي المجتمع)')+'</button></form></section><div class="neis-play-list">'+(S.championships.length?S.championships.map(c=>'<article class="neis-play-list-item"><div><strong>'+e(c.title)+'</strong><p>'+e(label(c.game))+' · '+e(new Date(c.starts_at).toLocaleString())+'</p></div>'+button(t('Register','تسجيل'),'register:'+e(c.id))+'</article>').join(''):'<p class="neis-play-muted">'+t('No upcoming Circle championships.','لا توجد بطولات قادمة.')+'</p>')+'</div>';
}
function roomPage(){
 const r=S.room;
 const members=r.members||[];
 const host=r.creator_id===who();
 const header='<section class="neis-play-section"><div class="neis-play-room-top"><div><small>'+e(label(r.game))+'</small><h2>'+e(r.title||t('Friendly room','غرفة ودية'))+'</h2><p>'+t('Room code','رمز الغرفة')+': <strong>'+e(r.code)+'</strong> · '+members.length+'/'+(r.game==='chess'?'2':r.game==='sketch'?'12':'8')+' · '+e(r.status)+'</p></div><div>'+button(t('Copy invitation','نسخ الدعوة'),'invite')+button(t('Send in current chat','إرسال للدردشة الحالية'),'chatinvite')+button(t('Back to Play','العودة'),'leave')+'</div></div></section>';
 let game='';
 if(r.status==='waiting')game='<div class="neis-play-section"><h3>'+t('Waiting for players','في انتظار اللاعبين')+'</h3><p>'+members.map((m,i)=>e(m.id===who()?t('You','أنت'):t('Player','لاعب')+' '+(i+1))).join(' • ')+'</p>'+(host?button(t('Start game','ابدأ اللعبة'),'start','class="neis-play-primary"'):'<p>'+t('The host will start the game.','المضيف سيبدأ اللعبة.')+'</p>')+'</div>';
 else if(r.status==='finished')game='<section class="neis-play-section"><h3>'+t('Room finished','انتهت الغرفة')+'</h3></section>';
 else if(r.game==='chess')game=chessPage();
 else if(r.game==='sketch')game=sketchPage();
 else game=flashcardPage();
 return header+game+(r.status==='playing'&&host?'<div class="neis-play-section">'+button(t('End room','إنهاء الغرفة'),'end','class="neis-play-danger"')+'</div>':'');
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
  const [decks,daily,champ,rooms]=await Promise.all([
   request(db.from('neis_play_decks').select('id,owner_id,title,subject,created_at').order('created_at',{ascending:false}).limit(100)),
   request(db.from('neis_play_daily').select('day,question,options').lte('day',new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())).order('day',{ascending:false}).limit(1)),
   request(db.from('neis_play_championships').select('id,circle_id,title,game,starts_at,status').gte('starts_at',new Date().toISOString()).order('starts_at',{ascending:true}).limit(40)),
   request(db.rpc('neis_play_my_rooms'))
  ]);
  S.decks=decks||[];S.daily=daily?.[0]||null;S.championships=champ||[];S.myRooms=rooms||[];
  S.status='';render();
 }catch(err){error(err)}
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
   if(delta.length||r.status!==S.lastStatus||r.members.length!==S.lastMembers){S.lastStatus=r.status;S.lastMembers=r.members.length;render()}
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
 render();
}
async function open(){
 if(S.open)return;S.open=true;S.originalView=typeof state!=='undefined'?state.view:null;
 show();await fetchLists();
 const match=new URLSearchParams(location.search).get('play');
 if(match&&/^[A-F0-9]{16}$/.test(match)){try{const id=await request(api().rpc('neis_play_join_room',{p_code:match}));await openRoom(id)}catch(err){error(err)}}
}
function close(){
 S.open=false;clearInterval(S.timer);S.timer=null;S.room=null;S.events=[];S.seq=0;S.selected='';const r=root();if(r)r.remove();const u=new URL(location.href);if(u.searchParams.has('play')){u.searchParams.delete('play');history.replaceState(null,'',u.pathname+u.search+u.hash)}
}
async function join(code){const id=await request(api().rpc('neis_play_join_room',{p_code:String(code).trim()}));await openRoom(id)}
async function create(game){
 let title=label(game),settings={};
 if(game==='flashcards'){
  const choices=S.decks.filter(d=>d.owner_id===who());
  if(!choices.length)throw Error(t('Create your own flashcard deck first.','أنشئ مجموعة بطاقات خاصة بك أولاً.'));
  const choice=prompt(t('Enter the deck number:\n','اكتب رقم مجموعة البطاقات:\n')+choices.map((d,i)=>(i+1)+'. '+d.title).join('\n'),'1');
  if(!choice)return;const deck=choices[Number(choice)-1];if(!deck)throw Error(t('Invalid deck number.','رقم المجموعة غير صحيح.'));
  const cards=await request(api().from('neis_play_cards').select('id').eq('deck_id',deck.id).limit(1));
  if(!cards.length)throw Error(t('Add at least one card first.','أضف بطاقة واحدة على الأقل أولاً.'));
  settings={deck_id:deck.id};title=deck.title;
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
  if(a.startsWith('register:')){await request(api().rpc('neis_play_register_championship',{p_id:a.slice(9)}));S.status=t('Registration confirmed.','تم التسجيل.');render();return}
  if(a==='start'||a==='end')return await send(a,{});
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
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',nav,{once:true});else nav();
window.NEISPlay={open,close,get active(){return S.open}};
})();
