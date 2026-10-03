/* NEIS Circle message state mutations — pure realtime state updates without DOM work. */
(function(){
  const same=(a,b)=>String(a)===String(b);
  const sortedByCreatedAt=list=>list.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));

  function applyDirectMessage(state,payload,{visible=true}={}){
    const event=payload?.eventType||'';
    const incoming=payload?.new||{},oldRow=payload?.old||{};
    const id=incoming.id||oldRow.id;
    if(!id)return {changed:false,event,id:'',conversationId:''};
    const list=Array.isArray(state.liveMessages)?state.liveMessages:[];
    const index=list.findIndex(message=>same(message.id,id));
    const previous=index>=0?list[index]:null;
    const conversationId=incoming.conversation_id||previous?.conversation_id||oldRow.conversation_id;
    if(!conversationId||!visible)return {changed:false,event,id,conversationId};

    let newlyInserted=false;
    if(event==='DELETE'){
      if(index>=0)list.splice(index,1);
      else return {changed:false,event,id,conversationId};
    }else if(event==='INSERT'||event==='UPDATE'){
      const merged={...(previous||{}),...incoming};
      if(index>=0)list[index]=merged;
      else{list.push(merged);newlyInserted=event==='INSERT'}
    }else return {changed:false,event,id,conversationId};

    state.liveMessages=sortedByCreatedAt(list);
    return {changed:true,event,id,conversationId,incoming,previous,newlyInserted};
  }

  function applyCircleMessage(state,payload,{allowed=true,profile=null}={}){
    const event=payload?.eventType||'';
    const incoming=payload?.new||{},oldRow=payload?.old||{};
    const id=incoming.id||oldRow.id;
    if(id==null)return {changed:false,event,id:null,circleId:''};
    const list=Array.isArray(state.circleMessages)?state.circleMessages:[];
    const index=list.findIndex(message=>same(message.id,id));
    const previous=index>=0?list[index]:null;
    const circleId=incoming.circle_id||previous?.circle_id||oldRow.circle_id;
    if(!circleId||!allowed)return {changed:false,event,id,circleId};

    let newlyInserted=false;
    if(event==='DELETE'){
      if(index>=0)list.splice(index,1);
      else return {changed:false,event,id,circleId};
    }else if(event==='INSERT'||event==='UPDATE'){
      const merged={...(previous||{}),...incoming,profile:profile||previous?.profile||null};
      if(index>=0)list[index]=merged;
      else{list.push(merged);newlyInserted=event==='INSERT'}
    }else return {changed:false,event,id,circleId};

    state.circleMessages=sortedByCreatedAt(list);
    return {changed:true,event,id,circleId,incoming,previous,newlyInserted};
  }

  function applyMessageReaction(state,payload){
    const event=payload?.eventType||'';
    const row=event==='DELETE'?(payload?.old||{}):(payload?.new||{});
    const id=row.id;
    if(id==null)return {changed:false,event,id:null};
    const list=Array.isArray(state.messageReactions)?state.messageReactions:[];
    const index=list.findIndex(item=>same(item.id,id));
    if(event==='DELETE'){
      if(index<0)return {changed:false,event,id};
      list.splice(index,1);
    }else if(event==='INSERT'||event==='UPDATE'){
      const merged={...(index>=0?list[index]:{}),...row};
      if(index>=0)list[index]=merged;else list.push(merged);
    }else return {changed:false,event,id};
    state.messageReactions=list;
    return {changed:true,event,id,row};
  }

  function applyConversationMember(state,payload,{profile=null}={}){
    const event=payload?.eventType||'';
    const row=event==='DELETE'?(payload?.old||{}):(payload?.new||{});
    const conversationId=row.conversation_id,userId=row.user_id;
    if(!conversationId||!userId)return {changed:false,event,conversationId,userId};
    const list=Array.isArray(state.conversationMembers)?state.conversationMembers:[];
    const index=list.findIndex(member=>same(member.conversation_id,conversationId)&&same(member.user_id,userId));
    const previous=index>=0?list[index]:null;
    if(event==='DELETE'){
      if(index>=0)list.splice(index,1);
      else return {changed:false,event,conversationId,userId,previous};
    }else if(event==='INSERT'||event==='UPDATE'){
      const merged={...(previous||{}),...row,profile:profile||previous?.profile||null};
      if(index>=0)list[index]=merged;else list.push(merged);
    }else return {changed:false,event,conversationId,userId,previous};
    state.conversationMembers=list;
    return {changed:true,event,conversationId,userId,row,previous};
  }

  window.NEISMessageState={
    version:'177.0',
    applyDirectMessage,
    applyCircleMessage,
    applyMessageReaction,
    applyConversationMember
  };
})();
