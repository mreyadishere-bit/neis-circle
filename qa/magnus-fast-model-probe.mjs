const key=Deno.env.get("GEMINI_API_KEY")||"";
if(!key){console.log("MAGNUS_FAST_MODEL=NO_KEY");Deno.exit(1)}
const model="gemini-3.5-flash-lite";
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),13000);
const started=Date.now();
try{
 const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent",{
  signal:controller.signal,method:"POST",
  headers:{"x-goog-api-key":key,"Content-Type":"application/json"},
  body:JSON.stringify({
   contents:[{role:"user",parts:[{text:"Reply with exactly: OK"}]}],
   generationConfig:{maxOutputTokens:48,thinkingConfig:{thinkingLevel:"minimal"}},
  }),
 });
 const raw=await response.json().catch(()=>({}));
 const accepted=Boolean(raw?.candidates?.[0]?.content?.parts?.some(p=>p.text?.trim()));
 console.log("MAGNUS_FAST_MODEL_STATUS="+response.status);
 console.log("MAGNUS_FAST_MODEL_RESPONSE="+(accepted?"VALID":"EMPTY"));
 console.log("MAGNUS_FAST_MODEL_LATENCY_MS="+(Date.now()-started));
 if(response.status!==200||!accepted)Deno.exit(1);
}catch(error){
 console.log("MAGNUS_FAST_MODEL_STATUS=NETWORK_ERROR");
 Deno.exit(1);
}finally{clearTimeout(timer)}
