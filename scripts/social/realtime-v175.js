/* NEIS Circle realtime subscription registry — owns the shared social channel lifecycle. */
(function(){
  const chatFields=window.NEISChatFields;
  if(!chatFields)throw new Error('NEIS Chat Fields failed to load before Realtime Registry.');
  let channel=null;
  let channelUid='';
  let status='CLOSED';
  let statusListener=null;

  const same=(a,b)=>String(a)===String(b);
  const MESSAGE_REACTION_FIELDS='id,dm_message_id,circle_message_id,user_id,emoji,created_at';
  const columns=value=>String(value||'').split(',').map(column=>column.trim()).filter(Boolean);
  const TABLE_BINDINGS=[
    ['posts','handlePostRealtime'],
    ['comments','handleCommentRealtime'],
    ['reactions','handleReactionRealtime'],
    ['comment_likes','handleCommentEngagementRealtime'],
    ['comment_creator_hearts','handleCommentEngagementRealtime'],
    ['messages','handleMessageRealtime',columns(chatFields.message)],
    ['conversations','handleConversationRealtime',columns(chatFields.conversation)],
    ['conversation_members','handleConversationMemberRealtime',columns(chatFields.member)],
    ['circle_messages','handleCircleMessageRealtime',columns(chatFields.circleMessage)],
    ['message_reactions','handleMessageReactionRealtime',columns(MESSAGE_REACTION_FIELDS)],
    ['circle_meetings','handleCircleMeetingRealtime'],
    ['follows','handleFollowRealtime'],
    ['circle_members','handleCircleMemberRealtime'],
    ['profiles','handleProfileRealtime'],
    ['articles','handleArticleRealtime'],
    ['gallery_items','handleGalleryRealtime'],
    ['reports','handleReportRealtime']
  ];

  function validateHandlers(handlers){
    const missing=[];
    for(const [,name] of TABLE_BINDINGS){
      if(typeof handlers?.[name]!=='function'&&!missing.includes(name))missing.push(name);
    }
    if(missing.length)throw new Error('Missing realtime handlers: '+missing.join(', '));
  }

  async function setup(uid,{sb,handlers,beforeSetup,onStatus}={}){
    if(!sb||!uid)return;
    validateHandlers(handlers);
    if(typeof beforeSetup==='function')beforeSetup();
    if(typeof onStatus==='function')statusListener=onStatus;

    if(channel&&same(channelUid,uid)&&['CONNECTING','SUBSCRIBED'].includes(status))return channel;

    if(channel){
      try{await sb.removeChannel(channel)}catch(_){}
      channel=null;
    }

    channelUid=uid;
    status='CONNECTING';
    let next=sb.channel(`neis-v7-${uid}`);
    for(const [table,handlerName,select] of TABLE_BINDINGS){
      const filter={event:'*',schema:'public',table};
      if(select?.length)filter.select=select;
      next=next.on(
        'postgres_changes',
        filter,
        handlers[handlerName]
      );
    }
    channel=next.subscribe(nextStatus=>{
      const previousStatus=status;
      status=nextStatus;
      try{statusListener?.(nextStatus,previousStatus)}catch(error){console.warn('[NEIS realtime status listener]',error)}
    });
    return channel;
  }

  async function reset(sb){
    if(channel&&sb){
      try{await sb.removeChannel(channel)}catch(_){}
    }
    channel=null;
    channelUid='';
    status='CLOSED';
    statusListener=null;
  }

  function snapshot(){
    return {
      version:'175.2',
      status,
      user:channelUid,
      active:!!channel,
      bindings:TABLE_BINDINGS.map(([table,handler,select])=>({table,handler,select:select||null}))
    };
  }

  window.NEISRealtimeRegistry={
    version:'175.2',
    setup,
    reset,
    snapshot
  };
})();
