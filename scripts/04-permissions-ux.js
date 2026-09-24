/* NEIS Circle v5 — complete permissions UX, reliable filters/search, and polished active states. */
(function(){
const v5Ar=()=>state.lang==='ar';
const v5Text=(en,arabic)=>v5Ar()?arabic:en;
const normalizeSearch=value=>String(value||'').toLocaleLowerCase(state.lang==='ar'?'ar':'en').normalize('NFKD').replace(/[\u0640\u064b-\u065f\u0670]/g,'').trim();
const matchesSearch=(query,...values)=>!query||normalizeSearch(values.flat().join(' ')).includes(query);
const emptyState=(title,copy)=>`<div class="empty"><b>${title}</b><span>${copy}</span></div>`;

window.neisFriendlyError=function(error,action='complete this action'){
  const message=String(error?.message||error||'');
  if(/permission denied|row.level security|violates.*policy|42501|PGRST/i.test(message))return v5Text(`We could not ${action}. Please refresh and try again.`,`تعذر ${action==='load this content'?'تحميل المحتوى':'إكمال العملية'}. حدّث الصفحة وحاول مرة أخرى.`);
  if(/duplicate|23505/i.test(message))return v5Text('This item already exists.','هذا العنصر موجود بالفعل.');
  if(/foreign key|23503/i.test(message))return v5Text('This sample item cannot be changed.','لا يمكن تعديل هذا العنصر التجريبي.');
  if(/network|fetch|offline|timeout/i.test(message))return v5Text('Connection problem. Check your internet and try again.','مشكلة في الاتصال. تحقق من الإنترنت وحاول مرة أخرى.');
  return v5Text(`We could not ${action}. Please try again.`,`تعذر إكمال العملية. حاول مرة أخرى.`);
};
const v5Toast=toast;
toast=function(message){const raw=String(message?.message||message||'');v5Toast(/permission denied|row.level security|violates.*policy|42501|PGRST|foreign key/i.test(raw)?window.neisFriendlyError(message):raw)};

const v5LiveToggle=liveToggle;
liveToggle=async function(table,id,on){const post=state.posts.find(p=>String(p.id)===String(id));if(post&&!post.is_live)return;return v5LiveToggle(table,id,on)};

state.localReplies=load('neis-local-replies-v5',{});
comments=async function(id){
  const p=state.posts.find(x=>String(x.id)===String(id));if(!p)return;
  let replies=p.is_live?[]:(state.localReplies[id]||[]);
  if(p.is_live&&sb&&authUser){const {data,error}=await sb.from('comments').select('id,body,created_at,profiles!comments_author_id_fkey(full_name)').eq('post_id',id).order('created_at');if(error)toast(window.neisFriendlyError(error,'load this content'));else replies=data||[]}
  openModal(`<div class="modal-head"><div><h2>${v5Text('Discussion','النقاش')}</h2><p>${esc(p.title)}</p></div><button class="close" data-close>×</button></div><div class="feed">${replies.length?replies.map(r=>`<div class="person">${avatar({name:r.profiles?.full_name||r.name||state.profile.name})}<div><b>${esc(r.profiles?.full_name||r.name||state.profile.name)}</b><small>${esc(r.body)}</small></div></div>`).join(''):emptyState(v5Text('No replies yet','لا توجد ردود بعد'),v5Text('Start a useful discussion.','ابدأ نقاشًا مفيدًا.'))}</div><form id="commentForm" class="chat-form" style="margin:18px 0 0"><input id="commentInput" required placeholder="${v5Text('Add a useful reply…','أضف ردًا مفيدًا…')}"><button aria-label="${v5Text('Send reply','إرسال الرد')}">→</button></form>`);
  $('#commentForm').onsubmit=async e=>{e.preventDefault();const body=$('#commentInput').value.trim();if(!body)return;const send=$('#commentForm button');send.disabled=true;if(p.is_live){const {error}=await sb.from('comments').insert({post_id:id,author_id:authUser.id,body});if(error){toast(window.neisFriendlyError(error,'add your reply'));send.disabled=false;return}await loadLiveData()}else{state.localReplies[id]=[...(state.localReplies[id]||[]),{body,name:state.profile.name,created_at:new Date().toISOString()}];localStorage.setItem('neis-local-replies-v5',JSON.stringify(state.localReplies));p.comments=(p.comments||0)+1;save()}closeModal();render();toast(v5Text('Reply added.','تمت إضافة الرد.'))}
};

const v5Home=home;
home=function(){const original=state.posts;if(state.filter==='Latest')state.posts=[...original].sort((a,b)=>{const dates=(Date.parse(b.created_at||'')||0)-(Date.parse(a.created_at||'')||0);return dates||Number(b.id||0)-Number(a.id||0)});const html=v5Home();state.posts=original;return html};

discover=function(){
  const query=normalizeSearch(state.query),rawBase=state.members.length?state.members.map(m=>({name:m.full_name||'Student',initials:initials(m.full_name),color:'#7056d8',grade:m.grade||'Student',branch:m.branch||'NEIS',interests:(m.interests||[]).join(' · ')||'Learning · Community'})):seed.people.map((p,i)=>({...p,branch:i%2?'Sadat Branch':'Main Branch'})),seenPeople=new Set(),base=rawBase.filter(p=>{const key=normalizeSearch(`${p.name}|${p.grade}|${p.branch}`);if(seenPeople.has(key))return false;seenPeople.add(key);return true});
  let people=base.filter(p=>matchesSearch(query,p.name,p.grade,p.branch,p.interests));
  if(state.discoverFilter==='Grade 11')people=people.filter(p=>p.grade==='Grade 11');
  if(state.discoverFilter==='Same branch')people=people.filter(p=>p.branch===state.profile.branch);
  if(state.discoverFilter==='Programming')people=people.filter(p=>normalizeSearch(p.interests).includes('programming'));
  const filters=[['Recommended','مقترح'],['Grade 11','الصف 11'],['Same branch','نفس الفرع'],['Programming','البرمجة']];
  return `${pageTitle(v5Text('Discover people','اكتشف الطلاب'),v5Text('Find students by grade, branch, interests and skills.','ابحث حسب الصف والفرع والاهتمامات والمهارات.'))}<div class="tabs">${filters.map(([value,label])=>`<button class="${state.discoverFilter===value?'active':''}" data-discover-filter="${value}">${v5Text(value,label)}</button>`).join('')}</div>${query?`<p class="search-result-note">${v5Text('Results for','نتائج البحث عن')} <b>“${esc(state.query)}”</b> · ${people.length}</p>`:''}<div class="grid-3" style="margin-top:18px">${people.length?people.map(p=>`<article class="module-card">${avatar(p,true)}<h3>${esc(p.name)}</h3><div class="identity-line"><span class="post-kind">${esc(p.grade)}</span><span class="branch-tag">${esc(p.branch)}</span></div><p>${esc(p.interests)}</p><button class="primary" data-follow="${esc(p.name)}">${state.following.includes(p.name)?v5Text('Following ✓','تتم المتابعة ✓'):v5Text('Follow student','متابعة الطالب')}</button></article>`).join(''):emptyState(v5Text('No students match','لا يوجد طلاب مطابقون'),v5Text('Try another search or filter.','جرّب بحثًا أو فلترًا آخر.'))}</div>`
};

circles=function(){const query=normalizeSearch(state.query),items=seed.circles.filter(c=>matchesSearch(query,c.name,c.desc,c.code));return `${pageTitle(v5Text('Circles','المجتمعات'),v5Text('Small, focused spaces built around useful conversations.','مساحات مركزة لمحادثات مفيدة.'),`<button class="primary" data-action="new-circle">${v5Text('+ New circle','+ مجتمع جديد')}</button>`)}${query?`<p class="search-result-note">${items.length} ${v5Text('matching circles','مجتمعات مطابقة')}</p>`:''}<div class="grid-3">${items.length?items.map(c=>`<article class="module-card"><span class="module-icon" style="--tone:${c.color}20;color:${c.color}">${esc(c.code)}</span><h3>${esc(c.name)}</h3><p>${esc(c.desc)}</p><div class="module-meta"><span>${c.members.toLocaleString()} ${v5Text('members','عضو')}</span></div><button class="primary" data-join="${c.id}">${state.joined.includes(c.id)?v5Text('Joined ✓','منضم ✓'):v5Text('Join circle','انضم للمجتمع')}</button></article>`).join(''):emptyState(v5Text('No circles match','لا توجد مجتمعات مطابقة'),v5Text('Try a broader search.','جرّب بحثًا أوسع.'))}</div>`};

const opportunityDates={1:'2026-09-28',2:'2026-10-04',3:'2026-10-12',4:'2026-10-20'};
opportunities=function(){
  const query=normalizeSearch(state.query);let items=seed.opportunities.filter(o=>matchesSearch(query,o.title,o.type,o.detail,o.day,o.month));
  if(state.opportunityFilter==='Online')items=items.filter(o=>normalizeSearch(o.detail).includes('online'));
  if(state.opportunityFilter==='Competitions')items=items.filter(o=>o.type==='Competition');
  if(state.opportunityFilter==='Ending soon'){const now=new Date(),limit=new Date(now.getTime()+14*86400000);items=items.filter(o=>{const d=new Date(opportunityDates[o.id]);return d>=new Date(now.toDateString())&&d<=limit})}
  const filters=[['All','الكل'],['Ending soon','تنتهي قريبًا'],['Online','أونلاين'],['Competitions','مسابقات']];
  return `${pageTitle(v5Text('Opportunity board','لوحة الفرص'),v5Text('Competitions, workshops, volunteering and events worth your time.','مسابقات وورش وتطوع وفعاليات تستحق وقتك.'),`<button class="primary" data-action="new-opportunity">${v5Text('+ Share opportunity','+ أضف فرصة')}</button>`)}<div class="tabs">${filters.map(([value,label])=>`<button class="${state.opportunityFilter===value?'active':''}" data-opp-filter="${value}">${v5Text(value,label)}</button>`).join('')}</div><div class="feed" style="margin-top:18px">${items.length?items.map(o=>`<article class="opportunity"><time class="opp-date" datetime="${opportunityDates[o.id]}"><b>${o.day}</b><span>${o.month}</span></time><div><span class="post-kind" style="margin:0">${esc(o.type)}</span><h3>${esc(o.title)}</h3><p>${esc(o.detail)}</p></div><button class="round-btn ${state.rsvp.includes(o.id)?'active':''}" data-rsvp="${o.id}" aria-label="${state.rsvp.includes(o.id)?v5Text('Remove from saved','إزالة من المحفوظ'):v5Text('Save opportunity','حفظ الفرصة')}">${icon('save')}</button></article>`).join(''):emptyState(v5Text('No opportunities match','لا توجد فرص مطابقة'),v5Text('Change the filter or search phrase.','غيّر الفلتر أو عبارة البحث.'))}</div>`
};

gallery=function(){let items=state.gallery.filter(g=>g.approved||isMine(g)||state.isAdmin),query=normalizeSearch(state.query);if(state.galleryFilter==='Featured')items=items.filter(g=>g.featured);if(state.galleryFilter==='Mine')items=items.filter(isMine);items=items.filter(g=>matchesSearch(query,g.caption_en,g.caption_ar,g.tags,authorName(g.author)));return `${pageTitle(v5Text('Community gallery','معرض المجتمع'),v5Text('Projects, events, art and memorable moments—shared by students.','مشروعات وفعاليات وفنون ولحظات يشاركها الطلاب.'),`<button class="primary" data-action="new-gallery">${v5Text('+ Add to gallery','+ أضف للمعرض')}</button>`)}<div class="tabs">${[['All','الكل'],['Featured','المميز'],['Mine','مشاركاتي']].map(([value,label])=>`<button class="${state.galleryFilter===value?'active':''}" data-gallery-filter="${value}">${v5Text(value,label)}</button>`).join('')}</div><div class="gallery-grid" style="margin-top:18px">${items.length?items.map(galleryCard).join(''):emptyState(v5Text('No gallery items yet','لا توجد صور بعد'),v5Text('Share the first meaningful visual story.','شارك أول قصة بصرية مفيدة.'))}</div>`};

library=function(){const query=normalizeSearch(state.query),items=state.posts.filter(p=>state.saved.includes(p.id)&&matchesSearch(query,p.title,p.body,p.tags,p.user));return `${pageTitle(v5Text('Your library','مكتبتك'),v5Text('Everything useful you saved for later.','كل ما حفظته للرجوع إليه لاحقًا.'))}<div class="feed">${items.length?items.map(postCard).join(''):emptyState(v5Text('No saved items match','لا توجد عناصر محفوظة مطابقة'),v5Text('Save useful posts or try another search.','احفظ منشورات مفيدة أو جرّب بحثًا آخر.'))}</div>`};

const searchInput=$('#globalSearch');
if(searchInput)searchInput.setAttribute('aria-label',v5Text('Search this section','ابحث في هذا القسم'));
})();
