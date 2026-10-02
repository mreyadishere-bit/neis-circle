/* NEIS Circle v4 — authenticated entry, onboarding, complete UI language and reliable publishing. */
(function(){
const authRoot=document.getElementById('authRoot');
let authMode='signin';
state.onboardingComplete=null;
const ar=()=>state.lang==='ar';
const bi=(en,arabic)=>ar()?arabic:en;
const NEIS_BRANCHES=Object.freeze([
  'El-Obour','El-Shorouk','Al-Andalus','Al-Yasmine','6th of October','Sheikh Zayed','El-Sadat','Port Said','New Damietta','Minya','New Assiut','Qena','New Tiba – Luxor','New Aswan','10th of Ramadan','New Administrative Capital','Suez','Sharm El-Sheikh','Luxor'
]);
window.NEIS_BRANCHES=NEIS_BRANCHES;
const LEGACY_BRANCH_NAMES=Object.freeze({
  'Sadat Branch':'El-Sadat','Sadat':'El-Sadat','El Sadat':'El-Sadat','El-Sadat Branch':'El-Sadat',
  'El Shorouk Branch':'El-Shorouk','El Shorouk':'El-Shorouk','El-Shorouk Branch':'El-Shorouk',
  'El Obour Branch':'El-Obour','El Obour':'El-Obour','Obour Branch':'El-Obour','El-Obour Branch':'El-Obour',
  '6th October':'6th of October','6 October':'6th of October','6th of October Branch':'6th of October',
  'Sheikh Zayed Branch':'Sheikh Zayed','Port Said Branch':'Port Said','New Damietta Branch':'New Damietta',
  'Minya Branch':'Minya','New Assiut Branch':'New Assiut','Qena Branch':'Qena','New Tiba - Luxor':'New Tiba – Luxor',
  'New Aswan Branch':'New Aswan','10th Ramadan':'10th of Ramadan','10th of Ramadan Branch':'10th of Ramadan',
  'New Administrative Capital Branch':'New Administrative Capital','Suez Branch':'Suez','Sharm El Sheikh':'Sharm El-Sheikh','Luxor Branch':'Luxor'
});
function canonicalBranch(value){const clean=String(value||'').trim();return NEIS_BRANCHES.includes(clean)?clean:(LEGACY_BRANCH_NAMES[clean]||'')}
function branchOptions(current,placeholder=true){const selected=canonicalBranch(current);return `${placeholder?`<option value="" ${selected?'':'selected'}>${bi('Choose branch','اختر الفرع')}</option>`:''}${NEIS_BRANCHES.map(branch=>`<option value="${esc(branch)}" ${selected===branch?'selected':''}>${esc(branch)}</option>`).join('')}`}
const uiAr={
  'Home':'الرئيسية','Discover':'اكتشف','Circles':'المجتمعات','Messages':'الرسائل','Saved':'المحفوظات','Opportunities':'الفرص','Gallery':'المعرض','Articles':'المقالات','Admin':'الإدارة','Create':'إنشاء','Profile':'الملف الشخصي',
  'student network':'شبكة الطلاب','Search people, posts, circles…':'ابحث عن طلاب أو منشورات أو مجتمعات…','Search articles…':'ابحث في المقالات…',
  'Explore gallery':'استكشف المعرض','Read articles':'اقرأ المقالات','Latest articles':'أحدث المقالات','View all':'عرض الكل','Editorial':'تحرير المنصة','students in the network':'طلاب في الشبكة','Your identity':'هويتك','Choose your branch':'اختر فرعك',
  'Admin workspace':'مساحة الإدارة','Platform controls':'أدوات المنصة','Moderation and publishing':'المراجعة والنشر','Open':'فتح','Creative spaces':'المساحات الإبداعية','Community gallery':'معرض المجتمع','Student journal':'مجلة الطلاب',
  'Helpful':'مفيد','Replies':'الردود','Saved':'محفوظ','Save':'حفظ','Share':'مشاركة','No conversations yet':'لا توجد محادثات بعد','Start the first useful one.':'ابدأ أول محادثة مفيدة.',
  'Discover people':'اكتشف الطلاب','Find students by grade, branch, interests and skills.':'ابحث عن الطلاب حسب الصف والفرع والاهتمامات والمهارات.','Follow student':'متابعة الطالب','Following ✓':'تتم المتابعة ✓',
  'Circles':'المجتمعات','Small, focused spaces built around useful conversations.':'مساحات صغيرة ومركزة لمحادثات مفيدة.','+ New circle':'+ مجتمع جديد','Join circle':'انضم للمجتمع','Joined ✓':'منضم ✓','members':'أعضاء',
  'Opportunity board':'لوحة الفرص','Competitions, workshops, volunteering and events worth your time.':'مسابقات وورش وتطوع وفعاليات تستحق وقتك.','+ Share opportunity':'+ أضف فرصة','All':'الكل','Ending soon':'تنتهي قريبًا','Online':'أونلاين','Competitions':'مسابقات',
  'Your library':'مكتبتك','Everything useful you saved for later.':'كل ما حفظته للرجوع إليه لاحقًا.','Your library is quiet':'مكتبتك فارغة','Save a post, resource or opportunity and it will appear here.':'احفظ منشورًا أو مصدرًا أو فرصة لتظهر هنا.',
  'Community gallery':'معرض المجتمع','Projects, events, art and memorable moments—shared by students.':'مشروعات وفعاليات وفنون ولحظات مميزة يشاركها الطلاب.','+ Add to gallery':'+ أضف للمعرض','Featured':'مميز','Mine':'مشاركاتي','Feature':'تمييز','Unfeature':'إلغاء التمييز','Approve':'موافقة','Pending review':'قيد المراجعة','The gallery is ready for its first story':'المعرض جاهز لأول قصة','Upload a meaningful photo with context—not just another image.':'ارفع صورة ذات معنى مع وصف واضح.',
  'Student journal':'مجلة الطلاب','Long-form ideas, guides, experiences and student perspectives.':'أفكار وأدلة وتجارب ومقالات مطولة من الطلاب.','+ Write article':'+ اكتب مقالًا','English':'English','All writers ×':'كل الكتّاب ×','Read article':'قراءة المقال','Edit':'تعديل','No articles match':'لا توجد مقالات مطابقة','Try another search or publish the first article.':'جرّب بحثًا آخر أو انشر أول مقال.','Articles by this writer':'مقالات هذا الكاتب',
  'Admin only':'للأدمن فقط','Your private control room.':'لوحة التحكم الخاصة بك.','Moderate submissions, manage editorial quality and keep technical settings away from student accounts.':'راجع المشاركات وأدر جودة المحتوى مع إبقاء الإعدادات التقنية بعيدة عن حسابات الطلاب.','Write article':'اكتب مقالًا','Add gallery item':'أضف صورة','Profiles':'الحسابات','Posts':'المنشورات','Pending gallery':'بانتظار المراجعة','Moderation queue':'قائمة المراجعة','Only you can see and approve pending gallery submissions.':'أنت فقط تستطيع رؤية مشاركات المعرض المعلقة والموافقة عليها.','Technical settings':'الإعدادات التقنية','Queue cleared':'لا توجد عناصر معلقة','No gallery submissions are waiting.':'لا توجد مشاركات معرض بانتظار المراجعة.','Members & branches':'الأعضاء والفروع','Name':'الاسم','Grade':'الصف','Branch':'الفرع','Access':'الصلاحية','Administrator':'أدمن','Student':'طالب','Draft articles':'مسودات المقالات',
  'Settings':'الإعدادات','Account, appearance, language and privacy.':'الحساب والمظهر واللغة والخصوصية.','Appearance':'المظهر','Light':'فاتح','Dark':'داكن','Language':'اللغة','Private admin workspace':'مساحة الأدمن الخاصة','Open →':'فتح ←','Technical connection':'الاتصال التقني','Sign out of this account':'تسجيل الخروج من الحساب',
  'Close':'إغلاق','Preview':'معاينة','Save draft':'حفظ كمسودة','Publish article':'نشر المقال','Article preview':'معاينة المقال','Edit article':'تعديل المقال','Draft':'مسودة','Article':'مقال',
  'Share a visual story':'شارك قصة بصرية','Use a clear image and explain why the moment matters.':'استخدم صورة واضحة واشرح لماذا هذه اللحظة مهمة.','Image':'الصورة','English caption':'الوصف الإنجليزي','Tags':'الوسوم','Cancel':'إلغاء','Submit to gallery':'إرسال للمراجعة',
  'Create':'إنشاء','Share with NEIS Circle':'شارك مع NEIS Circle','A strong post combines a clear idea, useful context and an optional visual.':'المنشور الجيد يجمع فكرة واضحة وسياقًا مفيدًا وصورة اختيارية.','Type':'النوع','Circle':'المجتمع','Title':'العنوان','Details':'التفاصيل','Optional image':'صورة اختيارية','Publish post':'نشر المنشور',
  'Your profile':'ملفك الشخصي','Your grade and branch appear beside your name across the platform.':'يظهر صفك وفرعك بجوار اسمك في المنصة.','Username':'اسم المستخدم','Campus':'الحرم','Bio':'نبذة','Interests':'الاهتمامات','Save profile':'حفظ الملف الشخصي'
};
function translateTree(root){if(!root||!ar())return;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){const value=n.nodeValue,trim=value.trim();if(uiAr[trim])n.nodeValue=value.replace(trim,uiAr[trim])}root.querySelectorAll('[placeholder]').forEach(el=>{const p=el.getAttribute('placeholder');if(uiAr[p])el.setAttribute('placeholder',uiAr[p])})}
function syncChrome(){const navNames={home:['Home','الرئيسية'],discover:['Discover','اكتشف'],circles:['Circles','المجتمعات'],messages:['Messages','الرسائل'],library:['Saved','المحفوظات'],opportunities:['Opportunities','الفرص'],gallery:['Gallery','المعرض'],articles:['Articles','المقالات'],study:['Study','الدراسة'],timetable:['Timetable','الجدول'],admin:['Admin','الإدارة']};$$('[data-nav]').forEach(b=>{const pair=navNames[b.dataset.nav];if(pair&&b.hasAttribute('title'))b.title=ar()?pair[1]:pair[0]});const settingsButton=$('.rail [data-action="settings"]');if(settingsButton)settingsButton.title=bi('Settings','الإعدادات');const search=$('#globalSearch');if(search)search.placeholder=bi('Search people, posts, circles…','ابحث عن طلاب أو منشورات أو مجتمعات…');const langButton=$('[data-action="language"]');if(langButton)langButton.textContent=ar()?'EN':'AR';const subtitle=$('.wordmark span');if(subtitle)subtitle.textContent=bi('student network','شبكة الطلاب');const mobile={home:bi('Home','الرئيسية'),discover:bi('Discover','اكتشف'),circles:bi('Circles','المجتمعات'),messages:bi('Messages','الرسائل')};$$('.bottom-nav [data-nav]').forEach(b=>{const s=b.querySelector('span');if(s&&mobile[b.dataset.nav])s.textContent=mobile[b.dataset.nav]});const more=$('[data-mobile-more] span:last-child');if(more)more.textContent=bi('More','المزيد');translateTree($('.app'));translateTree($('#modalRoot'))}
function loadingScreen(){document.body.classList.remove('app-ready');authRoot.innerHTML=`<div class="auth-loading"><i></i><span>${bi('Preparing your account…','جارٍ تجهيز حسابك…')}</span></div>`}
function authScreen(){document.body.classList.remove('app-ready');const signup=authMode==='signup';authRoot.innerHTML=`<section class="auth-shell"><div class="auth-story"><div class="auth-brand"><i>NC</i><span>NEIS Circle</span></div><div class="auth-story-copy"><h1>${bi('A better student network starts with you.','شبكة طلاب أفضل تبدأ بك.')}</h1><p>${bi('A private space for useful questions, real experiences, student articles and creative work.','مساحة خاصة للأسئلة المفيدة والخبرات الحقيقية ومقالات الطلاب وأعمالهم الإبداعية.')}</p></div><div class="auth-points"><span>${bi('Profiles organized by grade and branch','ملفات شخصية مرتبة حسب الصف والفرع')}</span><span>${bi('Bilingual articles and moderated gallery','مقالات باللغتين ومعرض يخضع للمراجعة')}</span><span>${bi('Private admin controls and protected data','إدارة خاصة وبيانات محمية')}</span></div></div><div class="auth-panel"><div class="auth-tools"><button data-auth-lang>${ar()?'EN':'AR'}</button><button data-auth-theme>${state.theme==='light'?'◐':'☀'}</button></div><h2>${signup?bi('Create your account','أنشئ حسابك'):bi('Welcome back','مرحبًا بعودتك')}</h2><p>${signup?bi('Start with Google, then complete your student profile.','ابدأ بحساب Google ثم أكمل ملفك كطالب.'):bi('Sign in before entering the student network.','سجّل الدخول أولًا قبل دخول شبكة الطلاب.')}</p><div class="auth-choice"><button class="${!signup?'active':''}" data-auth-mode="signin">${bi('Sign in','تسجيل الدخول')}</button><button class="${signup?'active':''}" data-auth-mode="signup">${bi('Create account','إنشاء حساب')}</button></div><button class="google-btn" data-auth-google><span class="google-mark">G</span>${signup?bi('Create account with Google','إنشاء حساب باستخدام Google'):bi('Continue with Google','المتابعة باستخدام Google')}</button><p class="auth-note">${bi('Google is used only for secure authentication. Your profile is completed in the next step.','يُستخدم Google لتسجيل الدخول الآمن فقط، ثم تكمل ملفك في الخطوة التالية.')}</p></div></section>`;authRoot.querySelectorAll('[data-auth-mode]').forEach(b=>b.onclick=()=>{authMode=b.dataset.authMode;authScreen()});authRoot.querySelector('[data-auth-google]').onclick=()=>{if(!sb){toast(bi('Connection is not ready. Please refresh.','الاتصال غير جاهز، حدّث الصفحة.'));return}googleSignIn()};authRoot.querySelector('[data-auth-lang]').onclick=()=>{state.lang=ar()?'en':'ar';state.articleLanguage=state.lang;applyPrefs();authScreen()};authRoot.querySelector('[data-auth-theme]').onclick=()=>{state.theme=state.theme==='light'?'dark':'light';applyPrefs();authScreen()}}
function onboardingScreen(){document.body.classList.remove('app-ready');const meta=authUser?.user_metadata||{},name=state.profile.name&&state.profile.name!=='Student'?state.profile.name:(meta.full_name||meta.name||'');authRoot.innerHTML=`<section class="onboard-shell"><div class="onboard-head"><div><span class="onboard-step">${bi('STEP 2 OF 2','الخطوة ٢ من ٢')}</span><h1>${bi('Complete your student profile','أكمل ملفك كطالب')}</h1><p>${bi('This information helps students find the right people and keeps the community organized.','تساعد هذه البيانات الطلاب في العثور على الأشخاص المناسبين وتنظيم المجتمع.')}</p></div><div class="auth-tools"><button data-auth-lang>${ar()?'EN':'AR'}</button><button data-onboard-signout>${bi('Sign out','خروج')}</button></div></div><form id="onboardForm"><div class="onboard-grid"><label class="field">${bi('Full name','الاسم الكامل')}<input id="obName" value="${esc(name)}" required maxlength="80"></label><label class="field">${bi('Username','اسم المستخدم')}<input id="obUsername" value="${esc(state.profile.username||'')}" required maxlength="30" placeholder="eyad_ahmed" pattern="[A-Za-z0-9_]{3,30}"></label><label class="field">${bi('Grade','الصف')}<select id="obGrade" required><option value="">${bi('Choose grade','اختر الصف')}</option>${['Grade 10','Grade 11','Grade 12','Graduate'].map(x=>`<option ${state.profile.grade===x?'selected':''}>${x}</option>`).join('')}</select></label><label class="field">${bi('Branch','الفرع')}<select id="obBranch" required>${branchOptions(state.profile.branch)}</select></label><label class="field wide">${bi('Interests','الاهتمامات')}<input id="obInterests" value="${esc(state.profile.interests||'')}" placeholder="Physics, Design, Robotics"></label></div><div id="onboardError" class="form-error hidden"></div><div class="modal-actions"><button id="completeProfile" class="primary">${bi('Enter NEIS Circle','دخول NEIS Circle')}</button></div></form></section>`;authRoot.querySelector('[data-auth-lang]').onclick=()=>{state.lang=ar()?'en':'ar';state.articleLanguage=state.lang;applyPrefs();onboardingScreen()};authRoot.querySelector('[data-onboard-signout]').onclick=signOut;authRoot.querySelector('#onboardForm').onsubmit=saveOnboarding}
async function saveOnboarding(e){e.preventDefault();const btn=$('#completeProfile'),errorBox=$('#onboardError'),username=$('#obUsername').value.trim().toLowerCase();if(!/^[a-z0-9_]{3,30}$/.test(username)){errorBox.textContent=bi('Username must be 3–30 letters, numbers or underscores.','اسم المستخدم يجب أن يكون من ٣ إلى ٣٠ حرفًا إنجليزيًا أو رقمًا أو شرطة سفلية.');errorBox.classList.remove('hidden');return}btn.classList.add('button-loading');btn.textContent=bi('Saving…','جارٍ الحفظ…');const payload={id:authUser.id,full_name:$('#obName').value.trim(),username,grade:$('#obGrade').value,branch:$('#obBranch').value,campus:$('#obBranch').value,interests:$('#obInterests').value.split(',').map(x=>x.trim()).filter(Boolean),onboarding_complete:true};const {error}=await sb.from('profiles').upsert(payload,{onConflict:'id'});if(error){errorBox.textContent=error.code==='23505'?bi('This username is already taken.','اسم المستخدم مستخدم بالفعل.'):window.neisFriendlyError?.(error,'complete your profile')||bi('We could not complete your profile. Please try again.','تعذر إكمال ملفك. حاول مرة أخرى.');errorBox.classList.remove('hidden');btn.classList.remove('button-loading');btn.textContent=bi('Enter NEIS Circle','دخول NEIS Circle');return}state.onboardingComplete=true;await loadLiveData();render();toast(bi('Profile completed — welcome!','اكتمل ملفك — أهلًا بك!'))}
const v3Load=loadLiveData;
loadLiveData=async function(){if(!sb||!authUser)return;await v3Load();const {data,error}=await sb.from('profiles').select('onboarding_complete').eq('id',authUser.id).maybeSingle();state.onboardingComplete=!error&&data?.onboarding_complete===true};
const v3Render=render;
render=function(){if(!authUser){authScreen();return}if(state.onboardingComplete===null){loadingScreen();return}if(state.onboardingComplete!==true){onboardingScreen();return}document.body.classList.add('app-ready');authRoot.innerHTML='';v3Render();syncChrome()};
setupBanner=()=>'';
requireAccount=function(){if(authUser&&state.onboardingComplete===true)return true;render();return false};
const oldApplyPrefs=applyPrefs;
applyPrefs=function(){oldApplyPrefs();setTimeout(syncChrome,0)};

galleryCard=function(g){const cap=(ar()?g.caption_ar:g.caption_en)||g.caption_en||g.caption_ar||bi('Community moment','لحظة من المجتمع'),demo=String(g.id).startsWith('demo-'),manageable=state.isAdmin&&!demo;return `<article class="gallery-card"><img src="${esc(g.image_url)}" alt="${esc(cap)}" loading="lazy"><div class="gallery-tools">${!g.approved&&!demo?`<span class="status-pill">${bi('Pending review','قيد المراجعة')}</span>`:''}${g.featured?`<span class="status-pill live">${bi('Featured','مميز')}</span>`:''}${manageable&&!g.approved?`<button data-approve-gallery="${g.id}">${bi('Approve','موافقة')}</button>`:''}${manageable&&g.approved?`<button data-feature-gallery="${g.id}">${g.featured?bi('Unfeature','إلغاء التمييز'):bi('Feature','تمييز')}</button>`:''}</div><div class="gallery-copy"><div class="tag-row">${(g.tags||[]).slice(0,3).map(t=>`<span>#${esc(t)}</span>`).join('')}</div><h3>${esc(cap)}</h3><p>${esc(authorName(g.author))} · ${esc(authorMeta(g.author))}</p></div></article>`};
const v3Moderate=moderateGallery;
moderateGallery=async function(id,changes){if(String(id).startsWith('demo-')){toast(bi('Sample items are read-only.','العناصر النموذجية للعرض فقط.'));return}return v3Moderate(id,changes)};
async function uploadRecord(file,folder){if(!file)return null;if(file.size>8*1024*1024){toast(bi('Image must be smaller than 8 MB.','يجب أن تكون الصورة أقل من 8 ميجابايت.'));return null}if(!file.type.startsWith('image/')){toast(bi('Choose a valid image file.','اختر ملف صورة صالحًا.'));return null}const ext=(file.name.split('.').pop()||'jpg').replace(/[^a-z0-9]/gi,'').toLowerCase(),path=`${authUser.id}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;toast(bi('Uploading image…','جارٍ رفع الصورة…'));const {error}=await sb.storage.from('community-media').upload(path,file,{cacheControl:'3600',upsert:false});if(error){toast(error.message);return null}return {path,url:sb.storage.from('community-media').getPublicUrl(path).data.publicUrl}}
newGallery=function(){if(!requireAccount())return;openModal(`<div class="modal-head"><div><p class="kicker"><i></i>${bi('Community gallery','معرض المجتمع')}</p><h2>${bi('Share a visual story','شارك قصة بصرية')}</h2><p>${bi('Every submission goes to the admin review queue before publishing.','كل مشاركة تذهب إلى قائمة مراجعة الأدمن قبل النشر.')}</p></div><button class="close" data-close>×</button></div><form id="galleryForm"><label class="field">${bi('Image','الصورة')}<input id="galleryFile" type="file" accept="image/*" required></label><img id="galleryPreview" class="upload-preview hidden"><div class="row"><label class="field">English caption<textarea id="galleryCaptionEn" rows="4" placeholder="What is happening, and why does it matter?"></textarea></label><label class="field">الوصف العربي<textarea id="galleryCaptionAr" dir="rtl" rows="4" placeholder="ماذا يحدث ولماذا هذه اللحظة مهمة؟"></textarea></label></div><label class="field">${bi('Tags','الوسوم')}<input id="galleryTags" placeholder="Robotics, Art, Event"></label><div class="modal-actions"><button type="button" class="secondary" data-close>${bi('Cancel','إلغاء')}</button><button id="gallerySubmit" class="primary">${bi('Send for review','إرسال للمراجعة')}</button></div></form>`);$('#galleryFile').onchange=e=>{const f=e.target.files[0];if(f){$('#galleryPreview').src=URL.createObjectURL(f);$('#galleryPreview').classList.remove('hidden')}};$('#galleryForm').onsubmit=async e=>{e.preventDefault();const btn=$('#gallerySubmit');btn.classList.add('button-loading');const media=await uploadRecord($('#galleryFile').files[0],'gallery');if(!media){btn.classList.remove('button-loading');return}const {error}=await sb.from('gallery_items').insert({author_id:authUser.id,image_url:media.url,caption_en:$('#galleryCaptionEn').value.trim(),caption_ar:$('#galleryCaptionAr').value.trim(),tags:$('#galleryTags').value.split(',').map(x=>x.trim()).filter(Boolean).slice(0,8),approved:false,featured:false});if(error){await sb.storage.from('community-media').remove([media.path]);toast(error.message);btn.classList.remove('button-loading');return}closeModal();await loadLiveData();nav(state.isAdmin?'admin':'gallery');toast(bi('Sent to the moderation queue.','تم الإرسال إلى قائمة المراجعة.'))}};
const v3SaveArticle=saveArticle;
saveArticle=async function(status){const file=$('#articleCover')?.files?.[0];if(!file)return v3SaveArticle(status);if(!sb||!authUser)return;const id=$('#articleId').value,title_en=$('#articleTitleEn').value.trim(),title_ar=$('#articleTitleAr').value.trim();if(!title_en&&!title_ar){toast(bi('Add at least one title.','أضف عنوانًا واحدًا على الأقل.'));return}const media=await uploadRecord(file,'article-covers');if(!media)return;const existing=state.articles.find(x=>String(x.id)===id),payload={author_id:authUser.id,title_en,title_ar,excerpt_en:$('#articleExcerptEn').value.trim(),excerpt_ar:$('#articleExcerptAr').value.trim(),content_en:safeRich($('#articleEditorEn').innerHTML),content_ar:safeRich($('#articleEditorAr').innerHTML),cover_url:media.url,status,published_at:status==='published'?(existing?.published_at||new Date().toISOString()):null,updated_at:new Date().toISOString()};const q=id?sb.from('articles').update(payload).eq('id',id):sb.from('articles').insert(payload),{error}=await q;if(error){await sb.storage.from('community-media').remove([media.path]);toast(error.message);return}closeModal();await loadLiveData();nav('articles');toast(status==='published'?bi('Article published.','تم نشر المقال.'):bi('Draft saved.','تم حفظ المسودة.'))};

compose=function(kind='Discussion'){
  if(!requireAccount())return;
  openModal(`<div class="modal-head"><div><p class="kicker"><i></i>${bi('Create','إنشاء')}</p><h2>${bi('Share with NEIS Circle','شارك مع NEIS Circle')}</h2><p>${bi('Add a clear idea, useful context and optional images.','أضف فكرة واضحة وسياقًا مفيدًا وصورًا اختيارية.')}</p></div><button class="close" data-close>×</button></div><form id="postFormPlus">
    <label class="field">${bi('Type','النوع')}<select id="postKind"><option ${kind==='Discussion'?'selected':''}>Discussion</option><option ${kind==='Question'?'selected':''}>Question</option><option ${kind==='Resource'?'selected':''}>Resource</option><option ${kind==='Experience'?'selected':''}>Experience</option><option ${kind==='Announcement'?'selected':''}>Announcement</option><option ${kind==='Poll'?'selected':''}>Poll</option></select></label>
    <label class="field">${bi('Title','العنوان')}<input id="postTitle" required maxlength="140" placeholder="${bi('Make the value clear','اكتب عنوانًا واضحًا')}"></label>
    <label class="field"><span id="postBodyLabel">${bi('Details','التفاصيل')}</span><textarea id="postBody" required rows="7" placeholder="${bi('Add context, what you tried, or what others can learn…','أضف السياق وما جرّبته أو ما يمكن للآخرين تعلمه…')}"></textarea></label>
    <section id="postPollFields" class="circle-poll-composer hidden">
      <div class="circle-poll-composer-head"><div><b>${bi('Poll options','خيارات التصويت')}</b><small>${bi('Add between 2 and 10 unique answers.','أضف من خيارين إلى 10 اختيارات مختلفة.')}</small></div><button type="button" class="secondary" id="postPollAdd">+ ${bi('Add option','إضافة اختيار')}</button></div>
      <div id="postPollOptions" class="circle-poll-option-editors"></div>
      <div class="circle-poll-settings">
        <label class="field">${bi('Voting type','نوع التصويت')}<select id="postPollSelection"><option value="single">${bi('Single choice','اختيار واحد')}</option><option value="multiple">${bi('Multiple choice','اختيارات متعددة')}</option></select></label>
        <label class="field hidden" id="postPollMaxWrap">${bi('Maximum choices','الحد الأقصى للاختيارات')}<input id="postPollMax" type="number" min="1" max="10" placeholder="${bi('No limit','بدون حد')}"></label>
        <label class="field">${bi('Results visibility','ظهور النتائج')}<select id="postPollResults"><option value="after_vote" selected>${bi('After voting','بعد التصويت')}</option><option value="always">${bi('Always visible','ظاهرة دائمًا')}</option><option value="after_close">${bi('After closing','بعد الإغلاق')}</option></select></label>
        <label class="field">${bi('Closing','الإغلاق')}<select id="postPollClosing"><option value="none">${bi('No end date','بدون موعد انتهاء')}</option><option value="custom">${bi('Custom date & time','تاريخ ووقت مخصص')}</option></select></label>
        <label class="field hidden" id="postPollCloseWrap">${bi('Close at','يغلق في')}<input id="postPollCloseAt" type="datetime-local"></label>
      </div>
      <div class="circle-poll-toggles">
        <label><input id="postPollAllowChange" type="checkbox" checked><span><b>${bi('Allow vote changes','السماح بتغيير التصويت')}</b><small>${bi('People can update their vote while the poll is open.','يمكن للمستخدمين تعديل تصويتهم أثناء فتح التصويت.')}</small></span></label>
        <label><input id="postPollAnonymous" type="checkbox"><span><b>${bi('Anonymous voting','تصويت مجهول')}</b><small>${bi('Voter identities stay hidden.','تظل هوية المصوتين مخفية.')}</small></span></label>
      </div>
    </section>
    <div class="row"><label class="field">${bi('Tags','الوسوم')}<input id="postTags" placeholder="Physics, Grade11, Practical"></label><label class="field">${bi('Images (up to 8)','الصور (حتى 8)')}<input id="postImage" type="file" accept="image/*" multiple></label></div>
    <div class="post-image-display-setting"><span>${bi('Image display','عرض الصور')}</span><div class="post-image-display-options"><label><input type="radio" name="postImageDisplayMode" value="fit" checked><b>${bi('Fit','Fit')}</b><small>${bi('Show the whole image.','إظهار الصورة كاملة.')}</small></label><label><input type="radio" name="postImageDisplayMode" value="fill"><b>${bi('Fill','Fill')}</b><small>${bi('Fill the gallery frame; edges may be cropped.','ملء مساحة المعرض وقد يتم قص الأطراف.')}</small></label></div></div>
    <p class="post-image-edit-hint hidden" id="postImageEditHint">${bi('Tap an image to adjust its crop.','اضغط على أي صورة لتعديل القص الخاص بها.')}</p>
    <div id="postImagePreview" class="post-upload-preview-grid hidden"></div>
    <div class="modal-actions"><button type="button" class="secondary" data-close>${bi('Cancel','إلغاء')}</button><button id="postSubmit" class="primary">${bi('Publish post','نشر المنشور')}</button></div>
  </form>`);
  const imageInput=$('#postImage'),preview=$('#postImagePreview'),hint=$('#postImageEditHint');
  let selectedFiles=[],postPollOptions=['',''];
  const postKind=$('#postKind'),postPollFields=$('#postPollFields'),postBody=$('#postBody'),postTitle=$('#postTitle'),postSubmit=$('#postSubmit');
  const renderPostPollOptions=()=>{
    const host=$('#postPollOptions');if(!host)return;
    host.innerHTML=postPollOptions.map((value,index)=>`<div class="circle-poll-option-editor"><span>${index+1}</span><input data-post-poll-option="${index}" maxlength="180" value="${esc(value)}" placeholder="${bi('Option','اختيار')} ${index+1}"><button type="button" data-post-poll-remove="${index}" ${postPollOptions.length<=2?'disabled':''}>×</button></div>`).join('');
    host.querySelectorAll('[data-post-poll-option]').forEach(input=>input.oninput=()=>{postPollOptions[Number(input.dataset.postPollOption)]=input.value});
    host.querySelectorAll('[data-post-poll-remove]').forEach(button=>button.onclick=()=>{if(postPollOptions.length<=2)return;postPollOptions.splice(Number(button.dataset.postPollRemove),1);renderPostPollOptions()});
    $('#postPollAdd').disabled=postPollOptions.length>=10;
  };
  renderPostPollOptions();
  $('#postPollAdd').onclick=()=>{if(postPollOptions.length<10){postPollOptions.push('');renderPostPollOptions()}};
  $('#postPollSelection').onchange=()=>$('#postPollMaxWrap').classList.toggle('hidden',$('#postPollSelection').value!=='multiple');
  $('#postPollClosing').onchange=()=>$('#postPollCloseWrap').classList.toggle('hidden',$('#postPollClosing').value!=='custom');
  const updatePostComposerMode=()=>{
    const isPoll=postKind.value==='Poll';
    postPollFields.classList.toggle('hidden',!isPoll);
    postBody.required=!isPoll;
    postTitle.placeholder=isPoll?bi('Ask a clear poll question','اكتب سؤال تصويت واضحًا'):bi('Make the value clear','اكتب عنوانًا واضحًا');
    postBody.placeholder=isPoll?bi('Add optional context for the poll…','أضف وصفًا اختياريًا للتصويت…'):bi('Add context, what you tried, or what others can learn…','أضف السياق وما جرّبته أو ما يمكن للآخرين تعلمه…');
    const bodyLabel=$('#postBodyLabel');if(bodyLabel)bodyLabel.textContent=isPoll?bi('Description / context (optional)','الوصف / السياق (اختياري)'):bi('Details','التفاصيل');
    if(postSubmit)postSubmit.textContent=isPoll?bi('Publish poll','نشر التصويت'):bi('Publish post','نشر المنشور');
  };
  postKind.onchange=updatePostComposerMode;
  updatePostComposerMode();
  const renderSelectedImages=()=>{
    preview.innerHTML=selectedFiles.map((file,index)=>`<button type="button" class="post-upload-preview-item post-upload-editable" data-edit-upload-image="${index}" aria-label="${bi('Adjust image','تعديل الصورة')} ${index+1}"><img src="${URL.createObjectURL(file)}" alt="${bi('Selected image','صورة مختارة')} ${index+1}"><span>${index+1}</span><em>${bi('Crop','قص')}</em></button>`).join('');
    preview.classList.toggle('hidden',!selectedFiles.length);
    hint.classList.toggle('hidden',!selectedFiles.length);
    preview.querySelectorAll('[data-edit-upload-image]').forEach(button=>button.onclick=async()=>{
      const index=Number(button.dataset.editUploadImage),source=selectedFiles[index];
      if(!source||!window.NEISImageEditor?.editFile)return;
      const result=await window.NEISImageEditor.editFile(source,16/9,null);
      if(result?.file){selectedFiles[index]=result.file;renderSelectedImages()}
    });
  };
  imageInput.onchange=()=>{
    selectedFiles=[...(imageInput.files||[])].slice(0,8);
    if((imageInput.files?.length||0)>8)toast(bi('You can add up to 8 images per post.','يمكنك إضافة حتى 8 صور في المنشور.'));
    renderSelectedImages();
  };
  $('#postFormPlus').onsubmit=async e=>{
    e.preventDefault();
    const btn=$('#postSubmit'),isPoll=$('#postKind').value==='Poll';
    if(isPoll){
      const clean=postPollOptions.map(x=>x.trim()).filter(Boolean);
      if($('#postTitle').value.trim().length<3){toast(bi('Add a clear poll question.','أضف سؤال تصويت واضحًا.'));return}
      if(clean.length<2||clean.length>10){toast(bi('Add between 2 and 10 poll options.','أضف من خيارين إلى 10 خيارات للتصويت.'));return}
      if(new Set(clean.map(x=>x.toLowerCase())).size!==clean.length){toast(bi('Poll options must be unique.','يجب أن تكون خيارات التصويت مختلفة.'));return}
      if($('#postPollClosing').value==='custom'&&!$('#postPollCloseAt').value){toast(bi('Choose a closing date and time.','اختر تاريخ ووقت الإغلاق.'));return}
    }
    btn.classList.add('button-loading');btn.disabled=true;
    const uploaded=[];
    for(const file of selectedFiles){
      const media=await uploadRecord(file,'posts');
      if(!media){
        if(uploaded.length)await sb.storage.from('community-media').remove(uploaded.map(item=>item.path));
        btn.classList.remove('button-loading');btn.disabled=false;return;
      }
      uploaded.push(media);
    }
    const image_urls=uploaded.map(item=>item.url),image_url=image_urls[0]||'';
    const image_display_mode=document.querySelector('input[name="postImageDisplayMode"]:checked')?.value==='fill'?'fill':'fit';
    let error=null;
    if(isPoll){
      const clean=postPollOptions.map(x=>x.trim()).filter(Boolean),selection=$('#postPollSelection').value,rawMax=$('#postPollMax').value.trim();
      const maxSelections=selection==='single'?1:(rawMax?Math.min(clean.length,Math.max(1,Number(rawMax)||1)):null);
      const closeValue=$('#postPollClosing').value==='custom'?$('#postPollCloseAt').value:'';
      ({error}=await sb.rpc('create_public_poll_post',{
        p_title:$('#postTitle').value.trim(),p_body:$('#postBody').value.trim(),p_tags:$('#postTags').value.split(',').map(x=>x.trim()).filter(Boolean).slice(0,8),
        p_image_url:image_url,p_image_urls:image_urls,p_image_display_mode:image_display_mode,p_options:clean,p_selection_type:selection,p_max_selections:maxSelections,
        p_allow_vote_change:$('#postPollAllowChange').checked,p_anonymous:$('#postPollAnonymous').checked,p_results_visibility:$('#postPollResults').value,
        p_closes_at:closeValue?new Date(closeValue).toISOString():null
      }));
    }else{
      ({error}=await sb.from('posts').insert({author_id:authUser.id,kind:$('#postKind').value,title:$('#postTitle').value.trim(),body:$('#postBody').value.trim(),tags:$('#postTags').value.split(',').map(x=>x.trim()).filter(Boolean).slice(0,6),image_url,image_urls,image_display_mode}));
    }
    if(error){
      if(uploaded.length)await sb.storage.from('community-media').remove(uploaded.map(item=>item.path));
      toast(error.message);btn.classList.remove('button-loading');btn.disabled=false;return;
    }
    closeModal();await loadLiveData();nav('home');toast(isPoll?bi('Poll published.','تم نشر التصويت.'):bi('Published successfully.','تم النشر بنجاح.'));
  };
};

profile=function(){const p=state.profile;openModal(`<div class="modal-head"><div><div class="identity-line"><h2>${bi('Your profile','ملفك الشخصي')}</h2>${state.isAdmin?`<span class="badge-admin">${bi('Administrator','أدمن')}</span>`:''}</div><p>${bi('Your grade and branch appear beside your name across the platform.','يظهر صفك وفرعك بجوار اسمك في المنصة.')}</p></div><button class="close" data-close>×</button></div><form id="profileFormPlus"><div class="row"><label class="field">${bi('Name','الاسم')}<input id="pfName" value="${esc(p.name)}" required></label><label class="field">${bi('Username','اسم المستخدم')}<input id="pfUser" value="${esc(p.username)}" required pattern="[A-Za-z0-9_]{3,30}"></label></div><div class="row"><label class="field">${bi('Grade','الصف')}<select id="pfGrade">${['Grade 10','Grade 11','Grade 12','Graduate'].map(x=>`<option ${p.grade===x?'selected':''}>${x}</option>`).join('')}</select></label><label class="field">${bi('Branch','الفرع')}<select id="pfBranch" required>${branchOptions(p.branch)}</select></label></div><label class="field">${bi('Bio','نبذة')}<textarea id="pfBio" rows="4">${esc(p.bio)}</textarea></label><label class="field">${bi('Interests','الاهتمامات')}<input id="pfInterests" value="${esc(p.interests)}"></label><div class="modal-actions"><button type="button" class="secondary" data-close>${bi('Cancel','إلغاء')}</button><button class="primary">${bi('Save profile','حفظ الملف الشخصي')}</button></div></form>`);$('#profileFormPlus').onsubmit=async e=>{e.preventDefault();const payload={full_name:$('#pfName').value.trim(),username:$('#pfUser').value.trim().toLowerCase(),grade:$('#pfGrade').value,branch:$('#pfBranch').value,campus:$('#pfBranch').value,bio:$('#pfBio').value.trim(),interests:$('#pfInterests').value.split(',').map(x=>x.trim()).filter(Boolean),onboarding_complete:true};const {error}=await sb.from('profiles').update(payload).eq('id',authUser.id);if(error){toast(error.message);return}await loadLiveData();closeModal();render();toast(bi('Profile updated.','تم تحديث الملف الشخصي.'))}};
const STYLE_THEME_PRESETS=[
  {id:'classic',en:'Classic',ar:'الكلاسيكي',descEn:'The original NEIS Circle look.',descAr:'المظهر الأصلي لـ NEIS Circle.'},
  {id:'emerald',en:'Emerald',ar:'الزمردي',descEn:'Soft green, rounded and calm.',descAr:'أخضر هادئ بحواف أكثر نعومة.'},
  {id:'ocean',en:'Ocean',ar:'المحيطي',descEn:'Cool blue accents with a crisp feel.',descAr:'درجات زرقاء ولمسة أكثر حدة.'},
  {id:'sunset',en:'Sunset',ar:'الغروب',descEn:'Warm cream surfaces and coral accents.',descAr:'خلفيات دافئة ولمسات مرجانية.'},
  {id:'minimal',en:'Minimal',ar:'البسيط',descEn:'Flatter, tighter and almost monochrome.',descAr:'أبسط وأكثر هدوءًا وأقل ظلالًا.'},
  {id:'custom',en:'Custom',ar:'مخصص',descEn:'Ocean style with your own accent color.',descAr:'ستايل Ocean بنفس الشكل مع لون من اختيارك.'}
];
function styleThemeLabel(id){
  const item=STYLE_THEME_PRESETS.find(x=>x.id===id)||STYLE_THEME_PRESETS[0];
  return bi(item.en,item.ar);
}
function openCustomThemeColorPicker(){
  const current=/^#[0-9a-f]{6}$/i.test(state.customThemeColor||'')?state.customThemeColor:'#256da8';
  const swatches=['#256da8','#087f69','#7c3aed','#d97706','#dc2626','#db2777','#0891b2','#334155'];
  openModal(`<div class="modal-head"><div><h2>${bi('Custom color','اللون المخصص')}</h2><p>${bi('Same Ocean style — only the accent color changes.','نفس ستايل Ocean بالضبط — اللون الأساسي فقط هو الذي يتغير.')}</p></div><button class="close" data-close>×</button></div><div class="custom-theme-color-panel"><label class="custom-theme-color-picker"><span>${bi('Choose any color','اختر أي لون')}</span><input id="customThemeColorInput" type="color" value="${current}"><b id="customThemeColorValue">${current.toUpperCase()}</b></label><div class="custom-theme-swatches">${swatches.map(color=>`<button type="button" data-custom-theme-swatch="${color}" style="--swatch:${color}" aria-label="${color}"></button>`).join('')}</div><div class="custom-theme-preview-live"><span></span><div><b>${bi('Live preview','معاينة مباشرة')}</b><small>${bi('Ocean layout with your selected color.','تنسيق Ocean مع اللون الذي اخترته.')}</small></div></div><div class="modal-actions"><button type="button" class="secondary" data-close>${bi('Cancel','إلغاء')}</button><button type="button" class="primary" id="applyCustomThemeColor">${bi('Apply custom style','تطبيق الستايل المخصص')}</button></div></div>`);
  const input=$('#customThemeColorInput'),value=$('#customThemeColorValue'),preview=$('.custom-theme-preview-live');
  const update=color=>{if(!/^#[0-9a-f]{6}$/i.test(color))return;input.value=color;value.textContent=color.toUpperCase();preview?.style.setProperty('--preview-accent',color)};
  update(current);
  input.oninput=()=>update(input.value);
  $$('[data-custom-theme-swatch]').forEach(button=>button.onclick=()=>update(button.dataset.customThemeSwatch));
  $('#applyCustomThemeColor').onclick=()=>{state.customThemeColor=input.value;state.styleTheme='custom';applyPrefs();closeModal();settings();toast(bi('Custom style applied.','تم تطبيق الستايل المخصص.'))};
}
function openStyleThemePicker(){
  openModal(`<div class="modal-head"><div><h2>${bi('Choose your style','اختر مظهر المنصة')}</h2><p>${bi('This changes the visual style on web and in the mobile app. Light/Dark mode stays separate.','يغيّر هذا الشكل البصري على الويب وتطبيق الموبايل، بينما يظل الوضع الفاتح/الداكن منفصلًا.')}</p></div><button class="close" data-close>×</button></div><div class="style-theme-grid">${STYLE_THEME_PRESETS.map(item=>`<button type="button" class="style-theme-card ${(state.styleTheme||'classic')===item.id?'active':''}" data-style-theme-choice="${item.id}"><span class="style-theme-preview theme-${item.id}" ${item.id==='custom'?`style="--custom-preview:${esc(state.customThemeColor||'#256da8')}"`:''}><i></i><i></i><i></i></span><span><b>${bi(item.en,item.ar)}</b><small>${bi(item.descEn,item.descAr)}</small></span><em>${(state.styleTheme||'classic')===item.id?'✓':''}</em></button>`).join('')}</div>`);
  document.querySelectorAll('[data-style-theme-choice]').forEach(button=>button.onclick=()=>{
    const choice=button.dataset.styleThemeChoice||'classic';
    if(choice==='custom'){openCustomThemeColorPicker();return}
    state.styleTheme=choice;
    applyPrefs();
    closeModal();
    settings();
    toast(bi('Style updated.','تم تحديث المظهر.'));
  });
}
settings=function(){openModal(`<div class="modal-head"><div><h2>${bi('Settings','الإعدادات')}</h2><p>${bi('Account, appearance, language and privacy.','الحساب والمظهر واللغة والخصوصية.')}</p></div><button class="close" data-close>×</button></div><div class="account-menu"><div class="account-row"><div><b>${esc(state.profile.name)}</b><small>${esc(state.profile.grade)} · ${esc(state.profile.branch)}</small></div>${state.isAdmin?`<span class="badge-admin">${bi('Admin','أدمن')}</span>`:`<span class="status-pill">${bi('Student','طالب')}</span>`}</div><button class="account-row" data-setting-plus="theme"><span>${bi('Light / Dark mode','الوضع الفاتح / الداكن')}</span><b>${state.theme==='light'?bi('Light','فاتح'):bi('Dark','داكن')}</b></button><button class="account-row" data-setting-plus="style-theme"><span>${bi('Style theme','نمط التصميم')}</span><b>${styleThemeLabel(state.styleTheme||'classic')}</b></button><button class="account-row" data-setting-plus="lang"><span>${bi('Language','اللغة')}</span><b>${ar()?'العربية':'English'}</b></button><button class="account-row" data-setting-plus="notifications"><span>${bi('Notifications','الإشعارات')}</span><b>${bi('Push & preferences','التنبيهات والإعدادات')}</b></button>${state.isAdmin?`<button class="account-row" data-nav="admin"><span>${bi('Private admin workspace','مساحة الأدمن الخاصة')}</span><b>${bi('Open →','فتح ←')}</b></button><button class="account-row" data-action="admin-connection"><span>${bi('Technical connection','الاتصال التقني')}</span><b>${bi('Admin only','للأدمن فقط')}</b></button>`:''}</div><button class="secondary signout" data-action="signout">${bi('Sign out of this account','تسجيل الخروج من الحساب')}</button>`);$('[data-setting-plus=theme]').onclick=()=>{state.theme=state.theme==='light'?'dark':'light';applyPrefs();settings()};$('[data-setting-plus=style-theme]').onclick=openStyleThemePicker;$('[data-setting-plus=lang]').onclick=()=>{state.lang=ar()?'en':'ar';state.articleLanguage=state.lang;applyPrefs();closeModal();render()};const notificationSettings=$('[data-setting-plus=notifications]');if(notificationSettings)notificationSettings.onclick=()=>{if(window.NEISPWA?.openNotificationSettings)window.NEISPWA.openNotificationSettings();else toast(bi('Notification settings are loading. Try again in a moment.','إعدادات الإشعارات ما زالت تُحمّل. حاول بعد لحظة.'))};$$('.modal [data-nav]').forEach(b=>b.onclick=()=>{closeModal();nav(b.dataset.nav)});translateTree($('#modalRoot'))};
signOut=async function(){if(sb)await sb.auth.signOut();authUser=null;state.isAdmin=false;state.onboardingComplete=null;state.profile={name:'Student',username:'',grade:'',branch:'',campus:'',bio:'',interests:'',role:'student'};state.articles=[];state.gallery=[];state.members=[];save();closeModal();authScreen();toast(bi('Signed out safely.','تم تسجيل الخروج بأمان.'))};
document.addEventListener('click',e=>{const a=e.target.closest('[data-action="language"]');if(a)setTimeout(()=>{state.articleLanguage=state.lang;syncChrome();render()},0)},false);
async function v4Init(){loadingScreen();if(!sb)await initSupabase();if(!sb){authScreen();toast(bi('Could not connect. Please refresh the page.','تعذر الاتصال. حدّث الصفحة وحاول مرة أخرى.'));return}const {data,error}=await sb.auth.getSession();if(error){authScreen();toast(error.message);return}authUser=data.session?.user||null;if(!authUser){authScreen();return}await loadLiveData();render()}
v4Init();
})();
