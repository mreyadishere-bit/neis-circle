// Read-only diagnostic of existing accounts; creates and promptly deletes a synthetic test user.
// This script runs inside the OVH Edge container so credentials never leave the server.
const base=(Deno.env.get("SUPABASE_URL")||"").replace(/\/$/,"");
const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
const email="magnus-qa-"+crypto.randomUUID()+"@example.invalid";
const pass="T!"+crypto.randomUUID()+"Qa9";
const adminHeaders={"Content-Type":"application/json",apikey:service,Authorization:"Bearer "+service};
async function call(path,method,body,headers=adminHeaders){
 try{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),42000);
  try{
   const response=await fetch(base+path,{
    method,headers,body:body?JSON.stringify(body):undefined,signal:controller.signal});
   return {status:response.status,data:await response.json().catch(()=>({}))};
  }finally{clearTimeout(timer)}
 }catch(error){
  return {status:0,data:{code:error?.name||"network_error"}};
 }
}
let userId=null;
try{
 const created=await call("/auth/v1/admin/users","POST",
  {email,password:pass,email_confirm:true});
 console.log("MAGNUS_E2E_CREATE_STATUS="+created.status);
 userId=created.data?.id||created.data?.user?.id||null;
 if(created.status>=300||!userId)Deno.exit(0);
 const login=await call("/auth/v1/token?grant_type=password","POST",{email,password:pass},
  {"Content-Type":"application/json",apikey:anon});
 console.log("MAGNUS_E2E_LOGIN_STATUS="+login.status);
 if(login.status!==200||!login.data?.access_token)Deno.exit(0);
 const result=await call("/functions/v1/magnus-chat","POST",
  {message:"Hi",request_id:crypto.randomUUID()},
  {"Content-Type":"application/json",apikey:anon,Authorization:"Bearer "+login.data.access_token});
 console.log("MAGNUS_E2E_REPLY_STATUS="+result.status);
 console.log("MAGNUS_E2E_REPLY_CODE="+String(result.data?.code||"none").slice(0,40).replace(/[^a-z0-9_]/gi,""));
 console.log("MAGNUS_E2E_HAS_REPLY="+String(typeof result.data?.reply==="string"));
}finally{
 if(userId){
  const deleted=await call("/auth/v1/admin/users/"+encodeURIComponent(userId),"DELETE");
  console.log("MAGNUS_E2E_CLEANUP_STATUS="+deleted.status);
 }
}
