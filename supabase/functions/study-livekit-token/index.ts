import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { AccessToken } from "npm:livekit-server-sdk@2.17.0";

const jsonHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

const reply = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: jsonHeaders });
  if (request.method !== "POST")
    return reply({ error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("authorization") ?? "";
    const jwt = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!jwt)
      return reply({ error: "Please sign in to join this meeting." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey)
      return reply({ error: "Meeting service is unavailable." }, 503);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await admin.auth.getUser(jwt);
    const user = authData.user;
    if (authError || !user)
      return reply(
        { error: "Your session has expired. Please sign in again." },
        401,
      );

    const input = await request.json().catch(() => ({}));
    const meetingId = String(
      input?.meeting_id ?? input?.meetingId ?? "",
    ).trim();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        meetingId,
      )
    ) {
      return reply({ error: "This meeting is unavailable." }, 400);
    }

    const [{ data: meeting }, { data: profile }] = await Promise.all([
      admin
        .from("circle_meetings")
        .select("id,circle_id,creator_id,title,room_name,cancelled_at,ended_at")
        .eq("id", meetingId)
        .maybeSingle(),
      admin
        .from("profiles")
        .select("full_name,username,avatar_url,role,account_status")
        .eq("id", user.id)
        .maybeSingle(),
    ]);

    if (!meeting || meeting.cancelled_at || meeting.ended_at) {
      return reply({ error: "This meeting has ended or is unavailable." }, 404);
    }
    if (!profile || profile.account_status !== "active") {
      return reply({ error: "This account cannot join meetings." }, 403);
    }

    const { data: member } = await admin
      .from("circle_members")
      .select("role,status")
      .eq("circle_id", meeting.circle_id)
      .eq("user_id", user.id)
      .maybeSingle();

    const platformAdmin = profile.role === "admin";
    const activeMember = member?.status === "active";
    if (!platformAdmin && !activeMember) {
      return reply(
        { error: "Join this Circle before entering its meeting." },
        403,
      );
    }

    const moderator =
      platformAdmin ||
      meeting.creator_id === user.id ||
      (activeMember &&
        ["owner", "admin", "moderator"].includes(member?.role ?? ""));
    const livekitUrl = Deno.env.get("LIVEKIT_URL") ?? "";
    const apiKey = Deno.env.get("LIVEKIT_API_KEY") ?? "";
    const apiSecret = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
    if (!livekitUrl || !apiKey || !apiSecret) {
      return reply({ error: "Meeting service is not configured yet." }, 503);
    }

    const displayName = profile.full_name || profile.username || "NEIS Student";
    const token = new AccessToken(apiKey, apiSecret, {
      identity: user.id,
      name: displayName,
      ttl: "20m",
      metadata: JSON.stringify({
        username: profile.username || "student",
        avatar_url: profile.avatar_url || "",
      }),
    });
    token.addGrant({
      roomJoin: true,
      room: meeting.room_name,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: moderator,
    });

    const participantToken = await token.toJwt();
    return reply({
      participant_token: participantToken,
      server_url: livekitUrl,
      room_name: meeting.room_name,
      participant_identity: user.id,
      display_name: displayName,
      is_moderator: moderator,
    });
  } catch (error) {
    console.error(
      "LiveKit token error",
      error instanceof Error ? error.message : "unknown",
    );
    return reply(
      { error: "We could not prepare this meeting. Please try again." },
      500,
    );
  }
});
