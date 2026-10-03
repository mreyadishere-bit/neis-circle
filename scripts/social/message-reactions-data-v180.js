/* NEIS Circle message reaction loader — fetch only reactions for messages currently loaded in memory. */
(function(){
  const CHUNK_SIZE=100;

  function uniqueIds(values){
    return [...new Set((values||[]).filter(value=>value!==null&&value!==undefined&&String(value)!=='').map(String))];
  }

  function chunks(values,size=CHUNK_SIZE){
    const out=[];
    for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));
    return out;
  }

  async function load({sb,dmMessageIds=[],circleMessageIds=[]}={}){
    if(!sb)return {data:[],error:new Error('Missing Supabase client')};
    const dmIds=uniqueIds(dmMessageIds),circleIds=uniqueIds(circleMessageIds);
    if(!dmIds.length&&!circleIds.length)return {data:[],error:null};

    const tasks=[];
    for(const ids of chunks(dmIds)){
      tasks.push(sb.from('message_reactions').select('*').in('dm_message_id',ids).order('created_at'));
    }
    for(const ids of chunks(circleIds)){
      tasks.push(sb.from('message_reactions').select('*').in('circle_message_id',ids).order('created_at'));
    }

    const results=await Promise.all(tasks);
    const firstError=results.find(result=>result?.error)?.error||null;
    if(firstError)return {data:[],error:firstError};

    const seen=new Set(),data=[];
    for(const result of results){
      for(const row of (result?.data||[])){
        const key=String(row.id);
        if(seen.has(key))continue;
        seen.add(key);
        data.push(row);
      }
    }
    data.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    return {data,error:null};
  }

  function idsFromState(state){
    return {
      dmMessageIds:(state?.liveMessages||[]).map(message=>message.id),
      circleMessageIds:(state?.circleMessages||[]).map(message=>message.id)
    };
  }

  window.NEISMessageReactionData={
    version:'180.0',
    load,
    idsFromState,
    chunkSize:CHUNK_SIZE
  };
})();
