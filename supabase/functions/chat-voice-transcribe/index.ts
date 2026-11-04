import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "https://esm.sh/@supabase/supabase-js@2.57.4";

const HEADERS={
 "content-type":"application/json; charset=utf-8",
 "access-control-allow-origin":"*",
 "access-control-allow-methods":"POST,OPTIONS",
 "access-control-allow-headers":"authorization,apikey,content-type,x-client-info",
};
const respond=(data:Record<string,unknown>,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const limits=new Map<string,{count:number,window:number}>();
const MIN_CLIP=1000, MAX_BASE64=1800000;
Deno.serve(async(request:Request)=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:HEADERS});
 if(request.method!=="POST")return respond({error:"Method not allowed"},405);
 try{
  const jwt=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  const url=Deno.env.get("SUPABASE_URL")||"";
  const anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
  const key=Deno.env.get("GEMINI_API_KEY")||"";
  if(!jwt||!url||!anon)return respond({error:"Authentication required"},401);
  if(!key)return respond({error:"Transcription provider unavailable",code:"NOT_CONFIGURED"},503);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+jwt}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await userClient.auth.getUser(jwt);
  if(authError||!user)return respond({error:"Authentication required"},401);
  const now=Date.now(),prior=limits.get(user.id);
  const usage=prior&&now-prior.window<60000?prior:{count:0,window:now};
  // Four-second clips produce about fifteen requests per minute while dictating.
  // Bound bursts without blocking normal continuous speech.
  if(usage.count>=24)return respond({error:"Voice transcription rate limit. Try again shortly.",code:"RATE_LIMIT"},429);
  const body=await request.json().catch(()=>null);
  const mime=String(body?.mimeType||"").split(";")[0].toLowerCase();
  const supported=["audio/webm","audio/ogg","audio/mp4"];
  const audio=typeof body?.audio==="string"?body.audio:"";
  if(!supported.includes(mime)||audio.length<MIN_CLIP||audio.length>MAX_BASE64||! /^[A-Za-z0-9+/]*={0,2}$/.test(audio))
   return respond({error:"Invalid or oversized audio clip"},400);
  usage.count++;limits.set(user.id,usage);
  if(limits.size>2000){for(const [id,item] of limits){if(now-item.window>60000)limits.delete(id)}}
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),18000);
  let response:Response;
  try{
   response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",{
    method:"POST",signal:controller.signal,
    headers:{"x-goog-api-key":key,"content-type":"application/json"},
    body:JSON.stringify({
     contents:[{role:"user",parts:[
      {text:"Transcribe the speech verbatim. Automatically detect Arabic and English, including Egyptian Arabic and mixed Arabic-English sentences. Keep each word in the language actually spoken. Preserve proper nouns, technical terms and numbers. Output ONLY the transcript, with no commentary. If there is no audible speech, output an empty string."},
      {inlineData:{mimeType:mime,data:audio}},
     ]}],
     generationConfig:{temperature:0,maxOutputTokens:1000,thinkingConfig:{thinkingLevel:"minimal"}},
    }),
   });
  }finally{clearTimeout(timeout)}
  if(!response.ok){
   const code=response.status===429?"PROVIDER_LIMIT":"PROVIDER_ERROR";
   return respond({error:"Transcription temporarily unavailable",code},response.status===429?429:503);
  }
  const json=await response.json();
  const transcript=(json?.candidates?.[0]?.content?.parts||[]).map((p:{text?:string})=>p.text||"").join("").trim().replace(/^["'`]+|["'`]+$/g,"").slice(0,2400);
  return respond({text:transcript});
 }catch(error){
  console.error("VOICE_TRANSCRIBE_FAILED",error instanceof Error?error.name:"unknown");
  return respond({error:"Speech transcription failed; retry without losing your draft",code:"TRANSCRIPTION_ERROR"},503);
 }
});
