import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "content-type": "application/json" };
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
}[char] ?? char));

serve(async (request) => {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });

  const expectedSecret = Deno.env.get("EMAIL_WORKER_SECRET") ?? "";
  if (!expectedSecret || request.headers.get("x-worker-secret") !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
  }

  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const from = Deno.env.get("NOTIFICATION_FROM_EMAIL") ?? "";
  if (!resendKey || !from) {
    return new Response(JSON.stringify({ error: "Email provider is not configured" }), { status: 503, headers: cors });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const siteUrl = (Deno.env.get("SITE_URL") ?? "https://neiscircle.site").replace(/\/$/, "");
  const logoUrl = `${siteUrl}/assets/email-logo.png`;
  const posterUrl = `${siteUrl}/assets/email-poster.png`;
  const { data: jobs, error } = await supabase
    .from("email_notification_outbox")
    .select("*")
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .lt("attempts", 5)
    .order("created_at")
    .limit(25);
  if (error) return new Response(JSON.stringify({ error: "Queue unavailable" }), { status: 500, headers: cors });

  let sent = 0;
  for (const job of jobs ?? []) {
    const claimed = await supabase.from("email_notification_outbox")
      .update({ status: "sending", attempts: job.attempts + 1, last_error: null })
      .eq("id", job.id).in("status", ["pending", "failed"]).select("id").maybeSingle();
    if (claimed.error || !claimed.data) continue;

    try {
      const { data: account, error: accountError } = await supabase.auth.admin.getUserById(job.user_id);
      const email = account.user?.email;
      if (accountError || !email || !account.user?.email_confirmed_at) throw new Error("Recipient email is unavailable");
      const target = `${siteUrl}${job.action_path}`;
      const provider = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from,
          to: [email],
          subject: job.subject,
          html: `<div style="margin:0;background:#f3f7f5;padding:28px 12px;font-family:Arial,sans-serif;color:#092d26"><div style="margin:0 auto;max-width:600px;overflow:hidden;border:1px solid #dce8e3;border-radius:24px;background:#ffffff"><img src="${escapeHtml(posterUrl)}" alt="NEIS Circle community" width="600" style="display:block;width:100%;height:auto;max-height:260px;object-fit:cover"><div style="padding:28px"><div style="display:flex;align-items:center;margin-bottom:22px"><img src="${escapeHtml(logoUrl)}" alt="NEIS Circle" width="48" height="48" style="display:block;width:48px;height:48px;border-radius:15px"><div style="padding-left:12px"><strong style="display:block;font-size:16px">NEIS Circle</strong><span style="color:#71827e;font-size:12px">Student community</span></div></div><p style="margin:0 0 8px;color:#007c68;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Important update · تحديث مهم</p><h1 style="margin:0 0 14px;font-size:24px;line-height:1.35">${escapeHtml(job.subject)}</h1><p style="margin:0 0 24px;line-height:1.75;color:#526963;white-space:pre-line">${escapeHtml(job.preview)}</p><a href="${escapeHtml(target)}" style="display:inline-block;padding:13px 20px;border-radius:12px;background:#007c68;color:#fff;text-decoration:none;font-weight:700">Open NEIS Circle · افتح المنصة</a><p style="margin:26px 0 0;padding-top:18px;border-top:1px solid #e5eeea;font-size:11px;line-height:1.6;color:#71827e">You received this email because this is important activity connected to your NEIS Circle account.</p></div></div></div>`,
        }),
      });
      if (!provider.ok) throw new Error(`Provider rejected delivery (${provider.status})`);
      await supabase.from("email_notification_outbox").update({ status: "sent", processed_at: new Date().toISOString(), last_error: null }).eq("id", job.id);
      sent += 1;
    } catch (deliveryError) {
      const attempts = job.attempts + 1;
      const delayMinutes = Math.min(60, 2 ** attempts);
      await supabase.from("email_notification_outbox").update({
        status: "failed",
        last_error: String(deliveryError instanceof Error ? deliveryError.message : "Delivery failed").slice(0, 300),
        next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
      }).eq("id", job.id);
    }
  }

  return new Response(JSON.stringify({ processed: jobs?.length ?? 0, sent }), { status: 200, headers: cors });
});
