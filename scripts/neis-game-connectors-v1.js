/* NEIS Play Connectors: external games, zero local game engines/polling. */
(()=>{
'use strict';
if(window.NEISPlayConnectors)return;
const SERVICES=[
 {id:'lichess',name:'Lichess',category:'chess',icon:'♞',color:'chess',home:'https://lichess.org/',start:'https://lichess.org/setup/friend',account:'https://lichess.org/signup',access:'Free; guest games available',hint:'Create a friend challenge on Lichess, copy its game link, and invite someone here.'},
 {id:'chesscom',name:'Chess.com',category:'chess',icon:'♟',color:'chess',home:'https://www.chess.com/',start:'https://www.chess.com/play/online/friend',account:'https://www.chess.com/register',access:'Free basic play; account may be needed',hint:'Choose Play a Friend on Chess.com, then share the challenge link.'},
 {id:'endgame',name:'Endgame',category:'chess',icon:'♜',color:'chess',home:'https://endgame.ai/',start:'https://endgame.ai/',account:'https://endgame.ai/',access:'Free play options',hint:'Create a game on Endgame and paste the resulting invite URL.'},
 {id:'skribbl',name:'skribbl.io',category:'drawing',icon:'✎',color:'draw',home:'https://skribbl.io/',start:'https://skribbl.io/',account:'',access:'No account required',hint:'Choose Create Private Room, copy its invite URL, then send it from NEIS Circle.'},
 {id:'gartic',name:'Gartic Phone',category:'drawing',icon:'✐',color:'draw',home:'https://garticphone.com/',start:'https://garticphone.com/',account:'',access:'Guest play',hint:'Create a room on Gartic Phone and copy the room invitation link.'},
 {id:'wayground',name:'Wayground (Quizizz)',category:'quiz',icon:'◈',color:'quiz',home:'https://wayground.com/',start:'https://wayground.com/',join:'https://wayground.com/join',account:'https://wayground.com/',access:'Free features; host sign-in may be required',hint:'Host your quiz on Wayground (formerly Quizizz), then copy its join link or send the join code.'},
 {id:'kahoot',name:'Kahoot!',category:'quiz',icon:'◎',color:'quiz',home:'https://kahoot.com/',start:'https://create.kahoot.it/',join:'https://kahoot.it/',account:'https://create.kahoot.it/',access:'Free basic quizzes; players can join as guests',hint:'Host a Kahoot, then share its join link or PIN.'}
];
const allowed=new Set(['lichess.org','chess.com','www.chess.com','endgame.ai','www.endgame.ai','skribbl.io','www.skribbl.io','garticphone.com','www.garticphone.com','wayground.com','www.wayground.com','quizizz.com','www.quizizz.com','joinmyquiz.com','www.joinmyquiz.com','kahoot.com','www.kahoot.com','create.kahoot.it','kahoot.it','www.kahoot.it']);
const stateUI={open:false,filter:'all',selected:null,link:'',panel:'catalog',notice:'',pending:false};
const lang=(a,b)=>typeof state!=='undefined'&&state.lang==='ar'?b:a;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const user=()=>typeof authUser!=='undefined'?authUser?.id:null;
const db=()=>typeof sb!=='undefined'?sb:null;
const byId=id=>SERVICES.find(s=>s.id===id);
function verify(raw){
 const u=new URL(String(raw||'').trim());
 if(u.protocol!=='https:'||u.username||u.password||!allowed.has(u.hostname.toLowerCase())||u.href.length>1800)throw Error(lang('Enter a valid HTTPS game invitation link from one of the listed platforms.','أدخل رابط دعوة HTTPS صحيح من إحدى منصات الألعاب المذكورة.'));
 return u.toString();
}
function external(url,mode='popup'){
 const safe=verify(url);
 if(mode==='popup'&&window.innerWidth>700){
  const popup=window.open(safe,'neis-game-'+(stateUI.selected||'external'),'popup=yes,width=1050,height=780,noopener,noreferrer');
  if(popup)return;
 }
 window.open(safe,'_blank','noopener,noreferrer');
}
function notice(message){stateUI.notice=message;render()}
function reset(){stateUI.open=false;stateUI.pending=false;document.querySelector('#neisGamesOverlay')?.remove();document.body.classList.remove('neis-games-open')}
function open(selected){
 if(selected&&byId(selected))stateUI.selected=selected;
 stateUI.open=true;stateUI.notice='';
 if(!document.querySelector('#neisGamesOverlay')){
  const overlay=document.createElement('div');overlay.id='neisGamesOverlay';overlay.className='neis-games-overlay';
  document.body.appendChild(overlay);
 }
 document.body.classList.add('neis-games-open');render();
}
function mutual(){
 const list=Array.isArray(state?.follows)?state.follows:[];
 const me=user();if(!me)return [];
 const outgoing=new Set(list.filter(r=>r.follower_id===me&&r.status==='accepted').map(r=>r.following_id));
 return [...new Set(list.filter(r=>r.following_id===me&&r.status==='accepted'&&outgoing.has(r.follower_id)).map(r=>r.follower_id))];
}
function circles(){
 const me=user();
 return (state?.circleMembers||[]).filter(r=>r.user_id===me&&r.status==='active')
 .map(r=>(state?.circleRows||[]).find(c=>c.id===r.circle_id)).filter(Boolean);
}
function invitationText(url){
 const svc=byId(stateUI.selected);
 return lang('🎮 Let’s play ', '🎮 يلا نلعب ')+(svc?.name||'online')+'\n'+url+'\n'+lang('Open the link to join. An account may be required by the game provider.','افتح الرابط للانضمام. قد تتطلب منصة اللعبة حسابًا.');
}
async function send(kind,id){
 if(!user()||!db())throw Error(lang('Please sign in to NEIS Circle first.','سجّل الدخول إلى NEIS Circle أولًا.'));
 const url=verify(stateUI.link),text=invitationText(url);
 if(kind==='circle'){
  if(!circles().some(c=>c.id===id))throw Error(lang('You are not an active member of that Circle.','أنت لست عضوًا نشطًا في المجتمع.'));
  const {error}=await db().from('circle_messages').insert({circle_id:id,sender_id:user(),body:text});
  if(error)throw error;
 }else if(kind==='user'){
  if(!mutual().includes(id))throw Error(lang('Only mutual connections can receive direct invites.','يمكن إرسال الدعوات المباشرة للأصدقاء المتبادلين فقط.'));
  const res=await db().rpc('start_direct_conversation',{target_user:id});
  if(res.error||!res.data)throw res.error||Error('Conversation unavailable');
  const msg=await db().from('messages').insert({conversation_id:res.data,sender_id:user(),body:text});
  if(msg.error)throw msg.error;
 }else throw Error('Invalid invitation target');
 notice(lang('Invitation sent successfully.','تم إرسال الدعوة بنجاح.'));
}
function page(){
 const svc=byId(stateUI.selected);
 const filtered=SERVICES.filter(s=>stateUI.filter==='all'||s.category===stateUI.filter);
 const cards=filtered.map(s=>'<article class="neis-connect-card"><div class="neis-connect-card-top"><span class="neis-connect-icon '+s.color+'">'+s.icon+'</span><div><h3>'+esc(s.name)+'</h3><small>'+esc(s.access)+'</small></div></div><p>'+esc(s.hint)+'</p><div class="neis-connect-card-actions"><button type="button" data-game="choose:'+s.id+'">'+lang('Play / invite','العب / ادعُ')+'</button></div></article>').join('');
 const contacts=mutual().map(id=>{const person=(state?.members||[]).find(p=>p.id===id);return '<button type="button" data-game="send-user:'+esc(id)+'"><span class="neis-connect-initial">'+esc((person?.full_name||person?.username||'?').slice(0,1))+'</span><span>'+esc(person?.full_name||person?.username||lang('Classmate','زميل'))+'</span><small>'+lang('Send','إرسال')+'</small></button>'}).join('');
 const groups=circles().map(c=>'<button type="button" data-game="send-circle:'+esc(c.id)+'"><span class="neis-connect-initial">◈</span><span>'+esc(c.name)+'</span><small>'+lang('Send','إرسال')+'</small></button>').join('');
 const selected=svc?'<section class="neis-connect-selected"><div class="neis-connect-selected-head"><span class="neis-connect-icon '+svc.color+'">'+svc.icon+'</span><div><span class="neis-connect-eyebrow">'+lang('Selected game','اللعبة المختارة')+'</span><h3>'+esc(svc.name)+'</h3><p>'+esc(svc.access)+'</p></div></div><p>'+esc(svc.hint)+'</p><div class="neis-connect-actions"><button type="button" data-game="start">'+lang('Open game','افتح اللعبة')+'</button>'+(svc.join?'<button type="button" class="outline" data-game="join">'+lang('Join a game','انضم للعبة')+'</button>':'')+(svc.account?'<button type="button" class="outline" data-game="account">'+lang('Create / sign in','إنشاء حساب / دخول')+'</button>':'')+'</div><label for="neisGameLink">'+lang('Invite link from the game provider','رابط الدعوة من منصة اللعبة')+'</label><div class="neis-connect-link-row"><input id="neisGameLink" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://..." value="'+esc(stateUI.link)+'"><button type="button" data-game="copy">'+lang('Copy','نسخ')+'</button></div><p class="neis-connect-footnote">'+lang('Create the game on its original website, then paste its invitation link here. We do not create third-party accounts or host the game ourselves.','أنشئ اللعبة على موقعها الأصلي، ثم الصق رابط الدعوة هنا. لا ننشئ حسابات لدى المنصة ولا نستضيف اللعبة على خوادمنا.')+'</p><div class="neis-connect-actions"><button type="button" data-game="invite">'+lang('Invite connections & Circles','دعوة الأصدقاء والمجتمعات')+'</button></div>'+(stateUI.panel==='invite'?'<div class="neis-connect-invite"><h4>'+lang('Send invitation directly','إرسال الدعوة مباشرة')+'</h4><div class="neis-connect-invite-columns"><section><h5>'+lang('Mutual connections','الأصدقاء المتبادلون')+'</h5><div class="neis-connect-targets">'+(contacts||'<p>'+lang('No mutual connections yet.','لا يوجد أصدقاء متبادلون بعد.')+'</p>')+'</div></section><section><h5>'+lang('My Circles','مجتمعاتي')+'</h5><div class="neis-connect-targets">'+(groups||'<p>'+lang('No joined Circles available.','لا توجد مجتمعات منضم إليها.')+'</p>')+'</div></section></div></div>':'')+'</section>':'<section class="neis-connect-guide"><span class="neis-connect-guide-icon">↗</span><h3>'+lang('Choose a game to get started','اختر لعبة للبدء')+'</h3><p>'+lang('Games open in a small separate window on desktop when allowed by your browser. On mobile they open in a tab.','تفتح الألعاب في نافذة مستقلة صغيرة على الكمبيوتر إذا سمح المتصفح، وفي تبويب على الهاتف.')+'</p></section>';
 return '<div class="neis-connect-backdrop" data-game="close"></div><section class="neis-connect-dialog" role="dialog" aria-modal="true" aria-labelledby="neisConnectTitle"><header><div><small>NEIS CIRCLE / PLAY</small><h2 id="neisConnectTitle">'+lang('Play together, anywhere.','العبوا مع بعض، من أي مكان.')+'</h2><p>'+lang('Choose an online game, open its official site, and invite your Circle.','اختار لعبة أونلاين، افتح موقعها الرسمي، وابعت دعوة لأصحابك.')+'</p></div><button type="button" class="neis-connect-dismiss" data-game="close" aria-label="'+lang('Close','إغلاق')+'">×</button></header>'+(stateUI.notice?'<div class="neis-connect-notice" role="status">'+esc(stateUI.notice)+'</div>':'')+'<div class="neis-connect-layout"><section class="neis-connect-list"><nav class="neis-connect-filters" aria-label="'+lang('Game categories','تصنيفات الألعاب')+'">'+[['all',lang('All','الكل')],['chess',lang('Chess','شطرنج')],['drawing',lang('Drawing','رسم')],['quiz',lang('Quizzes','كويزات')]].map(([k,n])=>'<button type="button" data-game="filter:'+k+'" class="'+(stateUI.filter===k?'active':'')+'">'+n+'</button>').join('')+'</nav><div class="neis-connect-cards">'+cards+'</div></section>'+selected+'</div><footer>'+lang('Games and accounts belong to their respective providers. No paid integration or server-side game engine is required.','الألعاب والحسابات تابعة لمنصاتها الأصلية، ولا تحتاج استضافة ألعاب أو اشتراكات إضافية من NEIS Circle.')+'</footer></section>';
}
function render(){
 if(!stateUI.open)return;
 const root=document.querySelector('#neisGamesOverlay');if(!root)return;
 root.innerHTML=page();
 root.querySelector('#neisGameLink')?.addEventListener('input',event=>{stateUI.link=event.target.value});
}
async function handleAction(action){
 if(action==='close'){reset();return}
 if(action.startsWith('filter:')){stateUI.filter=action.slice(7);render();return}
 if(action.startsWith('choose:')){stateUI.selected=action.slice(7);stateUI.link='';stateUI.panel='catalog';stateUI.notice='';render();return}
 const svc=byId(stateUI.selected);if(!svc)return;
 if(action==='start'||action==='join'||action==='account'){
  const url=action==='start'?svc.start:action==='join'?svc.join:svc.account;
  if(url)external(url);return;
 }
 if(action==='invite'){verify(stateUI.link);stateUI.panel=stateUI.panel==='invite'?'catalog':'invite';render();return}
 if(action==='copy'){const link=verify(stateUI.link);await navigator.clipboard.writeText(link);notice(lang('Link copied.','تم نسخ الرابط.'));return}
 if(action.startsWith('send-user:')||action.startsWith('send-circle:')){
  if(stateUI.pending)return;
  stateUI.pending=true;try{await send(action.startsWith('send-user:')?'user':'circle',action.split(':').slice(1).join(':'))}finally{stateUI.pending=false}
 }
}
function attach(){
 const rail=document.querySelector('.rail-nav');
 if(rail&&!rail.querySelector('[data-neis-connect-open]')){
  const btn=document.createElement('button');btn.type='button';btn.className='nav-btn';btn.dataset.neisConnectOpen='1';
  btn.setAttribute('aria-label','NEIS Games');btn.title='NEIS Games';btn.innerHTML='<span aria-hidden="true" style="font-size:19px">♟</span>';
  const saved=rail.querySelector('[data-nav="library"]');if(saved)saved.insertAdjacentElement('afterend',btn);else rail.append(btn);
 }
 const mobile=document.querySelector('.bottom-nav');
 if(mobile&&!mobile.querySelector('[data-neis-connect-open]')){
  const b=document.createElement('button');b.type='button';b.dataset.neisConnectOpen='1';b.title='NEIS Games';b.innerHTML='<span aria-hidden="true">♟</span><span>'+lang('Games','ألعاب')+'</span>';
  const more=mobile.querySelector('[data-mobile-more]');if(more)mobile.insertAdjacentElement('beforebegin',b);else mobile.append(b);
 }
 const view=document.querySelector('#view');
 if(view)for(const form of view.querySelectorAll('#liveChatForm,#circleChatForm')){
  if(form.querySelector('[data-neis-connect-open]'))continue;
  const b=document.createElement('button');b.type='button';b.dataset.neisConnectOpen='1';b.className='neis-play-chat-trigger';
  b.setAttribute('aria-label',lang('Invite to an online game','دعوة للعبة أونلاين'));b.textContent='♟';
  const textarea=form.querySelector('textarea');if(textarea)form.insertBefore(b,textarea);else form.append(b);
 }
}
document.addEventListener('click',event=>{
 const entry=event.target.closest?.('[data-neis-connect-open]');
 if(entry){event.preventDefault();open();return}
 const action=event.target.closest?.('[data-game]')?.dataset.game;
 if(!action)return;
 event.preventDefault();
 Promise.resolve(handleAction(action)).catch(err=>notice(String(err.message||err||lang('Could not complete this action.','تعذر إكمال العملية.'))));
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&stateUI.open)reset()});
let focusObserver=null;
function initialize(){
 attach();
 if(!focusObserver&&document.querySelector('#view')){
  focusObserver=new MutationObserver(()=>attach());
  focusObserver.observe(document.querySelector('#view'),{childList:true,subtree:false});
 }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
window.NEISPlayConnectors={open,close:reset,validateInvite:verify,providers:SERVICES.map(s=>({id:s.id,name:s.name,start:s.start}))};
})();