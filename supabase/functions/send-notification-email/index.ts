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
          html: `<div style="margin:0 auto;max-width:600px;padding:32px;font-family:Arial,sans-serif;color:#092d26"><h1 style="margin:0 0 16px;font-size:24px">${escapeHtml(job.subject)}</h1><p style="margin:0 0 24px;line-height:1.7;color:#526963">${escapeHtml(job.preview)}</p><a href="${escapeHtml(target)}" style="display:inline-block;padding:13px 20px;border-radius:12px;background:#007c68;color:#fff;text-decoration:none;font-weight:700">Open NEIS Circle · افتح المنصة</a><p style="margin-top:26px;font-size:12px;color:#71827e">NEIS Circle</p></div>`,
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
