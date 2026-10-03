/* NEIS Circle chat bootstrap data runtime — owns initial DM/Circle chat loading without DOM work. */
(function(){
  const same=(a,b)=>String(a)===String(b);

  async function loadDirect({sb,userId,state,profileData}={}){
    if(!sb||!userId||!state)return {ok:false,error:new Error('Missing direct chat bootstrap input')};

    const myMembershipRes=await sb.from('conversation_members').select('*').eq('user_id',userId);
    if(myMembershipRes.error)return {ok:false,error:myMembershipRes.error};

    const ownConversationMemberships=myMembershipRes.data||[];
    const conversationIds=ownConversationMemberships.filter(x=>!x.hidden_at).map(x=>x.conversation_id);

    let conversationRes={data:[],error:null},memberRes={data:[],error:null},messageRes={data:[],error:null};
    if(conversationIds.length){
      [conversationRes,memberRes,messageRes]=await Promise.all([
        sb.from('conversations').select('*').in('id',conversationIds).order('updated_at',{ascending:false}),
        sb.from('conversation_members').select('*').in('conversation_id',conversationIds),
        sb.from('messages').select('*').in('conversation_id',conversationIds).order('created_at',{ascending:false}).limit(200)
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
      .select('*')
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

  window.NEISChatBootstrapData={
    version:'181.0',
    loadDirect,
    loadCircle
  };
})();
