/* NEIS Game Hub v2 — external browser games and native NEIS Circle invitations.
   No embedded third-party iframes, accounts, game engines or polling loops. */
(()=>{
'use strict';
if(window.NEISPlayConnectors)return;
const SERVICES=[
 {id:'skribbl',name:'skribbl.io',category:'drawing',mark:'✎',art:'draw',colors:['#1b88aa','#06466a','#6be0cb'],home:'https://skribbl.io/',start:'https://skribbl.io/',access:'No account needed',tag:'Draw & guess',hint:'Create a Private Room, then copy the invitation link from skribbl.io.',hosts:['skribbl.io','www.skribbl.io']},
 {id:'lichess',name:'Lichess',category:'chess',mark:'♞',art:'chess',colors:['#24465f','#112337','#c6dca6'],home:'https://lichess.org/',start:'https://lichess.org/setup/friend',account:'https://lichess.org/signup',access:'Free · Guests welcome',tag:'Classic chess',hint:'Create a challenge for a friend and copy the game URL.',hosts:['lichess.org','www.lichess.org']},
 {id:'gartic',name:'Gartic Phone',category:'drawing',mark:'✦',art:'draw',colors:['#9d4c83','#4a2a66','#ffa6ce'],home:'https://garticphone.com/',start:'https://garticphone.com/',access:'Free guest play',tag:'Drawing chain',hint:'Start a room and copy its invitation link to share with your friends.',hosts:['garticphone.com','www.garticphone.com']},
 {id:'chesscom',name:'Chess.com',category:'chess',mark:'♟',art:'chess',colors:['#45713c','#203d2a','#d5e692'],home:'https://www.chess.com/',start:'https://www.chess.com/play/online/friend',account:'https://www.chess.com/register',access:'Free basic play',tag:'Challenge a friend',hint:'Choose Play a Friend and paste the challenge invitation URL, including link.chess.com links.',hosts:['chess.com','www.chess.com','link.chess.com','www.link.chess.com','play.chess.com']},
 {id:'codenames',name:'Codenames',category:'party',mark:'⌘',art:'secret',colors:['#c95b48','#622a3a','#ffd58e'],home:'https://codenames.game/',start:'https://codenames.game/',access:'Free · No account',tag:'Team word game',hint:'Enter a nickname, create a room, and share its room URL.',hosts:['codenames.game','www.codenames.game']},
 {id:'jklm',name:'BombParty',category:'party',mark:'✳',art:'word',colors:['#a64f58','#43244a','#ffd16c'],home:'https://jklm.fun/',start:'https://jklm.fun/',access:'Free browser play',tag:'Fast word game',hint:'Create a private BombParty room on JKLM.FUN and share its link.',hosts:['jklm.fun','www.jklm.fun']},
 {id:'makeitmeme',name:'Make it Meme',category:'party',mark:'☺',art:'meme',colors:['#dc8d3c','#87434c','#ffe5a0'],home:'https://makeitmeme.com/',start:'https://makeitmeme.com/',access:'Free · Guest play',tag:'Meme party',hint:'Select Private Game and copy the lobby invite link.',hosts:['makeitmeme.com','www.makeitmeme.com']},
 {id:'wayground',name:'Wayground',category:'quiz',mark:'?',art:'quiz',colors:['#654cc9','#2d2267','#e9b5ff'],home:'https://wayground.com/',start:'https://wayground.com/',join:'https://wayground.com/join',account:'https://wayground.com/',access:'Free features available',tag:'Class quizzes',hint:'Host a Wayground (Quizizz) game, then share its join link. A host account may be needed.',hosts:['wayground.com','www.wayground.com','quizizz.com','www.quizizz.com','joinmyquiz.com','www.joinmyquiz.com']},
 {id:'kahoot',name:'Kahoot!',category:'quiz',mark:'!',art:'quiz',colors:['#7851ae','#372277','#f4bbff'],home:'https://kahoot.com/',start:'https://create.kahoot.it/',join:'https://kahoot.it/',account:'https://create.kahoot.it/',access:'Free basic quizzes',tag:'Live quiz battle',hint:'Host a game and share its player join link. Players may also use a PIN at kahoot.it.',hosts:['kahoot.com','www.kahoot.com','create.kahoot.it','kahoot.it','www.kahoot.it']},
 {id:'spyfall',name:'Spyfall',category:'party',mark:'◈',art:'secret',colors:['#3b7298','#162d55','#94daf6'],home:'https://thespyfall.com/',start:'https://thespyfall.com/',access:'Free · No account',tag:'Find the spy',hint:'Choose Online Play, create a room and share its invitation link.',hosts:['thespyfall.com','www.thespyfall.com']},
 {id:'partyden',name:'PartyDen',category:'party',mark:'✹',art:'party',colors:['#5b6bbc','#2c386e','#bce7fe'],home:'https://partyden.app/',start:'https://partyden.app/',access:'Free · No signup',tag:'Dozens of party games',hint:'Create a party room, then share the invite link or room code.',hosts:['partyden.app','www.partyden.app']},
 {id:'bonk',name:'Bonk.io',category:'party',mark:'◎',art:'arcade',colors:['#127f93','#173b63','#9ff7fa'],home:'https://bonk.io/',start:'https://bonk.io/',access:'Free browser play',tag:'Physics arcade',hint:'Create or join a private game and share the room invitation.',hosts:['bonk.io','www.bonk.io']},
 {id:'endgame',name:'Endgame',category:'chess',mark:'♜',art:'chess',colors:['#425b87','#172b4b','#d2d5ff'],home:'https://endgame.ai/',start:'https://endgame.ai/',access:'Check available modes',tag:'Chess alternative',hint:'Open Endgame and share a game URL if its current mode supports invitations.',hosts:['endgame.ai','www.endgame.ai']}
];
const AR_GAME={
 skribbl:{access:'بدون حساب',tag:'رسم وتخمين',hint:'أنشئ غرفة خاصة على skribbl.io، ثم انسخ رابط دعوتها.'},
 lichess:{access:'مجاني · يمكن اللعب كضيف',tag:'شطرنج كلاسيكي',hint:'أنشئ تحديًا لصديقك على Lichess، ثم انسخ رابط المباراة.'},
 gartic:{access:'مجاني · يمكن اللعب كضيف',tag:'سلسلة رسومات',hint:'أنشئ غرفة على Gartic Phone، ثم انسخ رابط الدعوة وشاركه مع أصدقائك.'},
 chesscom:{access:'اللعب الأساسي مجاني',tag:'تحدَّ صديقًا',hint:'اختر اللعب مع صديق على Chess.com، ثم الصق رابط الدعوة. روابط link.chess.com مدعومة.'},
 codenames:{access:'مجاني · بدون حساب',tag:'لعبة كلمات جماعية',hint:'اختر اسمًا مستعارًا، وأنشئ غرفة، ثم شارك رابطها مع فريقك.'},
 jklm:{access:'لعب مجاني من المتصفح',tag:'تحدي كلمات سريع',hint:'أنشئ غرفة خاصة للعبة BombParty على JKLM.FUN، ثم انسخ رابطها.'},
 makeitmeme:{access:'مجاني · يمكن اللعب كضيف',tag:'مسابقة صور مضحكة',hint:'اختر إنشاء لعبة خاصة، ثم انسخ رابط دعوة الغرفة.'},
 wayground:{access:'تتوفر مزايا مجانية',tag:'اختبارات تعليمية',hint:'ابدأ اختبارًا على Wayground (Quizizz)، ثم شارك رابط الانضمام. قد يحتاج مُنشئ الاختبار إلى حساب.'},
 kahoot:{access:'تتوفر اختبارات مجانية',tag:'مسابقة مباشرة',hint:'ابدأ اختبارًا على Kahoot! وشارك رابط انضمام اللاعبين. يمكنهم أيضًا استخدام رمز PIN.'},
 spyfall:{access:'مجاني · بدون حساب',tag:'اكتشف الجاسوس',hint:'اختر اللعب عبر الإنترنت، وأنشئ غرفة، ثم شارك رابط دعوتها.'},
 partyden:{access:'مجاني · بدون تسجيل',tag:'ألعاب جماعية متنوعة',hint:'أنشئ غرفة للعب الجماعي، ثم شارك رابط الدعوة أو رمز الغرفة.'},
 bonk:{access:'لعب مجاني من المتصفح',tag:'لعبة حركة وفيزياء',hint:'أنشئ مباراة خاصة أو انضم إليها، ثم شارك رابط الدعوة.'},
 endgame:{access:'تحقق من أنماط اللعب المتاحة',tag:'شطرنج بطرق مختلفة',hint:'افتح Endgame وشارك رابط المباراة إذا كان نمط اللعب الحالي يدعم الدعوات.'}
};
const UI={open:false,selected:'skribbl',filter:'all',query:'',links:{},link:'',panel:'setup',notice:'',noticeType:'info',busy:false,selectedTargets:new Set(),cachedFollows:[],cachedCircles:[],cachedProfiles:[],recipientLoaded:false,recipientLoading:false,returnFocus:null};
const tr=(en,ar)=>typeof state!=='undefined'&&state.lang==='ar'?ar:en;
const app=()=>typeof state==='undefined'?{}:state;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const who=()=>typeof authUser!=='undefined'?authUser?.id:null;
const database=()=>typeof sb!=='undefined'?sb:null;
const byId=id=>SERVICES.find(s=>s.id===id);
const gameText=(svc,key)=>tr(svc[key],AR_GAME[svc.id]?.[key]||svc[key]);
const overlay=()=>document.getElementById('neisGamesOverlay');
const identity=x=>String(x??'');
function verify(raw,service){
 let url;
 try{url=new URL(String(raw||'').trim())}catch(_){throw Error(tr('Paste a full HTTPS invitation link first.','الصق رابط دعوة HTTPS كامل أولًا.'))}
 const hosts=service?.hosts||SERVICES.flatMap(s=>s.hosts);
 if(url.protocol!=='https:'||url.username||url.password||url.href.length>1800||!hosts.includes(url.hostname.toLowerCase())){
  throw Error(tr('This link does not belong to the selected game. Paste a secure invitation URL from its official site.','هذا الرابط ليس من موقع اللعبة المختارة. الصق رابط دعوة آمن من موقعها الرسمي.'));
 }
 return url.toString();
}
function activeLink(){return verify(UI.link,byId(UI.selected))}
function setNotice(message,type){
 UI.notice=message;UI.noticeType=type||'info';render();
}
function external(raw){
 const url=verify(raw);
 const win=window.innerWidth>760?window.open('','neis-game-provider','width=1080,height=780,scrollbars=yes,resizable=yes'):window.open('','_blank');
 if(!win){setNotice(tr('Your browser blocked the game window. Allow pop-ups for NEIS Circle and try again.','المتصفح منع فتح اللعبة. اسمح بالنوافذ المنبثقة لموقع NEIS Circle وحاول مجددًا.'),'error');return}
 try{win.opener=null}catch(_){}
 win.location.replace(url);
}
function connections(){
 const me=identity(who()),rels=[...(app().follows||[]),...UI.cachedFollows].filter(x=>x.status==='accepted');
 const ids=new Set();
 rels.forEach(r=>{if(identity(r.follower_id)===me&&identity(r.following_id)!==me)ids.add(identity(r.following_id));
  if(identity(r.following_id)===me&&identity(r.follower_id)!==me)ids.add(identity(r.follower_id))});
 const profiles=[...(app().members||[]),...UI.cachedProfiles];
 return [...ids].map(id=>profiles.find(p=>identity(p.id)===id)||{id,full_name:tr('NEIS student','طالب NEIS')}).sort((a,b)=>String(a.full_name||'').localeCompare(String(b.full_name||'')));
}
function circles(){
 const me=identity(who()),ids=new Set();
 [...(app().circleMembers||[]),...UI.cachedCircles].forEach(r=>{if(identity(r.user_id)===me&&r.status==='active')ids.add(identity(r.circle_id))});
 (app().circleRows||[]).forEach(c=>{if(identity(c.owner_id)===me)ids.add(identity(c.id))});
 const result=[...(app().circleRows||[]),...UI.cachedCircles.filter(r=>r.name)];
 return [...ids].map(id=>result.find(c=>identity(c.id)===id)).filter(Boolean);
}
async function loadRecipients(){
 const uid=who(),db=database();
 if(!uid||!db||UI.recipientLoading||UI.recipientLoaded)return;
 UI.recipientLoading=true;
 try{
  const [follows,members]=await Promise.all([
   db.from('follows').select('follower_id,following_id,status').or('follower_id.eq.'+uid+',following_id.eq.'+uid).eq('status','accepted'),
   db.from('circle_members').select('circle_id,user_id,status').eq('user_id',uid).eq('status','active')
  ]);
  if(!follows.error&&Array.isArray(follows.data))UI.cachedFollows=follows.data;
  if(!members.error&&Array.isArray(members.data))UI.cachedCircles=members.data;
  const ids=[...new Set(UI.cachedFollows.map(r=>identity(r.follower_id)===identity(uid)?r.following_id:r.follower_id))].filter(Boolean);
  const circleIds=[...new Set(UI.cachedCircles.map(r=>r.circle_id))].filter(Boolean);
  const [profiles,rooms]=await Promise.all([
   ids.length?db.from('profiles').select('id,full_name,username').in('id',ids):Promise.resolve({data:[]}),
   circleIds.length?db.from('circles').select('id,name,owner_id').in('id',circleIds):Promise.resolve({data:[]})
  ]);
  if(!profiles.error&&Array.isArray(profiles.data))UI.cachedProfiles=profiles.data;
  if(!rooms.error&&Array.isArray(rooms.data))UI.cachedCircles.push(...rooms.data);
  UI.recipientLoaded=true;
 }catch(err){console.warn('[NEIS Games] recipient refresh failed',err)}
 finally{UI.recipientLoading=false;if(UI.open)render()}
}
function invitationText(url){
 const svc=byId(UI.selected);
 return tr('🎮 Join me for ', '🎮 هيا نلعب ')+(svc?.name||'a game')+'\n'+url+'\n'+tr('Open the link to join the game.', 'افتح الرابط للانضمام إلى اللعبة.');
}
async function send(kind,id,url){
 const uid=who(),db=database();
 if(!uid||!db)throw Error(tr('Sign in to NEIS Circle to send invitations.','سجّل الدخول إلى NEIS Circle لإرسال الدعوات.'));
 const body=invitationText(url);
 if(kind==='circle'){
  if(!circles().some(c=>identity(c.id)===identity(id)))throw Error(tr('You are not a member of this Circle.','أنت لست عضوًا في هذا المجتمع.'));
  const r=await db.from('circle_messages').insert({circle_id:id,sender_id:uid,body});
  if(r.error)throw r.error;
 }else if(kind==='user'){
  if(!connections().some(p=>identity(p.id)===identity(id)))throw Error(tr('This account is not one of your connections.','هذا الحساب ليس من قائمة أصدقائك.'));
  const conversation=await db.rpc('start_direct_conversation',{target_user:id});
  if(conversation.error||!conversation.data)throw conversation.error||Error('Unable to open conversation');
  await db.rpc('restore_own_conversation',{conversation_id_input:conversation.data});
  const r=await db.from('messages').insert({conversation_id:conversation.data,sender_id:uid,body});
  if(r.error)throw r.error;
 }else throw Error('Unknown recipient');
}
const coverCache=new Map();
function cover(s,large){
 const key=s.id+':'+(large?'large':'card');
 const cached=coverCache.get(key);
 if(cached)return cached;
 const col=s.colors;
 const art={
  chess:'<g opacity=".24" transform="translate(232 32) rotate(-19 100 85)"><path fill="#fff" d="M0 0h236v160H0z"/>'+Array.from({length:20},(_,i)=>'<rect x="'+(i%5*47.2)+'" y="'+(Math.floor(i/5)*40)+'" width="47.2" height="40" fill="'+((i+Math.floor(i/5))%2?'#20364b':'#fff')+'"/>').join('')+'</g><text x="127" y="181" font-size="148" font-family="Georgia,serif" fill="#fff" opacity=".92">'+esc(s.mark)+'</text>',
  draw:'<circle cx="390" cy="34" r="90" fill="#fff" opacity=".08"/><path d="M200 130Q263 8 331 102T450 76" fill="none" stroke="'+col[2]+'" stroke-width="13" stroke-linecap="round"/><path d="M235 185l95-145 29 23-96 145z" fill="#fff" opacity=".78" transform="rotate(12 300 125)"/><path d="M119 92q-42-40 0-54t64 25" fill="none" stroke="#fff" opacity=".6" stroke-width="8" stroke-linecap="round"/><circle cx="412" cy="162" r="19" fill="'+col[2]+'"/><circle cx="89" cy="165" r="10" fill="#fff" opacity=".5"/>',
  quiz:'<g transform="rotate(-12 310 103)"><rect x="216" y="21" width="186" height="179" rx="20" fill="#fff" opacity=".24"/><rect x="235" y="43" width="146" height="136" rx="13" fill="#fff" opacity=".18"/><path d="M255 142h103M255 164h66" stroke="#fff" opacity=".62" stroke-width="9" stroke-linecap="round"/><text x="278" y="123" fill="#fff" font-size="77" font-weight="900" font-family="Arial,sans-serif">'+esc(s.mark)+'</text></g><circle cx="148" cy="65" r="24" fill="'+col[2]+'" opacity=".75"/>',
  secret:'<g transform="translate(234 22) rotate(-9 100 90)"><rect x="0" y="0" width="132" height="172" rx="16" fill="#fff" opacity=".82"/><rect x="13" y="13" width="106" height="146" rx="9" fill="'+col[1]+'" opacity=".75"/><path d="M67 37l31 36-31 36-31-36z" fill="'+col[2]+'"/><circle cx="67" cy="74" r="14" fill="#fff"/></g><g opacity=".65"><circle cx="405" cy="77" r="42" fill="none" stroke="#fff" stroke-width="8"/><path d="M437 110l26 27" stroke="#fff" stroke-width="12" stroke-linecap="round"/></g>',
  word:'<circle cx="346" cy="106" r="76" fill="#fff" opacity=".17"/><path d="M335 55q22 18 3 45t5 42" stroke="'+col[2]+'" stroke-width="19" fill="none" stroke-linecap="round"/><path d="M243 165h170" stroke="#fff" stroke-width="9" opacity=".72" stroke-linecap="round"/><circle cx="150" cy="69" r="26" fill="'+col[2]+'" opacity=".74"/>',
  meme:'<g transform="rotate(10 320 110)"><rect x="219" y="23" width="194" height="160" rx="19" fill="#fff" opacity=".82"/><circle cx="283" cy="82" r="12" fill="'+col[1]+'"/><circle cx="356" cy="82" r="12" fill="'+col[1]+'"/><path d="M265 112q52 58 107-3" stroke="'+col[1]+'" stroke-width="12" stroke-linecap="round" fill="none"/><rect x="244" y="160" width="141" height="9" rx="4" fill="'+col[1]+'" opacity=".4"/></g>',
  party:'<g transform="translate(238 26)"><rect x="12" y="20" width="121" height="133" rx="20" fill="#fff" opacity=".21" transform="rotate(-18 73 86)"/><rect x="102" y="0" width="124" height="146" rx="19" fill="#fff" opacity=".45" transform="rotate(14 162 74)"/><path d="M112 99l40-37 42 40" fill="none" stroke="'+col[2]+'" stroke-width="14" stroke-linecap="round"/><circle cx="78" cy="58" r="20" fill="'+col[2]+'"/><path d="M183 146l18-22 18 22" fill="none" stroke="#fff" stroke-width="10"/></g>',
  arcade:'<circle cx="339" cy="105" r="93" fill="none" stroke="#fff" opacity=".26" stroke-width="24"/><circle cx="339" cy="105" r="54" fill="none" stroke="'+col[2]+'" opacity=".85" stroke-width="21"/><circle cx="339" cy="105" r="19" fill="#fff"/><path d="M205 173l58-35M392 29l43-24" stroke="#fff" stroke-width="8" opacity=".65" stroke-linecap="round"/>'
 }[s.art]||'';
 const html='<div class="neis-connect-cover'+(large?' is-large':'')+'" style="--coverA:'+col[0]+';--coverB:'+col[1]+';--coverC:'+col[2]+'"><svg viewBox="0 0 480 210" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><path d="M0 0h480v210H0z" fill="transparent"/><path d="M0 159Q130 84 256 178T480 111" fill="none" stroke="#fff" stroke-width="60" opacity=".045"/><circle cx="44" cy="45" r="93" fill="#fff" opacity=".045"/>'+art+'</svg><span class="neis-connect-cover-mark">'+esc(s.mark)+'</span><span class="neis-connect-cover-glint"></span></div>';
 coverCache.set(key,html);
 return html;
}
function recipientRows(){
 const people=connections(),groups=circles(),query=UI.query.trim().toLowerCase();
 const match=x=>!query||String(x||'').toLowerCase().includes(query);
 const all=[
  ...people.filter(p=>match(p.full_name||p.username)).map(p=>({key:'user:'+p.id,name:p.full_name||p.username||tr('Student','طالب'),sub:'@'+(p.username||'student'),icon:(p.full_name||p.username||'?').slice(0,1)})),
  ...groups.filter(c=>match(c.name)).map(c=>({key:'circle:'+c.id,name:c.name,sub:tr('Circle group chat','شات المجتمع'),icon:'◈'}))
 ];
 const parts=[['user',tr('Connections','الأصدقاء')],['circle',tr('My Circles','مجتمعاتي')]];
 return '<div class="neis-connect-recipients">'+parts.map(([kind,title])=>{
  const rows=all.filter(x=>x.key.startsWith(kind+':'));
  return '<section class="neis-connect-recipient-group"><h5>'+title+' <span>'+rows.length+'</span></h5><div class="neis-connect-recipient-items">'+(rows.length?rows.map(r=>'<button type="button" class="neis-connect-recipient'+(UI.selectedTargets.has(r.key)?' is-selected':'')+'" data-game="toggle:'+esc(r.key)+'" aria-pressed="'+UI.selectedTargets.has(r.key)+'"><span class="neis-connect-avatar">'+esc(r.icon)+'</span><span class="neis-connect-recipient-name"><strong>'+esc(r.name)+'</strong><small>'+esc(r.sub)+'</small></span><span class="neis-connect-tick">'+(UI.selectedTargets.has(r.key)?'✓':'')+'</span></button>').join(''):'<p class="neis-connect-recipient-empty">'+(UI.recipientLoading?tr('Loading…','جارٍ التحميل…'):kind==='user'?tr('No connections found.','لا يوجد أصدقاء مطابقون.'):tr('No Circles found.','لا توجد مجتمعات مطابقة.'))+'</p>')+'</div></section>';
 }).join('')+'</div>';
}
function page(){
 const svc=byId(UI.selected)||SERVICES[0];
 const query=UI.query.trim().toLowerCase();
 const filtered=SERVICES.filter(s=>(UI.filter==='all'||s.category===UI.filter)&&(!query||[s.name,gameText(s,'tag'),s.category].some(x=>x.toLowerCase().includes(query))));
 const cards=filtered.map(s=>'<button type="button" class="neis-connect-card'+(svc.id===s.id?' is-active':'')+'" data-game="choose:'+s.id+'" aria-pressed="'+(svc.id===s.id)+'">'+cover(s,false)+'<span class="neis-connect-card-body"><span class="neis-connect-card-name">'+esc(s.name)+'</span><span class="neis-connect-card-caption">'+esc(gameText(s,'tag'))+'</span><span class="neis-connect-card-meta">'+esc(gameText(s,'access'))+'</span></span><span class="neis-connect-card-arrow" aria-hidden="true">↗</span></button>').join('');
 const filt=[['all',tr('All games','الكل')],['party',tr('Party','جماعية')],['chess',tr('Chess','شطرنج')],['drawing',tr('Drawing','رسم')],['quiz',tr('Quizzes','اختبارات')]].map(([k,n])=>'<button type="button" data-game="filter:'+k+'" class="'+(UI.filter===k?'active':'')+'" aria-pressed="'+(UI.filter===k)+'">'+n+'</button>').join('');
 const input='<div class="neis-connect-link-box"><label for="neisGameLink">'+tr('Room invitation link','رابط دعوة الغرفة')+'</label><div class="neis-connect-link-row"><input id="neisGameLink" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="'+tr('Paste your room link here…','الصق رابط الغرفة هنا…')+'" value="'+esc(UI.link)+'"><button type="button" class="neis-connect-inline-button" data-game="paste">'+tr('Paste','لصق')+'</button><button type="button" class="neis-connect-inline-button" data-game="copy">'+tr('Copy','نسخ')+'</button></div><p class="neis-connect-help">'+tr('Create a room on the official game site, copy its share link, and paste it above.','افتح موقع اللعبة، أنشئ غرفة، انسخ رابط مشاركتها والصقه هنا.')+'</p></div>';
 const panel=UI.panel==='share'?'<div class="neis-connect-share"><div class="neis-connect-share-top"><div><h4>'+tr('Who would you like to invite?','من تريد دعوته؟')+'</h4><p>'+tr('Select friends or Circles to share your game link.','اختر أصدقاءك أو مجتمعاتك لمشاركة رابط اللعبة.')+'</p></div><button type="button" class="neis-connect-text-button" data-game="back">'+tr('Back','رجوع')+'</button></div><input type="search" id="neisRecipientSearch" placeholder="'+tr('Search connections and Circles…','ابحث عن الأصدقاء والمجتمعات…')+'" value="'+esc(UI.query)+'" autocomplete="off">'+recipientRows()+'<button type="button" class="neis-connect-send" data-game="send" '+(UI.busy?'disabled':'')+'>'+ (UI.busy?tr('Sending…','جارٍ الإرسال…'):tr('Send invitation','إرسال الدعوة')+' · '+UI.selectedTargets.size)+'</button></div>':'<div class="neis-connect-steps"><div><b>01</b><span>'+tr('Open a room','افتح غرفة')+'</span></div><div><b>02</b><span>'+tr('Copy the invite link','انسخ رابط الدعوة')+'</span></div><div><b>03</b><span>'+tr('Invite friends here','ادعُ أصحابك هنا')+'</span></div></div>';
 return '<div class="neis-connect-backdrop" data-game="close"></div><section class="neis-connect-dialog" role="dialog" aria-modal="true" aria-labelledby="neisConnectTitle"><header class="neis-connect-header"><div class="neis-connect-header-copy"><span class="neis-connect-eyebrow">NEIS CIRCLE <span class="neis-connect-slash">/</span> PLAY</span><h2 id="neisConnectTitle">'+tr('Better games. Better together.','اللعب أحلى مع بعض.')+'</h2><p>'+tr('Choose a game, open a room on its official site, and invite your friends.','اختر لعبة، وأنشئ غرفة في موقعها الرسمي، ثم ادعُ أصدقاءك.')+'</p></div><div class="neis-connect-header-side"><span class="neis-connect-count">'+SERVICES.length+' '+tr('games','لعبة')+'</span><button type="button" class="neis-connect-dismiss" data-game="close" aria-label="'+tr('Close','إغلاق')+'">×</button></div></header>'+(UI.notice?'<div class="neis-connect-notice '+esc(UI.noticeType)+'" role="status"><span>'+esc(UI.notice)+'</span><button type="button" data-game="dismiss-notice" aria-label="'+tr('Dismiss','إخفاء')+'">×</button></div>':'')+'<div class="neis-connect-layout"><section class="neis-connect-list"><div class="neis-connect-list-heading"><div><h3>'+tr('Discover games','استكشف الألعاب')+'</h3><p>'+tr('No downloads. Just friends.','بدون تحميل، فقط اختر لعبة وادعُ أصدقاءك.')+'</p></div><span class="neis-connect-provider-note">↗ '+tr('Official sites','المواقع الأصلية')+'</span></div><nav class="neis-connect-filters" aria-label="'+tr('Game categories','تصنيفات الألعاب')+'">'+filt+'</nav><div class="neis-connect-cards">'+(cards||'<p class="neis-connect-empty">'+tr('No games found in this category.','لا توجد ألعاب في هذا القسم.')+'</p>')+'</div></section><aside class="neis-connect-selected"><div class="neis-connect-selected-cover">'+cover(svc,true)+'<span class="neis-connect-selected-tag">'+esc(gameText(svc,'tag'))+'</span></div><div class="neis-connect-selected-content"><div class="neis-connect-selected-heading"><div><small>'+tr('READY TO PLAY','جاهز للعب؟')+'</small><h3>'+esc(svc.name)+'</h3><p>'+esc(gameText(svc,'access'))+'</p></div></div><p class="neis-connect-instructions">'+esc(gameText(svc,'hint'))+'</p><div class="neis-connect-launch-actions"><button type="button" class="neis-connect-launch" data-game="start">'+tr('Create / open room','افتح أو أنشئ غرفة')+' <span>↗</span></button>'+(svc.join?'<button type="button" class="neis-connect-secondary" data-game="join">'+tr('Join','انضم')+'</button>':'')+'</div>'+(svc.account?'<button type="button" class="neis-connect-account" data-game="account">'+tr('Create or sign in to an account on the game site','أنشئ حسابًا أو سجّل الدخول عبر موقع اللعبة')+' ↗</button>':'')+input+'<button type="button" class="neis-connect-invite-main" data-game="invite">'+tr('Invite connections & Circles','ادعُ الأصدقاء والمجتمعات')+' <span>→</span></button>'+panel+'</div></aside></div><footer class="neis-connect-footer"><span class="neis-connect-footer-dot"></span>'+tr('Games run on their official sites. NEIS Circle only helps you share invites; no extra server load.','الألعاب بتشتغل على مواقعها الأصلية. NEIS Circle بيسهّل إرسال الدعوات فقط، بدون حمل إضافي على السيرفر.')+'</footer></section>';
}
function render(){
 if(!UI.open||!overlay())return;
 const root=overlay();
 root.setAttribute('lang',tr('en','ar'));
 root.setAttribute('dir',tr('ltr','rtl'));
 const pane=root.querySelector('.neis-connect-layout');
 const previousTop=pane?.scrollTop||0;
 const previousTargets=[...root.querySelectorAll('.neis-connect-recipient-items')].map(el=>el.scrollTop);
 root.innerHTML=page();
 const next=root.querySelector('.neis-connect-layout');
 if(next)next.scrollTop=previousTop;
 root.querySelectorAll('.neis-connect-recipient-items').forEach((el,i)=>{el.scrollTop=previousTargets[i]||0});
 const link=root.querySelector('#neisGameLink');
 if(link)link.addEventListener('input',evt=>{UI.link=evt.target.value;UI.links[UI.selected]=UI.link});
 const search=overlay().querySelector('#neisRecipientSearch');
 if(search)search.addEventListener('input',evt=>{
  UI.query=evt.target.value;
  const recipients=overlay()?.querySelector('.neis-connect-recipients');
  if(recipients){
   const positions=[...recipients.querySelectorAll('.neis-connect-recipient-items')].map(el=>el.scrollTop);
   recipients.outerHTML=recipientRows();
   overlay().querySelectorAll('.neis-connect-recipient-items').forEach((el,i)=>{el.scrollTop=positions[i]||0});
  }
 });
}
function close(){
 UI.open=false;UI.busy=false;overlay()?.remove();document.body.classList.remove('neis-games-open');
 if(UI.returnFocus?.isConnected)UI.returnFocus.focus({preventScroll:true});
}
function open(selected){
 if(selected&&byId(selected))UI.selected=selected;
 UI.link=UI.links[UI.selected]||'';
 UI.open=true;UI.notice='';UI.panel='setup';UI.query='';UI.selectedTargets.clear();
 UI.returnFocus=document.activeElement;
 if(!overlay()){const el=document.createElement('div');el.id='neisGamesOverlay';el.className='neis-games-overlay';document.body.append(el)}
 document.body.classList.add('neis-games-open');
 render();overlay()?.querySelector('.neis-connect-dismiss')?.focus({preventScroll:true});
}
function copyFallback(text){
 const ta=document.createElement('textarea');ta.value=text;ta.readOnly=true;ta.style.position='fixed';ta.style.opacity='0';
 document.body.append(ta);ta.select();const result=document.execCommand('copy');ta.remove();
 if(!result)throw Error(tr('Copy this link manually.','انسخ الرابط يدويًا.'));
}
async function action(value){
 if(value==='close'){close();return}
 if(value==='dismiss-notice'){UI.notice='';render();return}
 if(value.startsWith('filter:')){UI.filter=value.slice(7);render();return}
 if(value.startsWith('choose:')){
  if(!byId(value.slice(7)))return;
  UI.links[UI.selected]=UI.link;UI.selected=value.slice(7);UI.link=UI.links[UI.selected]||'';
  UI.panel='setup';UI.notice='';UI.query='';UI.selectedTargets.clear();render();
  return;
 }
 const svc=byId(UI.selected);
 if(!svc)return;
 if(value==='start'||value==='join'||value==='account'){
  const url=value==='start'?svc.start:value==='join'?svc.join:svc.account;
  if(url)external(url);return;
 }
 if(value==='back'){UI.panel='setup';UI.notice='';render();return}
 if(value==='invite'){
  UI.panel='share';UI.notice='';
  render();
  try{activeLink()}catch(err){
   setNotice(err.message,'error');
   overlay()?.querySelector('#neisGameLink')?.focus({preventScroll:true});
   return;
  }
  // A valid invite is required before requesting contact/profile data.
  void loadRecipients();
  return;
 }
 if(value==='paste'){
  if(!navigator.clipboard?.readText){setNotice(tr('Paste using Ctrl+V or by long-pressing the field.','الصق الرابط باستخدام Ctrl+V أو بالضغط المطوّل على الحقل.'),'info');return}
  try{UI.link=(await navigator.clipboard.readText()).trim();UI.links[UI.selected]=UI.link;render();overlay()?.querySelector('#neisGameLink')?.focus()}
  catch(_){setNotice(tr('Clipboard access was denied. Paste the link manually.','رفض المتصفح الوصول إلى الحافظة. الصق الرابط يدويًا.'),'info')}
  return;
 }
 if(value==='copy'){
  const link=activeLink();
  if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(link);else copyFallback(link);
  setNotice(tr('Invitation link copied.','تم نسخ رابط الدعوة.'),'success');return;
 }
 if(value.startsWith('toggle:')){
  const key=value.slice(7),isKnown=key.startsWith('user:')?connections().some(x=>key==='user:'+x.id):circles().some(x=>key==='circle:'+x.id);
  if(!isKnown)return;
  if(UI.selectedTargets.has(key))UI.selectedTargets.delete(key);else UI.selectedTargets.add(key);
  const chosen=UI.selectedTargets.has(key);
  const button=[...(overlay()?.querySelectorAll('.neis-connect-recipient')||[])].find(el=>el.dataset.game===value);
  if(button){
   button.classList.toggle('is-selected',chosen);button.setAttribute('aria-pressed',String(chosen));
   const mark=button.querySelector('.neis-connect-tick');if(mark)mark.textContent=chosen?'✓':'';
  }
  const sendButton=overlay()?.querySelector('[data-game="send"]');
  if(sendButton)sendButton.textContent=tr('Send invitation','إرسال الدعوة')+' · '+UI.selectedTargets.size;
  return;
 }
 if(value==='send'){
  if(UI.busy)return;
  let url;
  try{url=activeLink()}catch(err){setNotice(err.message,'error');overlay()?.querySelector('#neisGameLink')?.focus({preventScroll:true});return}
  if(!UI.selectedTargets.size){setNotice(tr('Select at least one connection or Circle to send to.','اختار صديق أو مجتمع واحد على الأقل لإرسال الدعوة.'),'info');return}
  if(!who()){setNotice(tr('Sign in to NEIS Circle first.','سجّل الدخول إلى NEIS Circle أولًا.'),'error');return}
  UI.busy=true;UI.notice='';render();
  const targets=[...UI.selectedTargets];
  let ok=0,failed=0;
  for(const entry of targets){
   const [kind,...idParts]=entry.split(':');
   try{await send(kind,idParts.join(':'),url);ok++}catch(err){failed++;console.warn('[NEIS Games] invite delivery failed',err)}
  }
  UI.busy=false;
  if(ok)UI.selectedTargets.clear();
  setNotice(failed?tr('Invitation sent to '+ok+' recipient(s); '+failed+' failed. Check chat permissions and try again.','أُرسلت الدعوة إلى '+ok+' من المستلمين، وتعذّر الإرسال إلى '+failed+'. تحقق من صلاحيات المحادثة وحاول مرة أخرى.'):tr('Invitation sent to '+ok+' recipient(s) in NEIS Circle chats.','أُرسلت الدعوة إلى '+ok+' من المستلمين عبر محادثات NEIS Circle.'),failed?'error':'success');
 }
}
/* Convert trusted NEIS game-invitation messages into clear chat action cards.
   The message itself stays a regular text message and uses existing chat storage.
   Never transform arbitrary user links or unknown hosts. */
function enhanceChatMessageText(el){
 if(!el||el.dataset.neisGameEnhanced||!el.closest('#chatFlow,#circleChatFlow'))return;
 const raw=String(el.textContent||'').trim();
 const m=/^🎮\s*(?:Join me for|Let['’]s play|هيا نلعب|يلا نلعب)\s+([^\r\n]+)\s*\r?\n\s*(https:\/\/[^\s]+)/i.exec(raw);
 if(!m)return;
 const svc=SERVICES.find(s=>s.name.toLowerCase()===m[1].trim().toLowerCase());
 if(!svc)return;
 let url;
 try{url=verify(m[2],svc)}catch(_){return}
 const link=document.createElement('a');
 link.className='neis-chat-game-card';
 link.href=url;
 link.target='_blank';
 link.rel='noopener noreferrer';
 link.referrerPolicy='no-referrer';
 link.setAttribute('dir',tr('ltr','rtl'));
 link.setAttribute('aria-label',tr('Open '+svc.name+' game','افتح لعبة '+svc.name));
 const icon=document.createElement('span');
 icon.className='neis-chat-game-art';
 icon.style.setProperty('--game-accent',svc.colors[0]);
 icon.textContent=svc.mark;
 const info=document.createElement('span');
 info.className='neis-chat-game-detail';
 const eyebrow=document.createElement('span');
 eyebrow.className='neis-chat-game-eyebrow';eyebrow.textContent=tr('GAME INVITATION','دعوة إلى لعبة');
 const title=document.createElement('strong');title.textContent=svc.name;
 const host=document.createElement('small');host.setAttribute('dir','ltr');host.textContent=new URL(url).hostname;
 info.append(eyebrow,title,host);
 const cta=document.createElement('span');
 cta.className='neis-chat-game-cta';cta.textContent=tr('Join game ↗','انضم للعبة ↗');
 link.append(icon,info,cta);
 const copy=document.createElement('button');
 copy.type='button';copy.className='neis-chat-game-copy';
 copy.setAttribute('aria-label',tr('Copy game link','نسخ رابط اللعبة'));
 copy.textContent=tr('Copy game link','نسخ رابط اللعبة');
 copy.addEventListener('click',async evt=>{
  evt.preventDefault();evt.stopPropagation();
  try{
   if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(url);
   else copyFallback(url);
   copy.textContent=tr('Copied!','تم النسخ!');
  }catch(_){copy.textContent=tr('Copy failed','تعذّر النسخ')}
 });
 el.dataset.neisGameEnhanced='1';
 el.dataset.neisGameRaw=raw;
 el.replaceChildren(link,copy);
}
function enhanceChatInvites(node){
 if(!node||node.nodeType!==1)return;
 if(node.matches?.('.message-text'))enhanceChatMessageText(node);
 node.querySelectorAll?.('.message-text').forEach(enhanceChatMessageText);
}
let legacyGamesCleaned=false;
function attach(){
 const rail=document.querySelector('.rail-nav');
 if(rail&&!rail.querySelector('[data-neis-connect-open]')){
  const btn=document.createElement('button');btn.type='button';btn.className='nav-btn';btn.dataset.neisConnectOpen='1';
  btn.setAttribute('aria-label',tr('Games','ألعاب'));btn.title=tr('Games','ألعاب');btn.innerHTML='<span aria-hidden="true" style="font-size:19px">♟</span>';
  const saved=rail.querySelector('[data-nav="library"]');if(saved)saved.insertAdjacentElement('afterend',btn);else rail.append(btn);
 }
 // Remove older misplaced Games buttons once; never rescan the entire document
 // during message changes or chat interactions.
 if(!legacyGamesCleaned){
  legacyGamesCleaned=true;
  for(const btn of document.querySelectorAll('button[data-neis-connect-open]')){
   if(!btn.closest('.rail-nav,#liveChatForm,#circleChatForm,#mobileNavRoot'))btn.remove();
  }
 }
 const railEntry=rail?.querySelector('[data-neis-connect-open]');
 if(railEntry){railEntry.title=tr('Games','الألعاب');railEntry.setAttribute('aria-label',tr('Games','الألعاب'))}
 const view=document.querySelector('#view');
 if(view)for(const form of view.querySelectorAll('#liveChatForm,#circleChatForm')){
  const existing=form.querySelector('[data-neis-connect-open]');
  if(existing){
   existing.title=tr('Invite friends to a game','دعوة الأصدقاء إلى لعبة');
   existing.setAttribute('aria-label',existing.title);
   const label=existing.querySelector('.neis-connect-chat-label');if(label)label.textContent=tr('Games','الألعاب');
   continue;
  }
  const btn=document.createElement('button');btn.type='button';btn.dataset.neisConnectOpen='1';btn.className='neis-play-chat-trigger';
  btn.setAttribute('aria-label',tr('Invite friends to a game','دعوة الأصدقاء إلى لعبة'));btn.title=tr('Invite friends to a game','دعوة الأصدقاء إلى لعبة');
  btn.className='neis-connect-chat-trigger';btn.innerHTML='<span aria-hidden="true">🎮</span><span class="neis-connect-chat-label">'+tr('Games','الألعاب')+'</span>';
  const textarea=form.querySelector('textarea');if(textarea)form.insertBefore(btn,textarea);else form.append(btn);
 }
}
document.addEventListener('click',evt=>{
 const trigger=evt.target.closest?.('[data-neis-connect-open]');
 if(trigger){
  evt.preventDefault();
  document.querySelector('#mobileNavRoot [data-mobile-close]')?.click();
  open();return;
 }
 const el=evt.target.closest?.('[data-game]');
 if(!el||!overlay()?.contains(el))return;
 evt.preventDefault();
 Promise.resolve(action(el.dataset.game)).catch(err=>setNotice(String(err?.message||err||tr('Action failed.','تعذّر تنفيذ الطلب.')),'error'));
});
document.addEventListener('keydown',evt=>{
 if(!UI.open)return;
 if(evt.key==='Escape'){evt.preventDefault();close();return}
 if(evt.key==='Tab'){
  const items=[...overlay().querySelectorAll('button:not([disabled]),input:not([disabled])')].filter(x=>x.offsetParent!==null);
  if(!items.length)return;
  const first=items[0],last=items[items.length-1];
  if(evt.shiftKey&&document.activeElement===first){evt.preventDefault();last.focus()}
  else if(!evt.shiftKey&&document.activeElement===last){evt.preventDefault();first.focus()}
 }
});
let observer=null;
let currentGameLanguage=null;
function updateLanguage(){
 const language=tr('en','ar');
 // Core applyPrefs() sets <html lang> and <html dir> on many renders.
 // Mutations with the same effective language must be constant-time.
 if(language===currentGameLanguage)return;
 currentGameLanguage=language;
 attach();
 for(const flow of [document.getElementById('chatFlow'),document.getElementById('circleChatFlow')]){
  if(!flow)continue;
  flow.querySelectorAll('.message-text[data-neis-game-enhanced="1"]').forEach(el=>{
   const original=el.dataset.neisGameRaw;
   if(!original)return;
   el.removeAttribute('data-neis-game-enhanced');
   el.textContent=original;
   enhanceChatMessageText(el);
  });
 }
 if(UI.open)render();
}
function initialize(){
 attach();
 currentGameLanguage=tr('en','ar');
 const langWatcher=new MutationObserver(updateLanguage);
 langWatcher.observe(document.documentElement,{attributes:true,attributeFilter:['lang','dir']});
 const view=document.getElementById('view');
 if(!view)return;
 // Visit only active chat containers; Home/feed/editor mutations need no work.
 for(const id of ['chatFlow','circleChatFlow']){
  const flow=document.getElementById(id);
  if(flow)enhanceChatInvites(flow);
 }
 if(observer)return;
 observer=new MutationObserver(records=>{
  let needsAttach=false;
  for(const record of records){
   for(const node of record.addedNodes){
    if(node.nodeType!==1)continue;
    // Check nearest chat flow first. Ignore ordinary DOM updates completely.
    if(node.matches?.('.message-text,.chat-message,#chatFlow,#circleChatFlow')||
       node.closest?.('#chatFlow,#circleChatFlow')){
     enhanceChatInvites(node);
     continue;
    }
    // A view replacement can contain a newly mounted chat with messages.
    const chat=node.matches?.('#chatFlow,#circleChatFlow')?node:
      node.querySelector?.('#chatFlow,#circleChatFlow');
    if(chat)enhanceChatInvites(chat);
    if(!needsAttach&&(node.matches?.('#liveChatForm,#circleChatForm')||
       node.querySelector?.('#liveChatForm,#circleChatForm')))needsAttach=true;
   }
  }
  if(needsAttach)attach();
 });
 observer.observe(view,{childList:true,subtree:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
window.NEISPlayConnectors={open,close,validateInvite:verify,providers:SERVICES.map(s=>({id:s.id,name:s.name,start:s.start})),version:'2.2'};
})();