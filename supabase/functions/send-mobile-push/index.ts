import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FIREBASE_JSON = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") ?? "";

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function base64Url(input: Uint8Array | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function firebaseAccessToken(service: any) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: service.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = header + "." + payload;

  const pem = String(service.private_key || "")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const raw = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    raw.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  ));
  const assertion = unsigned + "." + base64Url(signature);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error("firebase_oauth_" + response.status);
  const data = await response.json();
  return String(data.access_token || "");
}

function invalidTokenPayload(payload: any) {
  const code = String(payload?.error?.status || "");
  const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];
  return code === "NOT_FOUND" ||
    details.some((d: any) => ["UNREGISTERED", "INVALID_ARGUMENT"].includes(String(d?.errorCode || "")));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: any = {};
  try { body = await req.json(); } catch { return new Response("Bad Request", { status: 400 }); }

  const jobId = String(body?.job_id || "");
  const dispatchToken = String(body?.dispatch_token || "");
  if (!/^[0-9a-f-]{36}$/i.test(jobId) || !/^[0-9a-f-]{36}$/i.test(dispatchToken)) {
    return new Response("Bad Request", { status: 400 });
  }

  if (!FIREBASE_JSON) {
    return Response.json({ ok: false, reason: "firebase_not_configured" }, { status: 503 });
  }

  let service: any;
  try { service = JSON.parse(FIREBASE_JSON); } catch {
    return Response.json({ ok: false, reason: "firebase_config_invalid" }, { status: 503 });
  }
  if (!service.project_id || !service.client_email || !service.private_key) {
    return Response.json({ ok: false, reason: "firebase_config_incomplete" }, { status: 503 });
  }

  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimError } = await db
    .from("push_notification_outbox")
    .update({ status: "sending" })
    .eq("id", jobId)
    .eq("dispatch_token", dispatchToken)
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", nowIso)
    .select("*")
    .maybeSingle();

  if (claimError) return Response.json({ ok: false, reason: "claim_failed" }, { status: 500 });
  if (!claimed) return Response.json({ ok: true, skipped: true });

  const attempt = Number(claimed.attempts || 0) + 1;

  const { data: devices, error: deviceError } = await db
    .from("push_devices")
    .select("id,token,platform")
    .eq("user_id", claimed.user_id)
    .eq("enabled", true);

  if (deviceError) {
    await db.from("push_notification_outbox").update({
      status: "failed", attempts: attempt, last_error: "device_lookup_failed",
      next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
    }).eq("id", jobId);
    return Response.json({ ok: false, reason: "device_lookup_failed" }, { status: 500 });
  }

  if (!devices?.length) {
    await db.from("push_notification_outbox").update({
      status: "sent", attempts: attempt, sent_at: new Date().toISOString(), last_error: "no_active_devices",
    }).eq("id", jobId);
    return Response.json({ ok: true, devices: 0 });
  }

  const { data: pref } = await db
    .from("push_preferences")
    .select("sound")
    .eq("user_id", claimed.user_id)
    .maybeSingle();
  const soundEnabled = pref?.sound !== false;

  let accessToken = "";
  try { accessToken = await firebaseAccessToken(service); } catch (error) {
    await db.from("push_notification_outbox").update({
      status: "failed", attempts: attempt, last_error: String(error?.message || "firebase_auth_failed").slice(0, 240),
      next_attempt_at: new Date(Date.now() + Math.min(15 * attempt, 60) * 60_000).toISOString(),
    }).eq("id", jobId);
    return Response.json({ ok: false, reason: "firebase_auth_failed" }, { status: 503 });
  }

  let successes = 0;
  const errors: string[] = [];
  const channelId = claimed.category === "messages" || claimed.category === "circles"
    ? "neis_messages" : "neis_general";

  for (const device of devices) {
    const androidNotification: Record<string, unknown> = { channel_id: channelId };
    if (soundEnabled) androidNotification.sound = "default";

    const message = {
      message: {
        token: device.token,
        notification: { title: claimed.title, body: claimed.body },
        data: {
          route: String(claimed.route || ""),
          type: String(claimed.notification_type || ""),
          notification_id: String(claimed.notification_id),
        },
        android: {
          priority: "high",
          notification: androidNotification,
        },
      },
    };

    try {
      const response = await fetch(
        "https://fcm.googleapis.com/v1/projects/" + encodeURIComponent(service.project_id) + "/messages:send",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(message),
        },
      );
      if (response.ok) {
        successes++;
      } else {
        const payload = await response.json().catch(() => ({}));
        errors.push("fcm_" + response.status);
        if (invalidTokenPayload(payload)) {
          await db.from("push_devices").update({ enabled: false, updated_at: new Date().toISOString() })
            .eq("id", device.id);
        }
      }
    } catch {
      errors.push("network_error");
    }
  }

  if (successes > 0) {
    await db.from("push_notification_outbox").update({
      status: "sent", attempts: attempt, sent_at: new Date().toISOString(),
      last_error: errors.length ? errors.join(",").slice(0, 240) : null,
    }).eq("id", jobId);
    return Response.json({ ok: true, successes, failures: errors.length });
  }

  await db.from("push_notification_outbox").update({
    status: "failed",
    attempts: attempt,
    last_error: (errors.join(",") || "all_deliveries_failed").slice(0, 240),
    next_attempt_at: new Date(Date.now() + Math.min(2 ** attempt, 30) * 60_000).toISOString(),
  }).eq("id", jobId);

  return Response.json({ ok: false, successes: 0, failures: errors.length }, { status: 502 });
});