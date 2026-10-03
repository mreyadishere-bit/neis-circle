/* NEIS Circle chat Data API field lists — keep bootstrap/hydration payloads minimal and consistent. */
(function(){
  window.NEISChatFields={
    version:'182.0',
    conversation:'id,created_at,kind,updated_at',
    member:'conversation_id,user_id,last_read_at,hidden_at,cleared_at',
    message:'id,conversation_id,sender_id,body,created_at,edited_at,deleted_at,reply_to_id,shared_article_id',
    circleMessage:'id,circle_id,sender_id,body,reply_to_id,created_at,edited_at,deleted_at'
  };
})();
