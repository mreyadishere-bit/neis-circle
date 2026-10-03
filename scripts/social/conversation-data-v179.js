/* NEIS Circle conversation data runtime — deduped Supabase hydration without DOM work. */
(function(){
  const inflight=new Map();
  const same=(a,b)=>String(a)===String(b);

  function upsertById(list,row){
    const items=Array.isArray(list)?list:[];
    const index=items.findIndex(item=>same(item.id,row?.id));
    if(index>=0)items[index]={...items[index],...row};
    else items.unshift(row);
    return items;
  }

  async function hydrate(conversationId,{sb,userId,state,profileData}={}){
    if(!sb||!userId||!conversationId||!state)return {ok:false,reason:'missing-input'};
    const key=String(conversationId);
    if(inflight.has(key))return inflight.get(key);

    const task=(async()=>{
      try{
        const [conversationRes,membersRes,messagesRes]=await Promise.all([
          sb.from('conversations').select('*').eq('id',conversationId).maybeSingle(),
          sb.from('conversation_members').select('*').eq('conversation_id',conversationId),
          sb.from('messages').select('*').eq('conversation_id',conversationId).order('created_at',{ascending:false}).limit(200)
        ]);
        if(conversationRes.error||!conversationRes.data){
          return {ok:false,reason:'conversation',error:conversationRes.error||null};
        }

        const members=membersRes.error?[]:(membersRes.data||[]).map(member=>({
          ...member,
          profile:typeof profileData==='function'?profileData(member.user_id):member.profile
        }));
        const mine=members.find(member=>same(member.user_id,userId));

        state.conversationMembers=[
          ...(state.conversationMembers||[]).filter(member=>!same(member.conversation_id,conversationId)),
          ...members
        ];

        if(!mine||mine.hidden_at){
          state.conversations=(state.conversations||[]).filter(item=>!same(item.id,conversationId));
          state.liveMessages=(state.liveMessages||[]).filter(item=>!same(item.conversation_id,conversationId));
          return {ok:true,hidden:true,conversationId};
        }

        state.conversations=upsertById(state.conversations,conversationRes.data);

        if(!messagesRes.error){
          const cleared=mine.cleared_at?new Date(mine.cleared_at).getTime():0;
          const rows=(messagesRes.data||[]).filter(message=>!cleared||new Date(message.created_at).getTime()>cleared);
          state.liveMessages=[
            ...(state.liveMessages||[]).filter(message=>!same(message.conversation_id,conversationId)),
            ...rows
          ].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
        }

        return {
          ok:true,
          hidden:false,
          conversationId,
          membersCount:members.length,
          messageCount:(state.liveMessages||[]).filter(message=>same(message.conversation_id,conversationId)).length
        };
      }finally{
        inflight.delete(key);
      }
    })();

    inflight.set(key,task);
    return task;
  }

  function snapshot(){
    return {version:'179.0',inflight:[...inflight.keys()]};
  }

  window.NEISConversationData={
    version:'179.0',
    hydrate,
    snapshot
  };
})();
