import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } }
);

type PushProof = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

const valid = (value: unknown, min = 8) =>
  typeof value === "string" && value.trim().length >= min;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false }), { status: 405, headers: corsHeaders });

  let payload: { old_subscription?: PushProof; new_subscription?: PushProof } = {};
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, reason: "invalid_json" }), { status: 400, headers: corsHeaders });
  }

  const oldSub = payload.old_subscription || {};
  const nextSub = payload.new_subscription || {};
  const oldEndpoint = String(oldSub.endpoint || "").trim();
  const oldP256dh = String(oldSub.keys?.p256dh || "").trim();
  const oldAuth = String(oldSub.keys?.auth || "").trim();
  const nextEndpoint = String(nextSub.endpoint || "").trim();
  const nextP256dh = String(nextSub.keys?.p256dh || "").trim();
  const nextAuth = String(nextSub.keys?.auth || "").trim();

  if (!valid(oldEndpoint, 20) || !valid(oldP256dh, 20) || !valid(oldAuth) ||
      !valid(nextEndpoint, 20) || !valid(nextP256dh, 20) || !valid(nextAuth)) {
    return new Response(JSON.stringify({ ok: false, reason: "invalid_subscription" }), { status: 400, headers: corsHeaders });
  }

  const { data: oldRow, error: lookupError } = await db
    .from("web_push_subscriptions")
    .select("id,user_id")
    .eq("endpoint", oldEndpoint)
    .eq("p256dh", oldP256dh)
    .eq("auth", oldAuth)
    .maybeSingle();

  if (lookupError) {
    return new Response(JSON.stringify({ ok: false, reason: "lookup_failed" }), { status: 500, headers: corsHeaders });
  }
  if (!oldRow) {
    return new Response(JSON.stringify({ ok: false, reason: "old_subscription_not_found" }), { status: 404, headers: corsHeaders });
  }

  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await db
    .from("web_push_subscriptions")
    .select("id")
    .eq("endpoint", nextEndpoint)
    .maybeSingle();

  if (existingError) {
    return new Response(JSON.stringify({ ok: false, reason: "new_lookup_failed" }), { status: 500, headers: corsHeaders });
  }

  if (existing?.id && existing.id !== oldRow.id) {
    const { error: updateExistingError } = await db
      .from("web_push_subscriptions")
      .update({
        user_id: oldRow.user_id,
        p256dh: nextP256dh,
        auth: nextAuth,
        enabled: true,
        last_seen_at: now,
        updated_at: now
      })
      .eq("id", existing.id);

    if (updateExistingError) {
      return new Response(JSON.stringify({ ok: false, reason: "new_update_failed" }), { status: 500, headers: corsHeaders });
    }

    await db
      .from("web_push_subscriptions")
      .update({ enabled: false, updated_at: now })
      .eq("id", oldRow.id);
  } else {
    const { error: updateError } = await db
      .from("web_push_subscriptions")
      .update({
        endpoint: nextEndpoint,
        p256dh: nextP256dh,
        auth: nextAuth,
        enabled: true,
        last_seen_at: now,
        updated_at: now
      })
      .eq("id", oldRow.id);

    if (updateError) {
      return new Response(JSON.stringify({ ok: false, reason: "rotation_update_failed" }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
});
