/* NEIS Circle v21 production hotfixes kept isolated from legacy core code. */
deleteDirectMessage=async function(id){
  const message=byId(state.liveMessages,id);
  if(!message||(!same(message.sender_id,authUser.id)&&!state.isAdmin))return;
  if(!await confirmAction(
    t('Delete message?','حذف الرسالة؟'),
    t('It will remain as a deleted-message marker.','ستبقى علامة توضح أن الرسالة حُذفت.')
  ))return;
  const messageId=String(id||'').trim();
  if(!messageId){toast(t('This message could not be identified.','تعذر تحديد هذه الرسالة.'));return}
  const {data,error}=await sb.rpc('delete_direct_message',{message_id_input:messageId});
  if(error||!data){
    toast(error?safeError(error,'delete this message'):t('This message could not be deleted.','تعذر حذف هذه الرسالة.'));
    return;
  }
  await loadLiveData();
  render();
};
