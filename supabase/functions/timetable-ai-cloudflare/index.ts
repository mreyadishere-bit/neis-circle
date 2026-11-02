import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";


const PRIMARY_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const ALLOWED_CATEGORIES = new Set([
  "Class",
  "Lab",
  "Study",
  "Exam",
  "Activity",
  "Other",
]);
const PALETTE = [
  "#2f7db8",
  "#0f9d76",
  "#d9822b",
  "#7a52d8",
  "#d6456b",
  "#2f9e95",
  "#5e6a78",
];
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 5;

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

function normalizeTime24(value: unknown): string {
  const raw = String(value ?? "").trim();
  const match24 = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (match24) {
    return `${match24[1].padStart(2, "0")}:${match24[2]}`;
  }
  const match12 = raw.match(/^(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)$/i);
  if (match12) {
    let hour = Number(match12[1]);
    const min = match12[2] || "00";
    const period = match12[3].toUpperCase();
    if (period === "PM" && hour < 12) hour += 12;
    if (period === "AM" && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23) {
      return `${String(hour).padStart(2, "0")}:${min}`;
    }
  }
  return "";
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return -1;
  return h * 60 + m;
}

function colorForSubject(title: string, index: number): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  return PALETTE[(hash + index) % PALETTE.length];
}

export function validateAndNormalizeEntries(rawEntries: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(rawEntries)) return [];
  const valid: Array<Record<string, unknown>> = [];
  const seenKeys = new Set<string>();

  for (let i = 0; i < rawEntries.length; i++) {
    const item = rawEntries[i] as Record<string, unknown> | null;
    if (!item || typeof item !== "object") continue;

    const day = Number(item.day_of_week);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;

    const title = String(item.title ?? "").trim().slice(0, 100);
    if (!title) continue;

    const startTime = normalizeTime24(item.start_time);
    const endTime = normalizeTime24(item.end_time);
    if (!startTime || !endTime) continue;
    if (toMinutes(endTime) <= toMinutes(startTime)) continue;

    const rawCategory = String(item.category ?? "Class").trim();
    const category = ALLOWED_CATEGORIES.has(rawCategory) ? rawCategory : "Class";

    const rawColor = String(item.color ?? "").trim();
    const color = /^#[0-9A-Fa-f]{6}$/.test(rawColor)
      ? rawColor.toLowerCase()
      : colorForSubject(title, i);

    const location = String(item.location ?? "").trim().slice(0, 120);
    const notes = String(item.notes ?? "").trim().slice(0, 1000);
    const id = String(item.key ?? item.id ?? "").trim() ||
      `tt-draft-${day}-${startTime.replace(":", "")}-${i + 1}`;

    const dedupeKey = `${day}|${startTime}|${endTime}|${title.toLowerCase()}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    valid.push({
      key: id,
      id,
      day_of_week: day,
      title,
      start_time: startTime,
      end_time: endTime,
      location,
      notes,
      category,
      color,
    });
  }

  valid.sort((a, b) =>
    Number(a.day_of_week) - Number(b.day_of_week) ||
    String(a.start_time).localeCompare(String(b.start_time))
  );
  return valid;
}


const SYSTEM_INSTRUCTION = [
  "You are NEIS Circle Timetable AI, examining student timetable images with accurate visual reading.",
  "Return ONLY a JSON object, never Markdown. Keys: reply (string), changed (boolean), entries (array), extracted (object).",
  "Each entry has day_of_week (0 Sunday, 1 Monday, 2 Tuesday, 3 Wednesday, 4 Thursday, 5 Friday, 6 Saturday), title, start_time, end_time, location, notes, category, color.",
  "Use HH:MM 24-hour times. Verify positions of grid cells, table headers, merged cells, visual lines and group labels.",
  "Distinguish Physics L2 from Physics L1 and Maths L2 from Maths L1. Do not include unselected subjects in entries.",
  "Never invent missing lessons, days, durations or times. Put unreadable cells in extracted.ambiguous_items and ask for clarification.",
  "The entries array is the complete proposed draft. Keep existing entries unless the student clearly requests replacement.",
  "Preserve all weekly occurrences of selected subjects across page images.",
  "The extracted object has summary, document_language, page_count, all_detected_subjects, ambiguous_items and detected_lessons.",
  "For each extracted lesson provide day_of_week, title, start_time, end_time, location, notes when visible.",
  "Make small conversational edits to draft using history and cached extraction without asking to re-upload.",
  "Use the student's language, Arabic or English. JSON text MUST be valid with no extra prose."
].join("\n");


const DISCOVERY_INSTRUCTION = [
  "You are a precise visual TIMETABLE READER, not a timetable generator.",
  "The user has NOT selected subjects yet. Extract all distinct subjects from the NEWLY UPLOADED timetable images.",
  "Never invent, substitute or rearrange lessons. Never derive days or times from previous user data.",
  "Read the entire grid: row/column headers, day columns, time slots, level suffixes (L1/L2), spanning cells, separate sessions and page headers.",
  "Identify the exact timetable orientation (days along rows or columns). A column's day heading governs every cell in that column.",
  "Extract ALL subjects as original labels into extracted.all_detected_subjects; keep English separate from English L1 and Physics L1 separate from Physics L2.",
  "Extract each readable lesson into extracted.detected_lessons with exact day_of_week 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat and start_time/end_time in HH:MM.",
  "Do NOT include a lesson in detected_lessons when its day, start, end, or subject level is unreadable. Describe the missing data in extracted.ambiguous_items.",
  "Do not infer missing AM/PM or durations unless unequivocally printed in the source grid.",
  "One subject can occur several times; include ALL weekly occurrences without confusing adjacent cells. Preserve source locations only when printed.",
  "Return ONLY strict JSON: reply (brief), changed (false), entries (empty array), extracted.",
  "extracted must have summary, document_language, page_count, all_detected_subjects, ambiguous_items, detected_lessons.",
  "Every detected lesson must have day_of_week, title, start_time, end_time, location, notes. All values must come from visible source evidence.",
  "Use the user's Arabic or English language. Avoid adding timetable events or choosing subjects.",
].join("\n");

function parseModelObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim().replace(/^~~~json\s*/i, "").replace(/^`{3}(?:json)?\s*/i, "").replace(/\s*`{3}$/i, "");
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
  } catch { /* Try extracting an object from explanatory prefix. */ }
  const start = trimmed.indexOf("{"), end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start || end - start > 60000) return null;
  try {
    const obj = JSON.parse(trimmed.slice(start, end + 1));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch { return null; }
}

async function callCloudflare(token: string, account: string, messages: unknown[]) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 70000);
  try {
    const url = "https://api.cloudflare.com/client/v4/accounts/" + account + "/ai/run/" + PRIMARY_MODEL;
    const result = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages, max_tokens: 2400, temperature: 0.1 }),
      signal: controller.signal,
    });
    if (!result.ok) {
      const err = new Error("CLOUDFLARE_HTTP_ERROR") as Error & { status?: number };
      err.status = result.status;
      throw err;
    }
    const data = await result.json();
    const response = data?.result?.response;
    // Cloudflare may return an already-parsed JSON object for structured
    // prompts, or a plain JSON string. Both are valid model outputs.
    if (!data || data.success !== true ||
        (typeof response !== "string" && (!response || typeof response !== "object"))) {
      const err = new Error("CLOUDFLARE_MALFORMED_RESPONSE") as Error & { status?: number };
      err.status = 502;
      throw err;
    }
    return typeof response === "string" ? response : JSON.stringify(response);
  } finally { clearTimeout(deadline); }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: jsonHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  try {
    const jwt = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return respond({ error: "Please sign in.", code: "AUTH_REQUIRED" }, 401);
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
    const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") || "").trim();
    if (!supabaseUrl || !anonKey) return respond({ error: "Authentication unavailable", code: "AUTH_NOT_CONFIGURED" }, 503);
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: "Bearer " + jwt } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Never decode a JWT locally and trust the user ID. Supabase Auth verifies it.
    const { data: authData, error: authError } = await client.auth.getUser(jwt);
    const userId = String(authData?.user?.id || "");
    if (authError || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return respond({ error: "Session invalid or expired.", code: "AUTH_INVALID" }, 401);
    }
    const { data: profile, error: profileError } = await client.from("profiles")
      .select("id,account_status").eq("id", userId).maybeSingle();
    if (profileError) return respond({ error: "Account verification unavailable.", code: "ACCOUNT_CHECK_UNAVAILABLE" }, 503);
    if (profile?.account_status && profile.account_status !== "active") {
      return respond({ error: "Account is restricted.", code: "ACCOUNT_RESTRICTED" }, 403);
    }
    const token = (Deno.env.get("CLOUDFLARE_API_TOKEN") || "").trim();
    const account = (Deno.env.get("CLOUDFLARE_ACCOUNT_ID") || "").trim();
    if (!token || !/^[a-f0-9]{32}$/i.test(account)) {
      return respond({ error: "Cloudflare Workers AI not configured.", code: "CLOUDFLARE_CONFIG_MISSING" }, 503);
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return respond({ error: "Invalid JSON payload.", code: "INVALID_BODY" }, 400);
    }
    if (body.ocrTextOnly || body.flattenedPdfText || body.documentText) {
      return respond({ error: "Upload timetable page images instead of flattened text.", code: "VISUAL_UPLOAD_REQUIRED" }, 400);
    }
    const prompt = String(body.message ?? body.prompt ?? "").trim().slice(0, 1600);
    const discoveryMode = body.mode === "discover";
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (attachments.length > MAX_ATTACHMENT_COUNT) {
      return respond({ error: "Up to five timetable pages per upload. Please split a larger PDF.", code: "TOO_MANY_PAGES" }, 413);
    }
    if (!prompt && !attachments.length) {
      return respond({ error: "Provide a message or attach a timetable.", code: "EMPTY_REQUEST" }, 400);
    }
    if(discoveryMode && !attachments.length){
      return respond({error:"Upload timetable images for subject discovery.",code:"IMAGE_REQUIRED"},400);
    }
    const parts: Array<Record<string, unknown>> = [];
    let totalAttachmentBytes = 0;
    for (const att of attachments) {
      if (!att || typeof att !== "object") return respond({ error: "Invalid file.", code: "INVALID_ATTACHMENT" }, 400);
      const mime = String(att.mimeType ?? att.mime_type ?? "").toLowerCase();
      if (!ALLOWED_MIME_TYPES.has(mime)) {
        return respond({ error: "Upload JPEG, PNG, or WebP page images.", code: "UNSUPPORTED_MIME_TYPE" }, 400);
      }
      const data = String(att.data ?? "").replace(/^data:[^;]+;base64,/, "").trim();
      if (!data || !/^[0-9a-z+/]*={0,2}$/i.test(data)) {
        return respond({ error: "Invalid image data.", code: "INVALID_IMAGE_DATA" }, 400);
      }
      const bytes = Math.floor(data.length * 3 / 4);
      totalAttachmentBytes += bytes;
      if (bytes > MAX_ATTACHMENT_BYTES || totalAttachmentBytes > 10 * 1024 * 1024) {
        return respond({ error: "Timetable images are too large.", code: "ATTACHMENT_TOO_LARGE" }, 413);
      }
      parts.push({ type: "image_url", image_url: { url: "data:" + mime + ";base64," + data } });
    }
    const currentEntries = validateAndNormalizeEntries(body.currentEntries ?? body.timetable ?? []);
    const draftEntries = validateAndNormalizeEntries(body.draftEntries ?? body.draft ?? currentEntries);
    const previousDraftEntries = Array.isArray(body.previousDraftEntries)
      ? validateAndNormalizeEntries(body.previousDraftEntries) : null;
    const previousExtracted = body.extracted && typeof body.extracted === "object" ? body.extracted : null;
    const history = (Array.isArray(body.messages) ? body.messages : Array.isArray(body.history) ? body.history : []).slice(-10);
    const contextSummary = JSON.stringify({
      lang: body.lang === "ar" ? "ar" : "en",
      saved_timetable: currentEntries,
      draft_timetable: draftEntries,
      previous_draft_for_undo: previousDraftEntries,
      extracted_from_previous_page: previousExtracted,
      messages: history.map((m: Record<string, unknown>) => ({
        role: m?.role === "assistant" ? "assistant" : "user",
        text: String(m?.text ?? m?.content ?? "").slice(0, 900),
      })),
    });
    const messageText = discoveryMode
      ? "Read ONLY the attached timetable page images. Find ALL distinct subjects and all unambiguously timed lessons. No draft generation. Output JSON extraction only."
      : "Context JSON:\n" + contextSummary + "\n\nRequest: " + (prompt || "Update this timetable draft.");
    const textPart = { type: "text", text: messageText };
    const messages = [
      { role: "system", content: discoveryMode ? DISCOVERY_INSTRUCTION : SYSTEM_INSTRUCTION },
      { role: "user", content: parts.length ? [textPart, ...parts] : textPart.text },
    ];
    const raw = await callCloudflare(token, account, messages);
    const parsed = parseModelObject(raw);
    if (!parsed || !Array.isArray(parsed.entries)) {
      return respond({ error: "The model did not return a valid timetable. Retry or use a clearer page.", code: "INVALID_MODEL_OUTPUT" }, 502);
    }
    // A file can only seed the guided selection wizard, never a ready-to-save
    // draft. Ignore generated entries/changed even if the AI disregards prompts.
    const entries = discoveryMode ? [] : validateAndNormalizeEntries(parsed.entries);
    const extracted = parsed.extracted && typeof parsed.extracted === "object" && !Array.isArray(parsed.extracted)
      ? parsed.extracted as Record<string, unknown> : {};
    return respond({
      reply: String(parsed.reply || (body.lang === "ar" ? "تم تحليل الجدول." : "Timetable analyzed. Review your draft.")).slice(0, 1400),
      changed: discoveryMode ? false : Boolean(parsed.changed),
      entries,
      extracted: {
        summary: String(extracted.summary ?? "").slice(0, 1200),
        document_language: String(extracted.document_language ?? (body.lang === "ar" ? "ar" : "en")),
        page_count: Math.max(1, Math.min(5, Number(extracted.page_count || attachments.length || 1))),
        all_detected_subjects: Array.isArray(extracted.all_detected_subjects) ? extracted.all_detected_subjects.map(String).slice(0, 80) : [],
        ambiguous_items: Array.isArray(extracted.ambiguous_items) ? extracted.ambiguous_items.map(String).slice(0, 40) : [],
        detected_lessons: Array.isArray(extracted.detected_lessons) ? validateAndNormalizeEntries(extracted.detected_lessons) : entries,
      },
      model: PRIMARY_MODEL,
      provider: "cloudflare",
    });
  } catch (error: unknown) {
    const status = Number((error as {status?: number})?.status ?? 0);
    const aborted = error instanceof Error && error.name === "AbortError";
    // Never log message text, personal data, the API token, or image contents.
    console.error("Cloudflare timetable request failure: status=" + status + ", timeout=" + aborted);
    if (status === 429) return respond(
      { error: "Cloudflare free-tier limit reached. Your file is preserved; retry later.", code: "CLOUDFLARE_RATE_LIMIT", retryAfterSeconds: 60 }, 429
    );
    if (status === 403) return respond(
      { error: "Cloudflare model access is not enabled on this account.", code: "CLOUDFLARE_ACCESS_DENIED" }, 503
    );
    if (status === 503 || status === 502 || aborted) return respond(
      { error: "Cloudflare AI is temporarily unavailable. Your file is preserved. Retry shortly.", code: "CLOUDFLARE_TEMPORARY_ERROR" }, 503
    );
    return respond({ error: "Could not analyze timetable. Please retry.", code: "CLOUDFLARE_UPSTREAM_ERROR" }, 502);
  }
});
