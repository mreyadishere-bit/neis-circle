import { corsHeaders,response,normalizePhone,context,twilio,assertIdentityAllowed,enforceRate,publicError } from '../_shared/whatsapp.ts';

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'method_not_allowed'},405);
  try{
    const {phone:raw}=await req.json();
    const phone=normalizePhone(raw);if(!phone)throw new Error('invalid_phone');
    const {user,admin}=await context(req);
    await assertIdentityAllowed(admin,user,phone);
    await enforceRate(admin,user.id,phone,'send');
    const provider=twilio();
    const form=new URLSearchParams({To:phone,Channel:'whatsapp'});
    const result=await fetch(`https://verify.twilio.com/v2/Services/${provider.serviceSid}/Verifications`,{method:'POST',headers:{Authorization:provider.authorization,'Content-Type':'application/x-www-form-urlencoded'},body:form});
    if(!result.ok)throw new Error('verification_failed');
    return response({ok:true});
  }catch(error){const code=publicError(error);return response({error:code},code==='authentication_required'?401:code.includes('rate_limited')?429:code==='identity_blocked'?403:400)}
});
