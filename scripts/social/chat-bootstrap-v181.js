/* NEIS Circle chat bootstrap data — scoped, deduped startup loading without DOM work. */
(function(){
  const inflight=new Map();
  const same=(a,b)=>String(a)===String(b);

  async function load({sb,userId,profileData}={}){
    if(!sb||!userId)return {ok:false,reason:'missing-input'};
    const key=String(userId);
    if(inflight.has(key))return inflight.get(key);

    const task=(async()=>{
      try{
        const membershipRes=await sb.from('conversation_members').select('*').eq('user_id',userId);
        if(membershipRes.error){
          return {ok:false,reason:'memberships',error:membershipRes.error,memberships:[],conversations:[],members:[],messages:[]};
        }
        const memberships=membershipRes.data||[];
        const conversationIds=memberships.filter(row=>!row.hidden_at).map(row=>row.conversation_id);

        if(!conversationIds.length){
          return {ok:true,memberships,conversationIds:[],conversations:[],members:[],messages:[]};
        }

        const [conversationRes,memberRes,messageRes]=await Promise.all([
          sb.from('conversations').select('*').in('id',conversationIds).order('updated_at',{ascending:false}),
          sb.from('conversation_members').select('*').in('conversation_id',conversationIds),
          sb.from('messages').select('*').in('conversation_id',conversationIds).order('created_at',{ascending:false}).limit(200)
        ]);

        const members=memberRes.error
          ?memberships.map(member=>({...member,profile:typeof profileData==='function'?profileData(member.user_id):member.profile}))
          :(memberRes.data||[]).map(member=>({...member,profile:typeof profileData==='function'?profileData(member.user_id):member.profile}));

        const clearedByConversation=new Map(
          memberships
            .filter(row=>row.cleared_at)
            .map(row=>[String(row.conversation_id),new Date(row.cleared_at).getTime()])
        );

        const messages=messageRes.error?[]:(messageRes.data||[])
          .filter(message=>{
            const cleared=clearedByConversation.get(String(message.conversation_id));
            return !cleared||new Date(message.created_at).getTime()>cleared;
          })
          .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));

        return {
          ok:true,
          memberships,
          conversationIds,
          conversations:conversationRes.error?[]:(conversationRes.data||[]),
          members,
          messages,
          errors:{
            conversations:conversationRes.error||null,
            members:memberRes.error||null,
            messages:messageRes.error||null
          }
        };
      }finally{
        inflight.delete(key);
      }
    })();

    inflight.set(key,task);
    return task;
  }

  function applyToState(state,result){
    if(!state||!result?.ok)return false;
    state.conversations=result.conversations||[];
    state.conversationMembers=result.members||[];
    state.liveMessages=result.messages||[];
    return true;
  }

  function snapshot(){
    return {version:'181.0',inflight:[...inflight.keys()]};
  }

  window.NEISChatBootstrapData={
    version:'181.0',
    load,
    applyToState,
    snapshot
  };
})();
