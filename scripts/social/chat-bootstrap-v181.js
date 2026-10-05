/* NEIS Circle chat bootstrap data runtime — owns initial DM/Circle chat loading without DOM work. */
(function(){
  const fields=window.NEISChatFields;
  if(!fields)throw new Error('NEIS Chat Fields failed to load.');
  const same=(a,b)=>String(a)===String(b);
  const sortedByCreatedAt=list=>list.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  function mergeById(existing,rows){
    const map=new Map((Array.isArray(existing)?existing:[]).map(row=>[String(row.id),row]));
    for(const row of (rows||[])){
      if(!row?.id)continue;
      const key=String(row.id);
      map.set(key,{...(map.get(key)||{}),...row});
    }
    return sortedByCreatedAt([...map.values()]);
  }


  async function loadDirect({sb,userId,state,profileData}={}){
    if(!sb||!userId||!state)return {ok:false,error:new Error('Missing direct chat bootstrap input')};

    const myMembershipRes=await sb.from('conversation_members').select(fields.member).eq('user_id',userId);
    if(myMembershipRes.error)return {ok:false,error:myMembershipRes.error};

    const ownConversationMemberships=myMembershipRes.data||[];
    const conversationIds=ownConversationMemberships.filter(x=>!x.hidden_at).map(x=>x.conversation_id);

    let conversationRes={data:[],error:null},memberRes={data:[],error:null},messageRes={data:[],error:null};
    if(conversationIds.length){
      [conversationRes,memberRes,messageRes]=await Promise.all([
        sb.from('conversations').select(fields.conversation).in('id',conversationIds).order('updated_at',{ascending:false}),
        sb.from('conversation_members').select(fields.member).in('conversation_id',conversationIds),
        sb.from('messages').select(fields.message).in('conversation_id',conversationIds).order('created_at',{ascending:false}).limit(200)
      ]);
    }

    if(!conversationRes.error)state.conversations=conversationRes.data||[];
    if(!memberRes.error){
      state.conversationMembers=(memberRes.data||ownConversationMemberships).map(member=>({
        ...member,
        profile:typeof profileData==='function'?profileData(member.user_id):member.profile
      }));
    }
    if(!messageRes.error){
      const clearedByConversation=new Map(
        ownConversationMemberships
          .filter(x=>x.cleared_at)
          .map(x=>[String(x.conversation_id),new Date(x.cleared_at).getTime()])
      );
      state.liveMessages=(messageRes.data||[])
        .filter(message=>{
          const cleared=clearedByConversation.get(String(message.conversation_id));
          return !cleared||new Date(message.created_at).getTime()>cleared;
        })
        .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    }

    return {
      ok:true,
      ownConversationMemberships,
      conversationIds,
      errors:{
        conversations:conversationRes.error||null,
        members:memberRes.error||null,
        messages:messageRes.error||null
      }
    };
  }

  async function loadCircle({sb,userId,state,profileData,isAdmin=false}={}){
    if(!sb||!userId||!state)return {ok:false,error:new Error('Missing Circle chat bootstrap input')};

    const joinedCircleIds=isAdmin
      ?(state.circleRows||[]).map(circle=>circle.id)
      :(state.circleMembers||[])
        .filter(member=>same(member.user_id,userId)&&['active','muted'].includes(member.status))
        .map(member=>member.circle_id);

    state.circleMessages=[];
    if(!joinedCircleIds.length)return {ok:true,joinedCircleIds,error:null};

    const result=await sb.from('circle_messages')
      .select(fields.circleMessage)
      .in('circle_id',joinedCircleIds)
      .order('created_at',{ascending:false})
      .limit(200);

    if(!result.error){
      state.circleMessages=(result.data||[])
        .map(message=>({
          ...message,
          profile:typeof profileData==='function'?profileData(message.sender_id):message.profile
        }))
        .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    }

    return {ok:!result.error,joinedCircleIds,error:result.error||null};
  }

  async function catchUpDirect({sb,userId,state,profileData}={}){
    if(!sb||!userId||!state)return {ok:false,error:new Error('Missing direct chat catch-up input')};

    const myMembershipRes=await sb.from('conversation_members').select(fields.member).eq('user_id',userId);
    if(myMembershipRes.error)return {ok:false,error:myMembershipRes.error};

    const ownMemberships=myMembershipRes.data||[];
    const visibleMemberships=ownMemberships.filter(item=>!item.hidden_at);
    const conversationIds=visibleMemberships.map(item=>item.conversation_id);
    if(!conversationIds.length){
      state.conversations=[];
      state.conversationMembers=(state.conversationMembers||[]).filter(member=>!same(member.user_id,userId));
      state.liveMessages=[];
      return {ok:true,conversationIds:[],messageCount:0};
    }

    const [conversationRes,memberRes,messageRes]=await Promise.all([
      sb.from('conversations').select(fields.conversation).in('id',conversationIds).order('updated_at',{ascending:false}),
      sb.from('conversation_members').select(fields.member).in('conversation_id',conversationIds),
      sb.from('messages').select(fields.message).in('conversation_id',conversationIds).order('created_at',{ascending:false}).limit(200)
    ]);

    if(!conversationRes.error){
      const existingById=new Map((state.conversations||[]).map(item=>[String(item.id),item]));
      state.conversations=(conversationRes.data||[]).map(row=>({...existingById.get(String(row.id)),...row}));
    }

    if(!memberRes.error){
      const visibleSet=new Set(conversationIds.map(String));
      const keep=(state.conversationMembers||[]).filter(member=>!visibleSet.has(String(member.conversation_id)));
      state.conversationMembers=[
        ...keep,
        ...(memberRes.data||[]).map(member=>({
          ...member,
          profile:typeof profileData==='function'?profileData(member.user_id):member.profile
        }))
      ];
    }

    if(!messageRes.error){
      const clearedByConversation=new Map(
        ownMemberships.filter(item=>item.cleared_at).map(item=>[
          String(item.conversation_id),
          new Date(item.cleared_at).getTime()
        ])
      );
      const incoming=(messageRes.data||[]).filter(message=>{
        const cleared=clearedByConversation.get(String(message.conversation_id));
        return !cleared||new Date(message.created_at).getTime()>cleared;
      });
      const visibleSet=new Set(conversationIds.map(String));
      const kept=(state.liveMessages||[]).filter(message=>visibleSet.has(String(message.conversation_id)));
      state.liveMessages=mergeById(kept,incoming);
    }

    return {
      ok:!conversationRes.error&&!memberRes.error&&!messageRes.error,
      conversationIds,
      messageCount:(messageRes.data||[]).length,
      errors:{
        conversations:conversationRes.error||null,
        members:memberRes.error||null,
        messages:messageRes.error||null
      }
    };
  }

  async function catchUpCircle({sb,userId,state,profileData,isAdmin=false}={}){
    if(!sb||!userId||!state)return {ok:false,error:new Error('Missing Circle chat catch-up input')};
    const joinedCircleIds=isAdmin
      ?(state.circleRows||[]).map(circle=>circle.id)
      :(state.circleMembers||[])
        .filter(member=>same(member.user_id,userId)&&['active','muted'].includes(member.status))
        .map(member=>member.circle_id);

    if(!joinedCircleIds.length)return {ok:true,joinedCircleIds,messageCount:0,error:null};

    const result=await sb.from('circle_messages')
      .select(fields.circleMessage)
      .in('circle_id',joinedCircleIds)
      .order('created_at',{ascending:false})
      .limit(200);

    if(!result.error){
      const allowed=new Set(joinedCircleIds.map(String));
      const kept=(state.circleMessages||[]).filter(message=>allowed.has(String(message.circle_id)));
      const incoming=(result.data||[]).map(message=>({
        ...message,
        profile:typeof profileData==='function'?profileData(message.sender_id):message.profile
      }));
      state.circleMessages=mergeById(kept,incoming);
    }

    return {ok:!result.error,joinedCircleIds,messageCount:(result.data||[]).length,error:result.error||null};
  }

  window.NEISChatBootstrapData={
    version:'181.1',
    loadDirect,
    loadCircle,
    catchUpDirect,
    catchUpCircle
  };
})();
