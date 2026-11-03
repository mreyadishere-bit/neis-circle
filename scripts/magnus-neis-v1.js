/* Magnus — private AI conversation in NEIS Circle Messages, never Circle chat. */
(function(){
  'use strict';
  const BOT='magnus';
  const state={messages:[],loadedFor:null,busy:false,error:'',loading:false};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const formatTime=date=>{
    try{return new Date(date).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}
    catch{return ''}
  };
  const title=lang=>lang==='ar'?'ماجنوس':'Magnus';
  const botThread=lang=>`<button type="button" class="thread magnus-thread" data-magnus-open>
    <span class="magnus-avatar" aria-hidden="true">✦</span>
    <div><b>${title(lang)}</b><small>${lang==='ar'?'مساعد ذكاء اصطناعي خاص':'Private AI companion'}</small></div>
    <span class="magnus-ai-tag">AI</span>
  </button>`;
  const welcome=lang=>lang==='ar'
    ?'أنا ماجنوس ✦ اسألني، اهزر معايا، أو خلّيني أساعدك في المذاكرة. دي محادثة خاصة بينك وبيني.'
    :"I'm Magnus ✦ Ask me anything, joke around, or get help studying. This chat is private to you.";
  function bubble(item){
    const mine=item.role==='user';
    return `<div class="magnus-line ${mine?'mine':'bot'}"><span class="magnus-bubble">
      <span class="magnus-text" dir="auto">${esc(item.body)}</span>
      ${item.reaction&&!mine?`<span class="magnus-reaction" aria-label="Reaction">${esc(item.reaction)}</span>`:''}
      <time>${formatTime(item.created_at)}</time>
    </span></div>`;
  }
  function flowMarkup(lang){
    const rows=state.messages;
    return `<div class="magnus-scroll" id="magnusFlow" role="log" aria-live="polite">
      <div class="magnus-intro"><div class="magnus-intro-mark">✦</div>
        <strong>Magnus</strong><p>${welcome(lang)}</p></div>
      ${rows.map(bubble).join('')}
      ${state.loading?'<div class="magnus-loading">Loading conversation…</div>':''}
      ${state.busy?'<div class="magnus-typing" role="status">Magnus is thinking <span>● ● ●</span></div>':''}
      ${state.error?`<div class="magnus-error" role="alert">${esc(state.error)}</div>`:''}
    </div>`;
  }
  function panel(lang){
    return `<div class="chat magnus-chat">
      <div class="chat-head magnus-head">
        <button type="button" class="round-btn" data-magnus-back aria-label="Back to messages">←</button>
        <span class="magnus-avatar" aria-hidden="true">✦</span>
        <div class="magnus-identity"><b>Magnus</b><small>${lang==='ar'?'محادثة خاصة · ذكاء اصطناعي':'Private conversation · AI'}</small></div>
        <button type="button" class="magnus-clear" data-magnus-clear>${lang==='ar'?'مسح المحادثة':'Clear chat'}</button>
      </div>
      ${flowMarkup(lang)}
      <form class="chat-form magnus-form" id="magnusForm">
        <textarea id="magnusInput" maxlength="2400" rows="1" required autocomplete="off"
          placeholder="${lang==='ar'?'اكتب لماجنوس…':'Message Magnus…'}" aria-label="Message Magnus"></textarea>
        <button type="submit" aria-label="Send to Magnus" id="magnusSend">→</button>
      </form>
      <span class="magnus-note">${lang==='ar'?'المحادثة دي مش ضمن المجتمعات أو رسائل الطلاب.':'Not connected to Circles or other students’ DMs.'}</span>
    </div>`;
  }
  function integrate(html,{lang='en',active=false}={}){
    let result=String(html);
    if(active){
      result=result.replace(/<section class="messages [^"]*">/,
        '<section class="messages mobile-thread-open">');
      result=result.replace(/<div class="chat">[\s\S]*<\/div><\/section>$/,
        panel(lang)+'</section>');
      result=result.replace(/class="thread active"/g,'class="thread"');
    }
    return result.replace('<div class="thread-list-scroll">',
      '<div class="thread-list-scroll">'+botThread(lang).replace('magnus-thread',
        'magnus-thread'+(active?' active':'')));
  }
  function scroll(){
    const el=document.getElementById('magnusFlow');
    if(el)el.scrollTop=el.scrollHeight;
  }
  function refresh(){
    const el=document.getElementById('magnusFlow');
    if(!el)return;
    const oldTop=el.scrollTop;
    const stick=el.scrollHeight-el.clientHeight-el.scrollTop<110;
    const fragment=document.createElement('template');
    fragment.innerHTML=flowMarkup(document.documentElement.lang==='ar'?'ar':'en');
    el.innerHTML=fragment.content.firstElementChild?.innerHTML||'';
    if(stick)scroll();else el.scrollTop=oldTop;
    const send=document.getElementById('magnusSend');
    if(send)send.disabled=state.busy;
  }
  async function load(sb,user){
    if(!user||state.loading||state.loadedFor===user.id)return;
    state.messages=[];state.error='';state.loadedFor=null;state.loading=true;refresh();
    const result=await sb.from('magnus_messages')
      .select('id,role,body,reaction,created_at').order('created_at',{ascending:false}).limit(80);
    state.loading=false;
    if(result.error){state.error='Could not load this conversation. Please reopen Magnus.'}
    else{state.messages=(result.data||[]).reverse();state.loadedFor=user.id}
    refresh();
  }
  async function send(sb,user,input){
    const message=input.value.trim();
    if(!message||state.busy||!user)return;
    state.busy=true;state.error='';
    const requestId=crypto.randomUUID();
    const pending={id:requestId,role:'user',body:message,reaction:null,created_at:new Date().toISOString()};
    state.messages.push(pending);input.value='';refresh();scroll();
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),36000);
    try{
      const result=await sb.functions.invoke('magnus-chat',
        {body:{message,request_id:requestId},signal:controller.signal});
      if(result.error){
        const context=await result.error.context?.json?.().catch(()=>null);
        throw new Error(context?.error||result.error.message||'Magnus is unavailable');
      }
      if(!result.data?.reply)throw new Error('Magnus returned an empty reply.');
      state.messages.push({id:'assistant-'+requestId,role:'assistant',
        body:String(result.data.reply),reaction:result.data.reaction||null,
        created_at:new Date().toISOString()});
    }catch(error){
      state.messages=state.messages.filter(item=>item!==pending);
      input.value=message;
      state.error=error?.name==='AbortError'?'Magnus did not respond in time. Try sending again.':
        String(error?.message||'Magnus could not reply. Please retry.').slice(0,220);
    }finally{
      clearTimeout(timer);state.busy=false;refresh();scroll();
      input.focus({preventScroll:true});
    }
  }
  function bind(root,{sb,user,routeTo,lang}={}){
    const btn=root.querySelector('[data-magnus-open]');
    if(btn)btn.addEventListener('click',()=>routeTo('messages/'+BOT));
    const back=root.querySelector('[data-magnus-back]');
    if(back)back.onclick=()=>routeTo('messages');
    const input=root.querySelector('#magnusInput');
    const form=root.querySelector('#magnusForm');
    if(!form||!input||!user)return;
    form.addEventListener('submit',event=>{
      event.preventDefault();void send(sb,user,input);
    });
    input.addEventListener('keydown',event=>{
      if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){
        event.preventDefault();form.requestSubmit();
      }
    });
    const clear=root.querySelector('[data-magnus-clear]');
    if(clear)clear.onclick=async()=>{
      if(state.busy)return;
      if(!window.confirm(lang==='ar'?'مسح محادثة ماجنوس الخاصة نهائيًا؟':'Clear your private Magnus conversation permanently?'))return;
      clear.disabled=true;
      const result=await sb.rpc('magnus_clear_my_chat');
      if(result.error){state.error=result.error.message}
      else{state.messages=[];state.error='';state.loadedFor=user.id}
      clear.disabled=false;refresh();
    };
    if(state.loadedFor!==user.id)void load(sb,user);
    else requestAnimationFrame(scroll);
  }
  window.NEISMagnus={integrate,bind};
})();
