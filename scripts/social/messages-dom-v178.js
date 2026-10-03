/* NEIS Circle DM DOM patching — targeted thread/message updates without page rerenders. */
(function(){
  const same=(a,b)=>String(a)===String(b);

  function createRuntime(deps){
    const {
      state,document,CSS,requestAnimationFrame,
      conversationIsVisible,dmThreadMarkup,messageBubble,circleMessageBubble,emptyState,t,bindV6,sortConversations
    }=deps||{};

    function activeMessages(){
      return (state?.liveMessages||[])
        .filter(message=>same(message.conversation_id,state?.activeConversationId)&&!message.deleted_at)
        .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    }

    function patchThread(conversationId){
      if(state?.view!=='messages')return false;
      const id=String(conversationId||'');if(!id)return false;
      const container=document?.querySelector?.('.thread-list-scroll');
      if(!container)return false;
      const conversation=(state.conversations||[]).find(item=>same(item.id,id));
      let node=container.querySelector('[data-open-conversation="'+CSS.escape(id)+'"]');
      if(!conversation||!conversationIsVisible(id)){
        node?.remove();
        return true;
      }
      const template=document.createElement('template');
      template.innerHTML=dmThreadMarkup(conversation).trim();
      const replacement=template.content.firstElementChild;
      if(!replacement)return false;
      if(node)node.replaceWith(replacement);
      else{
        container.querySelector('.empty')?.remove();
        container.prepend(replacement);
      }
      bindV6(container);
      sortConversations();
      const order=new Map((state.conversations||[]).map((item,index)=>[String(item.id),index]));
      [...container.querySelectorAll('[data-open-conversation]')]
        .sort((a,b)=>(order.get(String(a.dataset.openConversation))??9999)-(order.get(String(b.dataset.openConversation))??9999))
        .forEach(item=>container.appendChild(item));
      return true;
    }

    function patchActiveFlow({insertedId='',force=false}={}){
      if(state?.view!=='messages'||!state?.activeConversationId)return false;
      const flow=document?.querySelector?.('#chatFlow');if(!flow)return false;
      const wasNearBottom=flow.scrollHeight-flow.scrollTop-flow.clientHeight<90;
      const messages=activeMessages();
      const inserted=insertedId?messages.find(item=>same(item.id,insertedId)):null;
      const existing=insertedId?flow.querySelector('[data-message-id="'+CSS.escape(String(insertedId))+'"]'):null;

      if(inserted&&existing&&!force){
        if(wasNearBottom)requestAnimationFrame(()=>{flow.scrollTop=flow.scrollHeight});
        return true;
      }
      if(inserted&&!existing&&!force){
        const index=messages.findIndex(item=>same(item.id,inserted.id));
        const previous=index>0?messages[index-1]:null;
        flow.insertAdjacentHTML('beforeend',messageBubble(inserted,previous));
        const added=flow.lastElementChild;
        if(added)bindV6(added);
      }else{
        const bottomOffset=flow.scrollHeight-flow.scrollTop-flow.clientHeight;
        flow.innerHTML=messages.length
          ?messages.map((message,index)=>messageBubble(message,messages[index-1])).join('')
          :emptyState(t('No messages yet','لا توجد رسائل بعد'),t('Send the first message.','أرسل أول رسالة.'));
        bindV6(flow);
        if(!wasNearBottom)requestAnimationFrame(()=>{
          flow.scrollTop=Math.max(0,flow.scrollHeight-flow.clientHeight-bottomOffset);
        });
      }
      if(wasNearBottom)requestAnimationFrame(()=>{flow.scrollTop=flow.scrollHeight});
      return true;
    }

    function patchCircleFlow({circleId,id,event,newlyInserted=false}={}){
      if(state?.view!=='circle-detail'||state?.circleTab!=='chat'||!same(state?.activeCircleId,circleId))return false;
      const flow=document?.querySelector?.('#circleChatFlow');if(!flow)return false;
      const wasNearBottom=flow.scrollHeight-flow.scrollTop-flow.clientHeight<90;
      const active=(state.circleMessages||[])
        .filter(message=>same(message.circle_id,circleId)&&!message.deleted_at)
        .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
      const inserted=newlyInserted?active.find(item=>same(item.id,id)):null;
      const existing=id!=null?flow.querySelector('[data-message-id="'+CSS.escape(String(id))+'"]'):null;

      if(event==='INSERT'&&existing){
        if(wasNearBottom)requestAnimationFrame(()=>{flow.scrollTop=flow.scrollHeight});
      }else if(inserted&&!existing){
        const pos=active.findIndex(item=>same(item.id,id));
        const previousMessage=pos>0?active[pos-1]:null;
        flow.insertAdjacentHTML('beforeend',circleMessageBubble(inserted,previousMessage));
        if(flow.lastElementChild)bindV6(flow.lastElementChild);
      }else{
        const bottomOffset=flow.scrollHeight-flow.scrollTop-flow.clientHeight;
        flow.innerHTML=active.length
          ?active.map((message,pos)=>circleMessageBubble(message,active[pos-1])).join('')
          :emptyState(t('No messages yet','لا توجد رسائل بعد'),t('Send the first message.','أرسل أول رسالة.'));
        bindV6(flow);
        if(!wasNearBottom)requestAnimationFrame(()=>{
          flow.scrollTop=Math.max(0,flow.scrollHeight-flow.clientHeight-bottomOffset);
        });
      }
      if(wasNearBottom)requestAnimationFrame(()=>{flow.scrollTop=flow.scrollHeight});
      return true;
    }

    return {activeMessages,patchThread,patchActiveFlow,patchCircleFlow};
  }

  window.NEISMessageDom={
    version:'178.0',
    createRuntime
  };
})();
