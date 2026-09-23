import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const corsHeaders={
  'Access-Control-Allow-Origin':'https://neiscircle.site',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
export function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}})}
export function normalizePhone(value:unknown){
  const phone=String(value||'').replace(/[\s().-]/g,'');
  return /^\+[1-9][0-9]{7,14}$/.test(phone)?phone:'';
}
export async function context(req:Request){
  const url=Deno.env.get('SUPABASE_URL')!;
  const anon=Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authorization=req.headers.get('Authorization')||'';
  const userClient=createClient(url,anon,{global:{headers:{Authorization:authorization}}});
  const {data:{user},error}=await userClient.auth.getUser();
  if(error||!user)throw new Error('authentication_required');
  return {user,admin:createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})};
}
export function twilio(){
  const accountSid=Deno.env.get('TWILIO_ACCOUNT_SID')||'';
  const authToken=Deno.env.get('TWILIO_AUTH_TOKEN')||'';
  const serviceSid=Deno.env.get('TWILIO_VERIFY_SERVICE_SID')||'';
  if(!accountSid||!authToken||!serviceSid)throw new Error('verification_provider_not_configured');
  return {accountSid,authToken,serviceSid,authorization:'Basic '+btoa(accountSid+':'+authToken)};
}
export async function assertIdentityAllowed(admin:any,user:any,phone:string){
  const email=String(user.email||'').trim().toLowerCase();
  const {data:blocked}=await admin.from('blocked_accounts').select('id').or(`email.eq.${email},phone_e164.eq.${phone},user_id.eq.${user.id}`).limit(1);
  if(blocked?.length)throw new Error('identity_blocked');
  const {data:duplicate}=await admin.from('private_user_identities').select('user_id').eq('phone_e164',phone).neq('user_id',user.id).maybeSingle();
  if(duplicate)throw new Error('phone_already_registered');
}
export async function enforceRate(admin:any,userId:string,phone:string,action:'send'|'verify'){
  const minutes=action==='send'?10:15;
  const limit=action==='send'?3:8;
  const since=new Date(Date.now()-minutes*60_000).toISOString();
  const {count}=await admin.from('otp_rate_events').select('id',{count:'exact',head:true}).eq('phone_e164',phone).eq('action',action).gte('created_at',since);
  if((count||0)>=limit)throw new Error(action==='send'?'otp_send_rate_limited':'otp_attempt_rate_limited');
  await admin.from('otp_rate_events').insert({user_id:userId,phone_e164:phone,action,succeeded:false});
}
export function publicError(error:unknown){
  const value=String((error as Error)?.message||error||'');
  const allowed=['authentication_required','invalid_phone','identity_blocked','phone_already_registered','otp_send_rate_limited','otp_attempt_rate_limited','invalid_or_expired_code','verification_provider_not_configured'];
  return allowed.includes(value)?value:'verification_failed';
}
