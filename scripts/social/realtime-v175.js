/* NEIS Circle realtime subscription registry — owns the shared social channel lifecycle. */
(function(){
  let channel=null;
  let channelUid='';
  let status='CLOSED';

  const same=(a,b)=>String(a)===String(b);
  const TABLE_BINDINGS=[
    ['posts','handlePostRealtime'],
    ['comments','handleCommentRealtime'],
    ['reactions','handleReactionRealtime'],
    ['comment_likes','handleCommentEngagementRealtime'],
    ['comment_creator_hearts','handleCommentEngagementRealtime'],
    ['messages','handleMessageRealtime'],
    ['conversations','handleConversationRealtime'],
    ['conversation_members','handleConversationMemberRealtime'],
    ['circle_messages','handleCircleMessageRealtime'],
    ['message_reactions','handleMessageReactionRealtime'],
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

  async function setup(uid,{sb,handlers,beforeSetup}={}){
    if(!sb||!uid)return;
    validateHandlers(handlers);
    if(typeof beforeSetup==='function')beforeSetup();

    if(channel&&same(channelUid,uid)&&['CONNECTING','SUBSCRIBED'].includes(status))return channel;

    if(channel){
      try{await sb.removeChannel(channel)}catch(_){}
      channel=null;
    }

    channelUid=uid;
    status='CONNECTING';
    let next=sb.channel(`neis-v7-${uid}`);
    for(const [table,handlerName] of TABLE_BINDINGS){
      next=next.on(
        'postgres_changes',
        {event:'*',schema:'public',table},
        handlers[handlerName]
      );
    }
    channel=next.subscribe(nextStatus=>{status=nextStatus});
    return channel;
  }

  async function reset(sb){
    if(channel&&sb){
      try{await sb.removeChannel(channel)}catch(_){}
    }
    channel=null;
    channelUid='';
    status='CLOSED';
  }

  function snapshot(){
    return {
      version:'175.0',
      status,
      user:channelUid,
      active:!!channel,
      bindings:TABLE_BINDINGS.map(([table,handler])=>({table,handler}))
    };
  }

  window.NEISRealtimeRegistry={
    version:'175.0',
    setup,
    reset,
    snapshot
  };
})();
