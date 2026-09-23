/* NEIS Circle v12 — permanent owner/admin comment and reply deletion. */
(function(){
  'use strict';
  const tr=(en,arabic)=>state.lang==='ar'?arabic:en;

  function askPermanentDelete(reply){
    const isReply=!!reply.parent_id;
    return new Promise(resolve=>{
      openModal(`<div class="modal-head"><div><h2>${isReply?tr('Delete reply permanently?','حذف الرد نهائيًا؟'):tr('Delete comment permanently?','حذف التعليق نهائيًا؟')}</h2><p>${isReply?tr('This reply will be removed permanently and cannot be restored.','سيُحذف هذا الرد نهائيًا ولا يمكن استعادته.'):tr('This comment and every nested reply below it will be removed permanently.','سيُحذف هذا التعليق وكل الردود المتفرعة منه نهائيًا.')}</p></div><button class="close" data-v12-cancel>×</button></div><div class="modal-actions"><button class="secondary" data-v12-cancel>${tr('Cancel','إلغاء')}</button><button class="primary danger" data-v12-confirm>${tr('Delete permanently','حذف نهائي')}</button></div>`);
      let finished=false;
      const finish=value=>{if(finished)return;finished=true;closeModal();resolve(value)};
      document.querySelectorAll('[data-v12-cancel]').forEach(button=>button.onclick=()=>finish(false));
      document.querySelector('[data-v12-confirm]').onclick=()=>finish(true);
    });
  }

  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-delete-reply]');
    if(!button)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    const reply=state.allComments.find(item=>String(item.id)===String(button.dataset.deleteReply));
    if(!reply)return;
    const post=state.posts.find(item=>String(item.id)===String(reply.post_id));
    const circleMembership=post?.circle_id&&state.circleMembers?.find(item=>String(item.circle_id)===String(post.circle_id)&&String(item.user_id)===String(authUser?.id)&&item.status==='active');
    const permitted=String(reply.author_id)===String(authUser?.id)||state.isAdmin||['owner','admin','moderator'].includes(circleMembership?.role);
    if(!permitted){toast(tr('You can only delete your own comments and replies.','يمكنك حذف تعليقاتك وردودك فقط.'));return}
    const inDiscussion=!!button.closest('#replyContent');
    if(!await askPermanentDelete(reply))return;
    const {data,error}=await sb.from('comments').delete().eq('id',reply.id).select('id');
    if(error){toast(window.neisFriendlyError?.(error,'delete this comment')||error);return}
    if(!data?.length){toast(tr('This item was already removed or you do not have permission to delete it.','تمت إزالة هذا العنصر بالفعل أو لا تملك صلاحية حذفه.'));return}
    const postId=reply.post_id;
    await loadLiveData();
    if(inDiscussion)await comments(postId);else render();
    toast(reply.parent_id?tr('Reply permanently deleted.','تم حذف الرد نهائيًا.'):tr('Comment permanently deleted.','تم حذف التعليق نهائيًا.'));
  },true);
})();
