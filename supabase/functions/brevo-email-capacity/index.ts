import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const brevoKey = Deno.env.get("BREVO_API_KEY") ?? "";
  if (!serviceRole || !supabaseUrl || !brevoKey) {
    return new Response(JSON.stringify({ error: "Email capacity check is not configured" }), { status: 503, headers: corsHeaders });
  }

  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user || String(user.email ?? "").toLowerCase() !== "mreyadishere@gmail.com") {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role,account_status")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile || profile.role !== "admin" || (profile.account_status ?? "active") !== "active") {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {}
  const required = Math.max(0, Math.floor(Number(body.required_recipients ?? 0) || 0));

  const provider = await fetch("https://api.brevo.com/v3/account", {
    headers: { "api-key": brevoKey, accept: "application/json" },
  });
  if (!provider.ok) {
    return new Response(JSON.stringify({ error: "Could not verify Brevo sending capacity" }), { status: 503, headers: corsHeaders });
  }

  const account = await provider.json();
  const plans = Array.isArray(account?.plan) ? account.plan : [];
  const sendPlan = plans.find((item: any) => String(item?.creditsType ?? "").toLowerCase() === "sendlimit");
  const creditsRaw = Number(sendPlan?.credits);
  const hasFiniteCredits = Number.isFinite(creditsRaw) && creditsRaw >= 0;
  const credits = hasFiniteCredits ? Math.floor(creditsRaw) : null;
  const allowed = credits === null ? true : required <= credits;

  return new Response(JSON.stringify({
    allowed,
    credits,
    required,
    plan_type: sendPlan?.type ?? null,
  }), { status: 200, headers: corsHeaders });
});