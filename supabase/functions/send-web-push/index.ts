import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import webpush from "npm:web-push@3.6.7";

const db=createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  {auth:{persistSession:false,autoRefreshToken:false}}
);

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST") return new Response("Method Not Allowed",{status:405});
  let body:any={};
  try{body=await req.json()}catch{return new Response("Bad Request",{status:400})}
  const jobId=String(body?.job_id||"");
  const dispatchToken=String(body?.dispatch_token||"");
  if(!/^[0-9a-f-]{36}$/i.test(jobId)||!/^[0-9a-f-]{36}$/i.test(dispatchToken)){
    return new Response("Bad Request",{status:400});
  }

  const nowIso=new Date().toISOString();
  const {data:claimed,error:claimError}=await db
    .from("web_push_outbox")
    .update({status:"sending"})
    .eq("id",jobId)
    .eq("dispatch_token",dispatchToken)
    .in("status",["pending","failed"])
    .lte("next_attempt_at",nowIso)
    .select("*")
    .maybeSingle();

  if(claimError) return Response.json({ok:false,reason:"claim_failed"},{status:500});
  if(!claimed) return Response.json({ok:true,skipped:true});

  const attempt=Number(claimed.attempts||0)+1;
  const {data:keys,error:keyError}=await db.rpc("get_web_push_vapid_keys");
  const keyRow=Array.isArray(keys)?keys[0]:keys;
  if(keyError||!keyRow?.public_key||!keyRow?.private_key){
    await db.from("web_push_outbox").update({
      status:"failed",attempts:attempt,last_error:"vapid_not_configured",
      next_attempt_at:new Date(Date.now()+5*60_000).toISOString()
    }).eq("id",jobId);
    return Response.json({ok:false,reason:"vapid_not_configured"},{status:503});
  }

  webpush.setVapidDetails(
    "mailto:mreyadishere@gmail.com",
    String(keyRow.public_key),
    String(keyRow.private_key)
  );

  const {data:subscriptions,error:subscriptionError}=await db
    .from("web_push_subscriptions")
    .select("id,endpoint,p256dh,auth,device_preferences")
    .eq("user_id",claimed.user_id)
    .eq("enabled",true);

  if(subscriptionError){
    await db.from("web_push_outbox").update({
      status:"failed",attempts:attempt,last_error:"subscription_lookup_failed",
      next_attempt_at:new Date(Date.now()+60_000).toISOString()
    }).eq("id",jobId);
    return Response.json({ok:false,reason:"subscription_lookup_failed"},{status:500});
  }

  if(!subscriptions?.length){
    await db.from("web_push_outbox").update({
      status:"sent",attempts:attempt,sent_at:new Date().toISOString(),last_error:"no_active_subscriptions"
    }).eq("id",jobId);
    return Response.json({ok:true,subscriptions:0});
  }

  const notificationType=String(claimed.notification_type||"");
  const {data:notification}=await db.from("notifications").select("entity_type").eq("id",claimed.notification_id).maybeSingle();
  const entityType=String(notification?.entity_type||"");
  const preferenceKey=(()=>{
    if(notificationType==="message")return "direct_messages";
    if(["reply","comment_reply","comment_edit","article_comment_edit"].includes(notificationType))return entityType==="article_comment"?"article_comments_replies":"post_comments_replies";
    if(notificationType==="reaction")return entityType==="article"?"article_likes":"post_likes";
    if(["comment_like","article_comment_like","comment_heart","article_comment_heart"].includes(notificationType))return "comment_reactions";
    if(["admin_post","new_post"].includes(notificationType))return "new_posts";
    if(notificationType==="new_article")return "new_articles";
    if(notificationType==="new_circle")return "new_circles";
    if(notificationType==="circle_post")return "circle_posts";
    if(notificationType==="circle_message")return "circle_messages";
    if(notificationType==="circle_meeting")return "circle_meetings";
    if(notificationType.startsWith("membership_"))return "circle_membership";
    if(notificationType==="follow")return "followers";
    if(notificationType==="timetable_reminder")return "timetable_reminders";
    return "";
  })();

  let successes=0;
  let filtered=0;
  const errors:string[]=[];
  for(const sub of subscriptions){
    const preferences=sub.device_preferences||{};
    if(preferenceKey && preferences[preferenceKey]===false){filtered++;continue;}
    const payload=JSON.stringify({
      title:claimed.title,body:claimed.body,route:claimed.route||"",
      type:notificationType,notification_id:String(claimed.notification_id),
      silent:preferences.sound===false
    });
    try{
      await webpush.sendNotification({
        endpoint:sub.endpoint,
        keys:{p256dh:sub.p256dh,auth:sub.auth}
      },payload,{TTL:60*60,urgency:"high"});
      successes++;
    }catch(error:any){
      const status=Number(error?.statusCode||0);
      errors.push(status?("webpush_"+status):"webpush_error");
      if(status===404||status===410){
        await db.from("web_push_subscriptions")
          .update({enabled:false,updated_at:new Date().toISOString()})
          .eq("id",sub.id);
      }
    }
  }

  if(successes>0 || filtered===subscriptions.length){
    await db.from("web_push_outbox").update({
      status:"sent",attempts:attempt,sent_at:new Date().toISOString(),
      last_error:errors.length?errors.join(",").slice(0,240):(filtered===subscriptions.length?"filtered_on_device":null)
    }).eq("id",jobId);
    return Response.json({ok:true,successes,failures:errors.length});
  }

  await db.from("web_push_outbox").update({
    status:"failed",attempts:attempt,
    last_error:(errors.join(",")||"all_deliveries_failed").slice(0,240),
    next_attempt_at:new Date(Date.now()+Math.min(2**attempt,30)*60_000).toISOString()
  }).eq("id",jobId);

  return Response.json({ok:false,successes:0,failures:errors.length},{status:502});
});