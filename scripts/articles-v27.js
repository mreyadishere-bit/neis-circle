/* NEIS Circle v27 — resilient article autosave and database-backed article comments. */
(function(){
  'use strict';
  const VERSION='v27';
  const tr=(en,ar)=>state.lang==='ar'?ar:en;
  const same=(a,b)=>String(a)===String(b);
  const uid=()=>authUser?.id||'';
  const DRAFT_PREFIX=`neis:article-autosave:${VERSION}:`;
  let autosaveContext=null;
  let articleCommentChannel=null;
  let commentRequest=0;
  let engagementRequest=0;
  let deepLinkOpened='';

  function contentDirection(...values){
    const text=values.join(' ').replace(/<[^>]*>/g,' '),arabic=(text.match(/[\u0600-\u06ff]/g)||[]).length,latin=(text.match(/[A-Za-z]/g)||[]).length;
    return arabic>latin?'rtl':'ltr';
  }

  const originalCloseModal=closeModal;
  closeModal=function(){
    if(autosaveContext&&!autosaveContext.cleared)persistArticleAutosave(true);
    stopArticleAutosave();
    stopArticleCommentRealtime();
    originalCloseModal();
  };

  function indexKey(){return `${DRAFT_PREFIX}${uid()}:index`}
  function articleDraftKey(articleId){return `${DRAFT_PREFIX}${uid()}:article:${articleId}`}
  function newDraftKey(instance){return `${DRAFT_PREFIX}${uid()}:new:${instance}`}
  function parseJson(value,fallback=null){try{return JSON.parse(value)??fallback}catch{return fallback}}
  function draftIndex(){return parseJson(localStorage.getItem(indexKey()),[]).filter(Boolean)}
  function saveDraftIndex(items){localStorage.setItem(indexKey(),JSON.stringify([...new Set(items)].slice(-20)))}
  function removeDraftKey(key){
    if(!key)return;
    localStorage.removeItem(key);
    saveDraftIndex(draftIndex().filter(item=>item!==key));
  }
  function clearCurrentDraft(){
    if(!autosaveContext)return;
    autosaveContext.cleared=true;
    removeDraftKey(autosaveContext.key);
    if(!autosaveContext.articleId)sessionStorage.removeItem(`${DRAFT_PREFIX}${uid()}:current-new`);
  }
  function newestNewDraft(){
    const candidates=draftIndex().map(key=>({key,value:parseJson(localStorage.getItem(key))})).filter(item=>item.value&&!item.value.article_id);
    candidates.sort((a,b)=>new Date(b.value.saved_at||0)-new Date(a.value.saved_at||0));
    return candidates[0]||null;
  }
  function prepareDraftContext(article){
    const articleId=article?.id?String(article.id):'';
    let key,instance,stored=null;
    if(articleId){key=articleDraftKey(articleId);stored=parseJson(localStorage.getItem(key));instance=`article-${articleId}`}
    else{
      const sessionKey=`${DRAFT_PREFIX}${uid()}:current-new`,remembered=sessionStorage.getItem(sessionKey),recent=newestNewDraft();
      key=remembered&&localStorage.getItem(remembered)?remembered:recent?.key;
      if(!key){instance=crypto.randomUUID();key=newDraftKey(instance);saveDraftIndex([...draftIndex(),key])}
      else instance=key.split(':').pop();
      sessionStorage.setItem(sessionKey,key);stored=parseJson(localStorage.getItem(key));
    }
    if(stored&&stored.user_id!==uid()){stored=null;removeDraftKey(key)}
    if(stored&&articleId&&String(stored.article_id)!==articleId){stored=null;removeDraftKey(key)}
    if(stored&&article?.updated_at&&new Date(stored.saved_at)<=new Date(article.updated_at)&&!stored.dirty){stored=null;removeDraftKey(key)}
    autosaveContext={key,instance,articleId,stored,timer:null,interval:null,dirty:false,saveFailed:false,lastSavedAt:stored?.saved_at||null,awaitingRestore:!!stored,restoredCoverFile:null,cleared:false,writeToken:0,lastFileSig:''};
  }
  function draftHasContent(data){return !![data.title_en,data.title_ar,data.excerpt_en,data.excerpt_ar,data.content_en,data.content_ar,(data.tags||[]).join('')].some(value=>String(value||'').replace(/<[^>]+>/g,'').trim())||!!data.cover_url||!!data.cover_data_url}
  function collectArticleDraft(){
    if(!autosaveContext||!$('#articleId'))return null;
    return {
      version:VERSION,user_id:uid(),instance_id:autosaveContext.instance,article_id:$('#articleId').value||null,
      title_en:$('#articleTitleEn').value,title_ar:$('#articleTitleAr').value,
      excerpt_en:$('#articleExcerptEn').value,excerpt_ar:$('#articleExcerptAr').value,
      content_en:$('#articleEditorEn').innerHTML,content_ar:$('#articleEditorAr').innerHTML,
      category:$('#articleCategory')?.value||'General',tags:($('#articleTags')?.value||'').split(',').map(x=>x.trim()).filter(Boolean).slice(0,12),
      cover_url:$('#articleCoverPreview')?.dataset.persistedUrl||'',cover_name:$('#articleCover')?.files?.[0]?.name||autosaveContext.stored?.cover_name||'',
      cover_type:$('#articleCover')?.files?.[0]?.type||autosaveContext.stored?.cover_type||'',
      cover_data_url:autosaveContext.stored?.cover_data_url||'',saved_at:new Date().toISOString(),dirty:true
    };
  }
  function readSmallImage(file){return new Promise(resolve=>{if(!file||file.size>750*1024){resolve('');return}const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>resolve('');reader.readAsDataURL(file)})}
  function setAutosaveStatus(mode,label,time=''){
    const status=$('#articleAutosaveStatus');if(!status)return;
    status.className=`article-autosave-status ${mode?`is-${mode}`:''}`;
    status.innerHTML=`<i></i><span>${esc(label)}</span>${time?`<time class="article-autosave-time">${esc(time)}</time>`:''}`;
  }
  function savedTime(value){return new Intl.DateTimeFormat(state.lang==='ar'?'ar-EG':'en-GB',{hour:'2-digit',minute:'2-digit'}).format(new Date(value))}
  async function persistArticleAutosave(immediate=false){
    const context=autosaveContext;if(!context||context.cleared||context.awaitingRestore)return;
    const currentFile=$('#articleCover')?.files?.[0]||context.restoredCoverFile,fileSig=currentFile?`${currentFile.name}:${currentFile.size}:${currentFile.lastModified}`:'';
    if(!immediate&&!context.dirty&&fileSig===context.lastFileSig)return;
    clearTimeout(context.timer);context.timer=null;
    const data=collectArticleDraft();if(!data)return;
    if(!draftHasContent(data)){removeDraftKey(context.key);context.dirty=false;setAutosaveStatus('',tr('Nothing to save yet','لا يوجد محتوى للحفظ بعد'));return}
    const token=++context.writeToken;
    if(!immediate)setAutosaveStatus('saving',tr('Saving…','جارٍ الحفظ…'));
    const file=currentFile;
    if(file)data.cover_data_url=await readSmallImage(file);
    if((autosaveContext!==context&&!immediate)||token!==context.writeToken)return;
    try{
      localStorage.setItem(context.key,JSON.stringify(data));
      saveDraftIndex([...draftIndex(),context.key]);
    }catch(error){
      try{data.cover_data_url='';localStorage.setItem(context.key,JSON.stringify(data));saveDraftIndex([...draftIndex(),context.key])}
      catch(secondError){context.saveFailed=true;setAutosaveStatus('error',tr('Local saving failed','تعذر الحفظ المحلي'));return}
    }
    context.stored=data;context.lastSavedAt=data.saved_at;context.lastFileSig=fileSig;context.dirty=false;context.saveFailed=false;
    setAutosaveStatus('saved',tr('Saved locally','تم الحفظ محليًا'),savedTime(data.saved_at));
  }
  function scheduleArticleAutosave(){
    const context=autosaveContext;if(!context||context.awaitingRestore||context.cleared)return;
    context.dirty=true;clearTimeout(context.timer);setAutosaveStatus('saving',tr('Saving…','جارٍ الحفظ…'));
    context.timer=setTimeout(()=>persistArticleAutosave(),850);
  }
  function stopArticleAutosave(){
    if(!autosaveContext)return;
    clearTimeout(autosaveContext.timer);clearInterval(autosaveContext.interval);autosaveContext.timer=null;autosaveContext.interval=null;autosaveContext=null;
  }
  function dataUrlFile(dataUrl,name,type){
    try{const parts=dataUrl.split(','),mime=type||parts[0].match(/data:([^;]+)/)?.[1]||'image/jpeg',bytes=atob(parts[1]),buffer=new Uint8Array(bytes.length);for(let i=0;i<bytes.length;i++)buffer[i]=bytes.charCodeAt(i);return new File([buffer],name||'recovered-cover.jpg',{type:mime})}catch{return null}
  }
  function applyRecoveredDraft(data){
    $('#articleTitleEn').value=data.title_en||'';$('#articleTitleAr').value=data.title_ar||'';
    $('#articleExcerptEn').value=data.excerpt_en||'';$('#articleExcerptAr').value=data.excerpt_ar||'';
    $('#articleEditorEn').innerHTML=safeRich(data.content_en||'');$('#articleEditorAr').innerHTML=safeRich(data.content_ar||'');
    if($('#articleCategory'))$('#articleCategory').value=data.category||'General';if($('#articleTags'))$('#articleTags').value=(data.tags||[]).join(', ');
    if(data.cover_data_url){const preview=$('#articleCoverPreview');preview.src=data.cover_data_url;preview.classList.remove('hidden');autosaveContext.restoredCoverFile=dataUrlFile(data.cover_data_url,data.cover_name,data.cover_type)}
    else if(data.cover_url){const preview=$('#articleCoverPreview');preview.src=data.cover_url;preview.dataset.persistedUrl=data.cover_url;preview.classList.remove('hidden')}
  }
  function resolveRestore(restore){
    if(!autosaveContext)return;
    if(restore)applyRecoveredDraft(autosaveContext.stored);
    else{removeDraftKey(autosaveContext.key);autosaveContext.stored=null}
    autosaveContext.awaitingRestore=false;autosaveContext.dirty=!!restore;
    $('#articleRestorePrompt')?.remove();
    setAutosaveStatus(restore?'saved':'',restore?tr('Draft restored — autosave is active','تم استرجاع المسودة — الحفظ التلقائي يعمل'):tr('Autosave is active','الحفظ التلقائي يعمل'),restore&&autosaveContext.lastSavedAt?savedTime(autosaveContext.lastSavedAt):'');
    if(restore)scheduleArticleAutosave();
  }

  openArticleEditor=function(article=null){
    if(!requireAccount())return;
    stopArticleCommentRealtime();
    const editing=!!article,canEdit=!article||same(article.author_id,uid())||state.isAdmin;
    if(!canEdit){toast(tr('You cannot edit this article.','لا يمكنك تعديل هذا المقال.'));return}
    prepareDraftContext(article);
    const restore=autosaveContext.stored;
    openModal(`<div class="modal-head"><div><p class="kicker"><i></i>${tr('Student journal','مجلة الطلاب')}</p><h2>${editing?tr('Edit article','تعديل المقال'):tr('Write a complete article','اكتب مقالًا كاملًا')}</h2><p>${tr('Your work is saved locally while you type.','يُحفظ عملك محليًا أثناء الكتابة.')}</p></div><button class="close" data-close>×</button></div>
      ${restore?`<section id="articleRestorePrompt" class="article-restore"><div><b>${tr('A recoverable draft was found','تم العثور على مسودة قابلة للاسترجاع')}</b><p>${tr('Last saved locally','آخر حفظ محلي')}: ${esc(new Intl.DateTimeFormat(state.lang==='ar'?'ar-EG':'en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(restore.saved_at)))}</p></div><div class="article-restore-actions"><button class="primary" type="button" data-restore-article>${tr('Restore Draft','استرجاع المسودة')}</button><button class="secondary danger" type="button" data-discard-article>${tr('Discard Draft','حذف المسودة')}</button></div></section>`:''}
      <div class="article-autosave-bar"><div id="articleAutosaveStatus" class="article-autosave-status"><i></i><span>${restore?tr('Recovery available','توجد مسودة للاسترجاع'):tr('Autosave is active','الحفظ التلقائي يعمل')}</span></div></div>
      <input type="hidden" id="articleId" value="${esc(article?.id||'')}">
      <div class="row"><label class="field">${tr('English title','العنوان الإنجليزي')}<input id="articleTitleEn" maxlength="180" value="${esc(article?.title_en||'')}" placeholder="Clear, valuable title"></label><label class="field">العنوان العربي<input id="articleTitleAr" maxlength="180" dir="rtl" value="${esc(article?.title_ar||'')}" placeholder="عنوان واضح ومفيد"></label></div>
      <div class="row"><label class="field">${tr('English excerpt','الملخص الإنجليزي')}<textarea id="articleExcerptEn" rows="3">${esc(article?.excerpt_en||'')}</textarea></label><label class="field">الملخص العربي<textarea id="articleExcerptAr" dir="rtl" rows="3">${esc(article?.excerpt_ar||'')}</textarea></label></div>
      <div class="article-editor-meta"><label class="field">${tr('Category','التصنيف')}<select id="articleCategory">${['General','Education','Science','Technology','Student Life','Opinion','Guide'].map(value=>`<option ${value===(article?.category||'General')?'selected':''}>${value}</option>`).join('')}</select></label><label class="field">${tr('Tags','الوسوم')}<input id="articleTags" value="${esc((article?.tags||[]).join(', '))}" placeholder="Physics, Study tips, Grade 11"></label></div>
      <label class="field">${tr('Cover image','صورة الغلاف')}<input id="articleCover" type="file" accept="image/*"></label>
      ${article?.cover_url?`<img id="articleCoverPreview" class="upload-preview" data-persisted-url="${esc(article.cover_url)}" src="${esc(article.cover_url)}" alt="">`:`<img id="articleCoverPreview" class="upload-preview hidden" alt="">`}
      <div class="editor-tabs"><button class="active" data-editor-tab="en">English editor</button><button data-editor-tab="ar">المحرر العربي</button></div>
      <div class="editor-pane active" data-editor-pane="en"><div class="editor-shell">${editorToolbar('articleEditorEn')}<div id="articleEditorEn" class="rich-editor" contenteditable="true" data-placeholder="Write your English article…">${safeRich(article?.content_en||'')}</div></div></div>
      <div class="editor-pane" data-editor-pane="ar"><div class="editor-shell" dir="rtl">${editorToolbar('articleEditorAr')}<div id="articleEditorAr" class="rich-editor" contenteditable="true" data-placeholder="اكتب المقال العربي…">${safeRich(article?.content_ar||'')}</div></div></div>
      <section id="articlePreview" class="module-card hidden" style="margin-top:16px"></section>
      <div class="modal-actions"><button class="secondary" type="button" data-article-preview>${tr('Preview','معاينة')}</button><button class="secondary" type="button" data-save-article="draft">${tr('Save draft','حفظ كمسودة')}</button><button class="primary" type="button" data-save-article="published">${tr('Publish article','نشر المقال')}</button></div>`,true);
    bindArticleEditor();
    const editor=$('#modalRoot .modal');editor?.classList.add('article-editor-modal');
    editor?.querySelectorAll('input:not([type=file]),textarea,select,[contenteditable=true]').forEach(element=>{element.addEventListener('input',scheduleArticleAutosave);element.addEventListener('change',scheduleArticleAutosave)});
    autosaveContext.interval=setInterval(()=>persistArticleAutosave(),5000);
    $('[data-restore-article]')?.addEventListener('click',()=>resolveRestore(true));$('[data-discard-article]')?.addEventListener('click',()=>resolveRestore(false));
    if(!restore)setAutosaveStatus('',tr('Autosave is active','الحفظ التلقائي يعمل'));
  };

  saveArticle=async function(status){
    if(!sb||!authUser){toast(tr('Sign in first.','سجّل الدخول أولًا.'));return}
    const id=$('#articleId')?.value||'',titleEn=$('#articleTitleEn').value.trim(),titleAr=$('#articleTitleAr').value.trim();
    if(!titleEn&&!titleAr){toast(tr('Add at least one title.','أضف عنوانًا واحدًا على الأقل.'));return}
    const button=$(`[data-save-article="${status}"]`);if(button?.disabled)return;if(button)button.disabled=true;
    const existing=state.articles.find(item=>same(item.id,id));let file=$('#articleCover')?.files?.[0]||autosaveContext?.restoredCoverFile||null;
    let coverUrl=existing?.cover_url||$('#articleCoverPreview')?.dataset.persistedUrl||'',uploadedPath='';
    if(file){
      if(typeof uploadRecord==='function'){const media=await uploadRecord(file,'article-covers');if(!media){if(button)button.disabled=false;return}coverUrl=media.url;uploadedPath=media.path||''}
      else{coverUrl=await uploadMedia(file,'article-covers');if(!coverUrl){if(button)button.disabled=false;return}}
    }
    const payload={author_id:existing?.author_id||authUser.id,title_en:titleEn,title_ar:titleAr,excerpt_en:$('#articleExcerptEn').value.trim(),excerpt_ar:$('#articleExcerptAr').value.trim(),content_en:safeRich($('#articleEditorEn').innerHTML),content_ar:safeRich($('#articleEditorAr').innerHTML),category:$('#articleCategory')?.value||'General',tags:($('#articleTags')?.value||'').split(',').map(value=>value.trim()).filter(Boolean).slice(0,12),cover_url:coverUrl,status,published_at:status==='published'?(existing?.published_at||new Date().toISOString()):null,updated_at:new Date().toISOString()};
    const query=id?sb.from('articles').update(payload).eq('id',id).select('id').single():sb.from('articles').insert(payload).select('id').single();
    const {data,error}=await query;
    if(error){if(uploadedPath)await sb.storage.from('community-media').remove([uploadedPath]);toast(window.neisFriendlyError?.(error,'save this article')||error.message);if(button)button.disabled=false;return}
    clearCurrentDraft();stopArticleAutosave();originalCloseModal();await loadLiveData();nav('articles');
    toast(status==='published'?tr('Article published.','تم نشر المقال.'):tr('Draft saved to your account.','تم حفظ المسودة في حسابك.'));
  };

  function stopArticleCommentRealtime(){engagementRequest++;if(articleCommentChannel&&sb)sb.removeChannel(articleCommentChannel);articleCommentChannel=null}
  function commentAvatar(profile){return avatar({name:profile?.full_name||tr('Student','طالب'),initials:(profile?.full_name||'ST').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase(),color:'#7056d8'})}
  function commentTime(value){return new Intl.DateTimeFormat(state.lang==='ar'?'ar-EG':'en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value))}
  function renderArticleComment(item,all,likesByComment=new Map()){
    const children=all.filter(child=>same(child.parent_id,item.id)),own=same(item.author_id,uid()),canDelete=own||state.isAdmin,profile=item.profile||{},like=likesByComment.get(String(item.id))||{count:0,mine:false};
    return `<article class="article-comment" data-article-comment="${esc(item.id)}"><div class="article-comment-head">${commentAvatar(profile)}<div class="article-comment-identity"><b>${esc(profile.full_name||tr('NEIS Student','طالب NEIS'))}</b><small>${profile.username?`@${esc(profile.username)} · `:''}${commentTime(item.created_at)}${item.updated_at&&new Date(item.updated_at)-new Date(item.created_at)>1000?` · ${tr('edited','معدّل')}`:''}</small></div></div><p class="article-comment-body" dir="auto">${esc(item.body)}</p><div class="article-comment-actions"><button class="${like.mine?'active':''}" data-article-comment-like="${esc(item.id)}" aria-pressed="${like.mine?'true':'false'}">♡ ${tr('Like','إعجاب')} <b>${like.count}</b></button><button data-article-reply="${esc(item.id)}">${tr('Reply','رد')}</button>${own?`<button data-article-edit="${esc(item.id)}">${tr('Edit','تعديل')}</button>`:''}${canDelete?`<button class="danger" data-article-delete="${esc(item.id)}">${tr('Delete','حذف')}</button>`:''}</div>${children.length?`<div class="article-comment-children">${children.map(child=>renderArticleComment(child,all,likesByComment)).join('')}</div>`:''}</article>`;
  }
  async function loadArticleComments(articleId){
    const root=$('#articleCommentsBody'),request=++commentRequest;if(!root)return;
    root.innerHTML='<div class="loading-card"></div>';
    const {data,error}=await sb.from('article_comments').select('id,article_id,parent_id,author_id,body,created_at,updated_at,profile:profiles!article_comments_author_id_fkey(id,full_name,username,avatar_url)').eq('article_id',articleId).order('created_at');
    if(request!==commentRequest||!$('#articleCommentsBody'))return;
    if(error){root.innerHTML=`<div class="article-comment-error">${esc(window.neisFriendlyError?.(error,'load article comments')||tr('Comments could not load.','تعذر تحميل التعليقات.'))}</div>`;return}
    const comments=data||[],roots=comments.filter(item=>!item.parent_id); const {data:commentLikes,error:likesError}=comments.length?await sb.from('article_comment_likes').select('comment_id,user_id').in('comment_id',comments.map(x=>x.id)):{data:[],error:null}; if(likesError)console.warn('[NEIS article comment likes]',likesError); const likesByComment=new Map();(commentLikes||[]).forEach(x=>{const key=String(x.comment_id),row=likesByComment.get(key)||{count:0,mine:false};row.count++;if(same(x.user_id,uid()))row.mine=true;likesByComment.set(key,row)});
    root.innerHTML=`<div class="article-comment-list">${roots.length?roots.map(item=>renderArticleComment(item,comments,likesByComment)).join(''):`<div class="empty"><b>${tr('No comments yet','لا توجد تعليقات بعد')}</b><span>${tr('Start a thoughtful conversation about this article.','ابدأ نقاشًا مفيدًا حول هذا المقال.')}</span></div>`}</div>`;
    $('#articleCommentCount').textContent=String(comments.length);
    bindArticleCommentActions(articleId,comments);
  }
  function bindArticleCommentActions(articleId,comments){
    const container=$('#articleComments');if(!container)return;
    container.querySelectorAll('[data-article-comment-like]').forEach(button=>button.onclick=async()=>{if(button.disabled)return;button.disabled=true;const commentId=button.dataset.articleCommentLike,mine=button.getAttribute('aria-pressed')==='true';const {error}=mine?await sb.from('article_comment_likes').delete().match({comment_id:commentId,user_id:uid()}):await sb.from('article_comment_likes').insert({comment_id:commentId,user_id:uid()});if(error){toast(window.neisFriendlyError?.(error,mine?'unlike this comment':'like this comment')||error);button.disabled=false;return}await loadArticleComments(articleId)});
    container.querySelectorAll('[data-article-reply]').forEach(button=>button.onclick=()=>{const item=comments.find(row=>same(row.id,button.dataset.articleReply));$('#articleCommentParent').value=item.id;$('#articleCommentReplying').classList.remove('hidden');$('#articleCommentReplyingText').textContent=`${tr('Replying to','الرد على')} ${item.profile?.full_name||tr('Student','طالب')}`;$('#articleCommentInput').focus()});
    $('[data-cancel-article-reply]')?.addEventListener('click',()=>{$('#articleCommentParent').value='';$('#articleCommentReplying').classList.add('hidden')});
    container.querySelectorAll('[data-article-edit]').forEach(button=>button.onclick=()=>{const card=button.closest('.article-comment'),item=comments.find(row=>same(row.id,button.dataset.articleEdit));if(card.querySelector('.article-comment-edit'))return;card.querySelector('.article-comment-body').classList.add('hidden');card.querySelector('.article-comment-actions').classList.add('hidden');card.insertAdjacentHTML('beforeend',`<form class="article-comment-edit"><textarea maxlength="4000" dir="auto">${esc(item.body)}</textarea><div class="article-comment-actions"><button type="button" data-cancel-edit>${tr('Cancel','إلغاء')}</button><button class="primary" type="submit">${tr('Save changes','حفظ التعديل')}</button></div></form>`);const form=card.querySelector('.article-comment-edit');form.querySelector('[data-cancel-edit]').onclick=()=>{form.remove();card.querySelector('.article-comment-body').classList.remove('hidden');card.querySelector('.article-comment-actions').classList.remove('hidden')};form.onsubmit=async event=>{event.preventDefault();const saveButton=form.querySelector('[type=submit]'),body=form.querySelector('textarea').value.trim();if(!body)return;saveButton.disabled=true;const {error}=await sb.from('article_comments').update({body}).eq('id',item.id).eq('author_id',uid());if(error){toast(window.neisFriendlyError?.(error,'edit this comment')||error.message);saveButton.disabled=false;return}await loadArticleComments(articleId);toast(tr('Comment updated.','تم تعديل التعليق.'))}});
    container.querySelectorAll('[data-article-delete]').forEach(button=>button.onclick=()=>{const card=button.closest('.article-comment'),item=comments.find(row=>same(row.id,button.dataset.articleDelete));if(card.querySelector('.article-comment-confirm'))return;card.insertAdjacentHTML('beforeend',`<div class="article-comment-confirm"><span>${item.parent_id?tr('Delete this reply permanently?','حذف هذا الرد نهائيًا؟'):tr('Delete this comment and its replies?','حذف هذا التعليق وردوده؟')}</span><div><button type="button" data-cancel-delete>${tr('Cancel','إلغاء')}</button><button type="button" class="danger" data-confirm-delete>${tr('Delete','حذف')}</button></div></div>`);const confirm=card.querySelector('.article-comment-confirm');confirm.querySelector('[data-cancel-delete]').onclick=()=>confirm.remove();confirm.querySelector('[data-confirm-delete]').onclick=async event=>{event.currentTarget.disabled=true;const {data,error}=await sb.from('article_comments').delete().eq('id',item.id).select('id');if(error||!data?.length){toast(error?(window.neisFriendlyError?.(error,'delete this comment')||error.message):tr('This comment could not be deleted.','تعذر حذف التعليق.'));event.currentTarget.disabled=false;return}await loadArticleComments(articleId);toast(tr('Comment deleted.','تم حذف التعليق.'))}});
  }
  async function loadArticleEngagement(articleId){
    const request=++engagementRequest,likeButton=$('[data-article-like]'),shareButton=$('[data-article-share]');
    if(!likeButton||!shareButton)return;
    const [likesResult,sharesResult]=await Promise.all([
      sb.from('article_reactions').select('user_id').eq('article_id',articleId),
      sb.from('article_shares').select('id').eq('article_id',articleId)
    ]);
    if(request!==engagementRequest||!$('[data-article-like]'))return;
    if(likesResult.error||sharesResult.error){
      console.error('[NEIS article engagement]',likesResult.error||sharesResult.error);
      return;
    }
    const likes=likesResult.data||[],liked=likes.some(item=>same(item.user_id,uid()));
    likeButton.classList.toggle('active',liked);likeButton.setAttribute('aria-pressed',String(liked));
    likeButton.querySelector('b').textContent=String(likes.length);
    shareButton.querySelector('b').textContent=String((sharesResult.data||[]).length);
  }
  async function toggleArticleLike(article){
    const button=$('[data-article-like]');if(!button||button.disabled)return;
    button.disabled=true;const liked=button.classList.contains('active');
    const query=liked
      ?sb.from('article_reactions').delete().eq('article_id',article.id).eq('user_id',uid())
      :sb.from('article_reactions').insert({article_id:article.id,user_id:uid()});
    const {error}=await query;
    if(error)toast(window.neisFriendlyError?.(error,liked?'remove this like':'like this article')||error.message);
    else await loadArticleEngagement(article.id);
    button.disabled=false;
  }
  async function copyArticleLink(url){
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);return}
    const input=document.createElement('textarea');input.value=url;input.setAttribute('readonly','');input.style.position='fixed';input.style.opacity='0';document.body.appendChild(input);input.select();document.execCommand('copy');input.remove();
  }
  async function shareArticle(article,title){
    const button=$('[data-article-share]');if(!button||button.disabled)return;
    button.disabled=true;const url=`${location.origin}${location.pathname}#/articles/${article.id}`;
    let method='copy';
    try{
      if(navigator.share){await navigator.share({title,text:tr('Read this article on NEIS Circle','اقرأ هذا المقال على NEIS Circle'),url});method='native'}
      else{await copyArticleLink(url);toast(tr('Article link copied.','تم نسخ رابط المقال.'))}
      const {error}=await sb.from('article_shares').insert({article_id:article.id,user_id:uid(),method});
      if(error)console.error('[NEIS article share tracking]',error);else await loadArticleEngagement(article.id);
    }catch(error){
      if(error?.name!=='AbortError')toast(tr('The article could not be shared.','تعذرت مشاركة المقال.'));
    }finally{button.disabled=false}
  }
  function setupArticleComments(article){
    const form=$('#articleCommentForm');if(!form)return;
    form.onsubmit=async event=>{event.preventDefault();const input=$('#articleCommentInput'),button=form.querySelector('[type=submit]'),body=input.value.trim();if(!body||button.disabled)return;button.disabled=true;const {error}=await sb.from('article_comments').insert({article_id:article.id,parent_id:$('#articleCommentParent').value||null,author_id:uid(),body});if(error){toast(window.neisFriendlyError?.(error,'post this comment')||error.message);button.disabled=false;return}input.value='';$('#articleCommentParent').value='';$('#articleCommentReplying').classList.add('hidden');await loadArticleComments(article.id);toast(tr('Comment posted.','تم نشر التعليق.'))};
    stopArticleCommentRealtime();
    loadArticleComments(article.id);loadArticleEngagement(article.id);
    articleCommentChannel=sb.channel(`article-activity-${article.id}-${uid()}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'article_comments',filter:`article_id=eq.${article.id}`},()=>{if($('#articleComments'))loadArticleComments(article.id)})
      .on('postgres_changes',{event:'*',schema:'public',table:'article_reactions',filter:`article_id=eq.${article.id}`},()=>{if($('#articleComments'))loadArticleEngagement(article.id)})
      .on('postgres_changes',{event:'*',schema:'public',table:'article_shares',filter:`article_id=eq.${article.id}`},()=>{if($('#articleComments'))loadArticleEngagement(article.id)})
      .subscribe();
  }

  readArticle=function(id){
    const article=state.articles.find(item=>same(item.id,id));if(!article)return;
    const requestedArabic=state.articleLanguage==='ar',title=(requestedArabic?article.title_ar:article.title_en)||article.title_en||article.title_ar,rawBody=(requestedArabic?article.content_ar:article.content_en)||article.content_en||article.content_ar,body=safeRich(rawBody),direction=contentDirection(title,rawBody),articleArabic=direction==='rtl',editable=same(article.author_id,uid())||state.isAdmin,published=article.status==='published';
    openModal(`<article class="reader" dir="${direction}" lang="${articleArabic?'ar':'en'}">${article.cover_url?`<img class="reader-cover" src="${esc(article.cover_url)}" alt="${esc(title)}">`:''}<div class="article-meta" style="margin-top:18px"><span class="post-kind">${articleArabic?'مقال':'Article'}</span>${article.category?`<span>${esc(article.category)}</span>`:''}<span>${formatDate(article.published_at||article.created_at)}</span></div><h1>${esc(title)}</h1><button class="author-link" data-author="${article.author_id}">${avatar({name:authorName(article.author),initials:initials(authorName(article.author)),color:'#006f5b'},true)}<span class="author-copy"><b>${esc(authorName(article.author))}</b><small>${esc(authorMeta(article.author))}</small></span></button>${article.tags?.length?`<div class="tag-row">${article.tags.map(tag=>`<span>#${esc(tag)}</span>`).join('')}</div>`:''}<div class="reader-body">${body}</div>${published?`<section id="articleComments" class="article-comments"><div class="article-engagement" dir="${state.lang==='ar'?'rtl':'ltr'}"><button type="button" data-article-like aria-pressed="false">${icon('heart')}<span>${tr('Like','إعجاب')}</span><b>0</b></button><button type="button" data-article-comments-jump>${icon('chat')}<span>${tr('Comments','التعليقات')}</span><b id="articleCommentCount">0</b></button><button type="button" data-article-share>${icon('share')}<span>${tr('Share','مشاركة')}</span><b>0</b></button></div><header class="article-comments-head" dir="${state.lang==='ar'?'rtl':'ltr'}"><div><h2>${tr('Comments','التعليقات')}</h2><p>${tr('Join the discussion respectfully and constructively.','شارك في النقاش باحترام وبشكل بنّاء.')}</p></div></header><div id="articleCommentsBody"><div class="loading-card"></div></div><form id="articleCommentForm" class="article-comment-composer" dir="${state.lang==='ar'?'rtl':'ltr'}"><input type="hidden" id="articleCommentParent"><div id="articleCommentReplying" class="article-comment-replying hidden"><span id="articleCommentReplyingText"></span><button type="button" data-cancel-article-reply>${tr('Cancel reply','إلغاء الرد')}</button></div><textarea id="articleCommentInput" required maxlength="4000" dir="auto" placeholder="${tr('Write a thoughtful comment…','اكتب تعليقًا مفيدًا…')}"></textarea><footer><small>${tr('Your name and profile will appear with your comment.','سيظهر اسمك وملفك الشخصي مع التعليق.')}</small><button class="primary" type="submit">${tr('Post comment','نشر التعليق')}</button></footer></form></section>`:''}<div class="modal-actions" dir="${state.lang==='ar'?'rtl':'ltr'}"><button class="secondary" data-close>${tr('Close','إغلاق')}</button>${editable?`<button class="primary" data-edit-article="${article.id}">${tr('Edit article','تعديل المقال')}</button>`:''}</div></article>`,true);
    $$('[data-author]').forEach(button=>button.onclick=()=>{state.articleAuthor=button.dataset.author;closeModal();nav('articles')});$$('[data-edit-article]').forEach(button=>button.onclick=()=>openArticleEditor(article));
    if(published){setupArticleComments(article);$('[data-article-like]').onclick=()=>toggleArticleLike(article);$('[data-article-share]').onclick=()=>shareArticle(article,title);$('[data-article-comments-jump]').onclick=()=>$('#articleCommentsBody')?.scrollIntoView({behavior:'smooth',block:'start'})}
  };

  window.addEventListener('beforeunload',event=>{if(autosaveContext&&(autosaveContext.saveFailed||autosaveContext.dirty||autosaveContext.timer)){persistArticleAutosave(true);if(autosaveContext?.saveFailed){event.preventDefault();event.returnValue=''}}});
  window.addEventListener('pagehide',()=>{if(autosaveContext)persistArticleAutosave(true)});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&autosaveContext)persistArticleAutosave(true)});
  function openArticleDeepLink(attempt=0){
    const match=location.hash.match(/^#\/articles\/([^/?]+)/);if(!match)return;
    const id=decodeURIComponent(match[1]),article=state.articles.find(item=>same(item.id,id));
    if(!article){if(attempt<8)setTimeout(()=>openArticleDeepLink(attempt+1),300);return}
    const signature=`${location.hash}:${article.updated_at||article.created_at||''}`;if(deepLinkOpened===signature)return;
    deepLinkOpened=signature;readArticle(id);
  }
  window.addEventListener('hashchange',()=>setTimeout(()=>openArticleDeepLink(),80));
  setTimeout(()=>openArticleDeepLink(),450);
})();
