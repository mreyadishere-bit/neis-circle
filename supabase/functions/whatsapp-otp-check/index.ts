import { corsHeaders,response,normalizePhone,context,twilio,assertIdentityAllowed,enforceRate,publicError } from '../_shared/whatsapp.ts';

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'method_not_allowed'},405);
  try{
    const {phone:raw,code:rawCode}=await req.json();
    const phone=normalizePhone(raw),code=String(rawCode||'').replace(/\D/g,'');
    if(!phone)throw new Error('invalid_phone');
    if(!/^\d{4,10}$/.test(code))throw new Error('invalid_or_expired_code');
    const {user,admin}=await context(req);
    await assertIdentityAllowed(admin,user,phone);
    await enforceRate(admin,user.id,phone,'verify');
    const provider=twilio();
    const form=new URLSearchParams({To:phone,Code:code});
    const result=await fetch(`https://verify.twilio.com/v2/Services/${provider.serviceSid}/VerificationCheck`,{method:'POST',headers:{Authorization:provider.authorization,'Content-Type':'application/x-www-form-urlencoded'},body:form});
    const payload=await result.json().catch(()=>({}));
    if(!result.ok||payload.status!=='approved')throw new Error('invalid_or_expired_code');
    const now=new Date().toISOString();
    const {error}=await admin.from('private_user_identities').upsert({user_id:user.id,normalized_email:String(user.email||'').toLowerCase(),email_verified_at:user.email_confirmed_at||now,phone_e164:phone,phone_verified_at:now,verification_required:false,updated_at:now},{onConflict:'user_id'});
    if(error)throw error;
    const {data:event}=await admin.from('otp_rate_events').select('id').eq('user_id',user.id).eq('phone_e164',phone).eq('action','verify').order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(event?.id)await admin.from('otp_rate_events').update({succeeded:true}).eq('id',event.id);
    return response({ok:true,verified_at:now});
  }catch(error){const code=publicError(error);return response({error:code},code==='authentication_required'?401:code.includes('rate_limited')?429:code==='identity_blocked'?403:400)}
});
