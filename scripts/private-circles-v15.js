/* NEIS Circle v15 — private Circle join by exact name + hashed secret key. */
(function(){
  'use strict';
  var revealedKeys=new Map();
  var tr=(en,arText)=>state.lang==='ar'?arText:en;
  var baseCircles=circles;
  circles=function(){
    var html=baseCircles();
    return html.replace(/(<button class="primary" data-new-circle>[\s\S]*?<\/button>)/,`<div class="page-actions"><button class="secondary" data-join-private-circle>${tr('Join Private Circle','انضم لمجتمع خاص')}</button>$1</div>`);
  };
  function injectOwnerKeyControl(){
    var circle=(state.circleRows||[]).find(function(item){return String(item.id)===String(state.activeCircleId)});
    if(!circle||circle.privacy!=='private'||!authUser)return;
    var mine=(state.circleMembers||[]).find(function(item){return String(item.circle_id)===String(circle.id)&&String(item.user_id)===String(authUser.id)});
    if(!mine||mine.role!=='owner'||mine.status!=='active'||document.querySelector('[data-manage-circle-key]'))return;
    var share=document.querySelector(`[data-share-circle="${CSS.escape(String(circle.id))}"]`);
    if(!share)return;
    var button=document.createElement('button');
    button.type='button';button.className='secondary';button.dataset.manageCircleKey=String(circle.id);button.textContent=tr('Join key','مفتاح الانضمام');
    share.insertAdjacentElement('beforebegin',button);
  }
  var baseRender=render;
  render=function(){var result=baseRender();requestAnimationFrame(injectOwnerKeyControl);return result};
  function copyText(value,success){
    navigator.clipboard.writeText(value).then(()=>toast(success)).catch(()=>toast(tr('Copy failed. Select the text and copy it manually.','تعذر النسخ. حدّد النص وانسخه يدويًا.')));
  }
  window.openPrivateCircleJoin=function(){
    openModal(`<div class="modal-head"><div><h2>${tr('Join Private Circle','الانضمام لمجتمع خاص')}</h2><p>${tr('Enter the exact Circle Name and key shared by its owner.','أدخل اسم المجتمع بالضبط والمفتاح الذي شاركه المالك.')}</p></div><button class="close" data-close>×</button></div><form id="privateCircleJoinForm"><label class="field">${tr('Exact Circle Name','اسم المجتمع بالضبط')}<input id="privateCircleName" required minlength="3" maxlength="80" autocomplete="off"></label><label class="field">${tr('Circle Key','مفتاح المجتمع')}<input id="privateCircleKey" required minlength="8" maxlength="40" autocomplete="off" autocapitalize="characters" dir="ltr" placeholder="NC-XXXX-XXXX-XXXX"></label><div id="privateCircleError" class="form-error hidden" role="alert"></div><p class="private-key-note">${tr('For privacy, the same message is shown whether the name or key is wrong.','لحماية الخصوصية، تظهر الرسالة نفسها سواء كان الاسم أو المفتاح غير صحيح.')}</p><div class="modal-actions"><button type="button" class="secondary" data-close>${tr('Cancel','إلغاء')}</button><button id="privateCircleJoinSubmit" class="primary">${tr('Join Circle','الانضمام')}</button></div></form>`);
    document.getElementById('privateCircleJoinForm').onsubmit=joinByKey;
  };
  async function joinByKey(event){
    event.preventDefault();var button=document.getElementById('privateCircleJoinSubmit'),errorBox=document.getElementById('privateCircleError');
    button.disabled=true;button.textContent=tr('Checking securely…','جارٍ التحقق بأمان…');
    var result=await sb.rpc('join_private_circle_by_key',{circle_name_input:document.getElementById('privateCircleName').value.trim(),circle_key_input:document.getElementById('privateCircleKey').value.trim()});
    if(result.error||!result.data){errorBox.textContent=tr('Circle name or key is incorrect.','اسم المجتمع أو المفتاح غير صحيح.');errorBox.classList.remove('hidden');button.disabled=false;button.textContent=tr('Join Circle','الانضمام');return}
    var id=result.data;closeModal();await loadLiveData();state.circleFilter='joined';routeTo(`circles/${id}/home`);toast(tr('You joined the private Circle.','تم انضمامك إلى المجتمع الخاص.'));
  }
  async function keyStatus(id){
    var result=await sb.rpc('private_circle_key_status',{target_circle:id});
    if(result.error){toast(window.neisFriendlyError?.(result.error,'load the private key settings')||tr('Could not load key settings.','تعذر تحميل إعدادات المفتاح.'));return null}
    return result.data;
  }
  window.openPrivateCircleKeyManager=async function(id){
    var status=await keyStatus(id);if(!status)return;
    var known=revealedKeys.get(String(id))||'';
    openModal(`<div class="modal-head"><div><h2>${tr('Private Circle access','دخول المجتمع الخاص')}</h2><p>${tr('Only the owner can manage this key. It is stored as a one-way hash.','المالك فقط يمكنه إدارة المفتاح، ويتم تخزينه كتجزئة أحادية الاتجاه.')}</p></div><button class="close" data-close>×</button></div><section class="private-key-panel"><label class="field">${tr('Circle Name','اسم المجتمع')}<div class="copy-field"><input id="ownerCircleName" readonly value="${esc(status.circle_name)}"><button type="button" class="secondary" data-copy-circle-name>${tr('Copy','نسخ')}</button></div></label><label class="field">${tr('Current Circle Key','مفتاح المجتمع الحالي')}<div class="copy-field"><input id="ownerCircleKey" readonly dir="ltr" value="${esc(known||`••••-••••-${status.key_hint||'----'}`)}"><button type="button" class="secondary" data-copy-circle-key ${known?'':'disabled'}>${tr('Copy','نسخ')}</button></div></label>${known?'':`<p class="private-key-note">${tr('For security, an existing key cannot be recovered from its hash. Regenerate it to reveal and copy a new current key.','للأمان لا يمكن استعادة المفتاح من التجزئة. أنشئ مفتاحًا جديدًا لإظهاره ونسخه.')}</p>`}<div class="private-key-state"><div><b>${status.enabled?tr('Key joining is enabled','الانضمام بالمفتاح مفعّل'):tr('Key joining is disabled','الانضمام بالمفتاح متوقف')}</b><span>${status.rotated_at?`${tr('Last changed','آخر تغيير')}: ${formatDate(status.rotated_at)}`:''}</span></div><button type="button" class="secondary" data-toggle-circle-key="${status.enabled?'false':'true'}">${status.enabled?tr('Disable','إيقاف'):tr('Enable','تفعيل')}</button></div><div class="modal-actions"><button type="button" class="secondary" data-close>${tr('Close','إغلاق')}</button><button type="button" class="primary" data-rotate-circle-key>${known?tr('Regenerate key','تغيير المفتاح'):tr('Generate secure key','إنشاء مفتاح آمن')}</button></div></section>`);
    document.querySelector('[data-copy-circle-name]').onclick=()=>copyText(status.circle_name,tr('Circle Name copied.','تم نسخ اسم المجتمع.'));
    var copy=document.querySelector('[data-copy-circle-key]');if(known)copy.onclick=()=>copyText(known,tr('Circle Key copied.','تم نسخ مفتاح المجتمع.'));
    document.querySelector('[data-toggle-circle-key]').onclick=()=>toggleKey(id,status.enabled);
    document.querySelector('[data-rotate-circle-key]').onclick=()=>rotateKey(id,!!known);
  };
  async function rotateKey(id,hasKey){
    if(hasKey&&!await confirmAction(tr('Regenerate Circle Key?','تغيير مفتاح المجتمع؟'),tr('The old key will stop working immediately. Existing members stay in the Circle.','سيتوقف المفتاح القديم فورًا، وسيظل الأعضاء الحاليون داخل المجتمع.')))return;
    var result=await sb.rpc('rotate_private_circle_key',{target_circle:id});
    if(result.error||!result.data?.key){toast(window.neisFriendlyError?.(result.error,'regenerate the Circle key')||tr('Could not generate the key.','تعذر إنشاء المفتاح.'));return}
    revealedKeys.set(String(id),result.data.key);await window.openPrivateCircleKeyManager(id);toast(tr('New key created. The old key no longer works.','تم إنشاء مفتاح جديد، والمفتاح القديم لم يعد يعمل.'));
  }
  async function toggleKey(id,currentlyEnabled){
    var desired=!currentlyEnabled,result=await sb.rpc('set_private_circle_key_enabled',{target_circle:id,desired_enabled:desired});
    if(result.error){toast(window.neisFriendlyError?.(result.error,'change key access')||tr('Could not change key access.','تعذر تغيير الوصول بالمفتاح.'));return}
    await window.openPrivateCircleKeyManager(id);toast(desired?tr('Key joining enabled.','تم تفعيل الانضمام بالمفتاح.'):tr('Key joining disabled.','تم إيقاف الانضمام بالمفتاح.'));
  }
  document.addEventListener('click',function(event){
    var join=event.target.closest('[data-join-private-circle]');if(join){event.preventDefault();window.openPrivateCircleJoin();return}
    var manage=event.target.closest('[data-manage-circle-key]');if(manage){event.preventDefault();window.openPrivateCircleKeyManager(manage.dataset.manageCircleKey)}
  });
})();
