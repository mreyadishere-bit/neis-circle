import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { GoogleGenAI, Type } from "npm:@google/genai@2.32.0";

const PRIMARY_MODEL = "gemini-3.8-flash";
// Used only if the primary model responds with repeated, quick HTTP 503 overloads.
// Both models support native PDF/image inputs and the same structured schema.
const OVERLOAD_FALLBACK_MODEL = "gemini-3.6-flash";
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
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
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB binary limit

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

const TIMETABLE_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: {
      type: Type.STRING,
      description:
        "Conversational response to the student in their language (English or Arabic). Summarize extracted or modified lessons clearly and ask clarification questions if any timetable cell or time is ambiguous.",
    },
    changed: {
      type: Type.BOOLEAN,
      description:
        "True if the proposed timetable draft entries were created or modified in this turn; false if no schedule changes were made.",
    },
    entries: {
      type: Type.ARRAY,
      description:
        "Complete list of proposed timetable entries in the student's active draft schedule.",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          day_of_week: {
            type: Type.INTEGER,
            description:
              "Day index: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday.",
          },
          title: {
            type: Type.STRING,
            description:
              "Exact subject title including level/group when present (e.g., 'Physics L2', 'Maths L2', 'English', 'ICT').",
          },
          start_time: {
            type: Type.STRING,
            description: "24-hour start time in HH:MM format (e.g. '08:30', '13:00').",
          },
          end_time: {
            type: Type.STRING,
            description: "24-hour end time in HH:MM format (e.g. '10:00', '14:30'). Must be later than start_time.",
          },
          location: {
            type: Type.STRING,
            description: "Room, lab, building, or 'Online'/'School' if shown in the timetable.",
          },
          notes: {
            type: Type.STRING,
            description: "Optional teacher name, group code, or session notes.",
          },
          category: {
            type: Type.STRING,
            description: "One of: Class, Lab, Study, Exam, Activity, Other.",
          },
          color: {
            type: Type.STRING,
            description: "Hex color code #RRGGBB.",
          },
        },
        required: [
          "day_of_week",
          "title",
          "start_time",
          "end_time",
          "location",
          "notes",
          "category",
          "color",
        ],
      },
    },
    extracted: {
      type: Type.OBJECT,
      description:
        "Structured visual analysis of the uploaded timetable document preserved for multi-turn conversation context.",
      properties: {
        summary: { type: Type.STRING },
        document_language: { type: Type.STRING },
        page_count: { type: Type.INTEGER },
        all_detected_subjects: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        ambiguous_items: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        detected_lessons: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              day_of_week: { type: Type.INTEGER },
              title: { type: Type.STRING },
              start_time: { type: Type.STRING },
              end_time: { type: Type.STRING },
              location: { type: Type.STRING },
              notes: { type: Type.STRING },
            },
            required: ["day_of_week", "title", "start_time", "end_time"],
          },
        },
      },
      required: [
        "summary",
        "document_language",
        "all_detected_subjects",
        "ambiguous_items",
        "detected_lessons",
      ],
    },
  },
  required: ["reply", "changed", "entries", "extracted"],
};

const SYSTEM_INSTRUCTION = `You are the NEIS Circle Timetable AI Assistant powered by Google Gemini 3.8 Flash native multimodal document & vision understanding.

CRITICAL RULES:
1. TRUE VISUAL TIMETABLE UNDERSTANDING:
   - Inspect the uploaded PDF or image visually as a complete 2D table/layout.
   - Carefully trace table headers, row headers, column headers, merged cells (spanning multiple periods or hours), color-coded blocks, rotated tables, multi-page schedules, and scanned documents.
   - Determine whether days run across columns or down rows, and whether time slots run across columns or down rows.
   - Map days strictly to NEIS Circle day numbers:
     0 = Sunday (الأحد)
     1 = Monday (الاثنين)
     2 = Tuesday (الثلاثاء)
     3 = Wednesday (الأربعاء)
     4 = Thursday (الخميس)
     5 = Friday (الجمعة)
     6 = Saturday (السبت)
   - Convert all times to 24-hour HH:MM format (e.g., 8:30 AM -> "08:30", 1:00 PM -> "13:00", 12:00 PM -> "12:00"). School afternoon lessons like "1:00 - 2:30" or "12:00 - 1:00" must use 13:00 / 14:30 / 12:00->13:00 appropriately so end_time > start_time.

2. INTELLIGENT SUBJECT SELECTION & LEVEL DISTINCTION:
   - When the student specifies which subjects they take (e.g., "I only take English, Physics L2, Maths L2, and ICT"), include ONLY those requested subjects in "entries", while recording all visible subjects/lessons from the document in "extracted.all_detected_subjects" and "extracted.detected_lessons".
   - Strictly distinguish subject levels and codes: "Physics L2" is NOT "Physics L1"; "Maths L2" is NOT "Maths L1". Never mix levels or adjacent cells.
   - Include every weekly occurrence of the selected subjects across all days and pages.

3. AMBIGUITY HANDLING:
   - Never invent lessons or guess missing times. If any cell, time range, or subject level is ambiguous or unreadable, list it in "extracted.ambiguous_items" and ask the student a concise clarification question in "reply".

4. CONTEXTUAL MULTI-TURN MODIFICATIONS:
   - Treat follow-up instructions ("Actually, remove Wednesday's Physics lesson", "Move Maths to 10 AM", "I don't take that subject", "Undo the previous change", "Add an ICT lesson on Thursday from 12 to 1", "Keep everything else unchanged") as modifications to the active draft schedule ("draftEntries") using the conversation history and "extracted" document context.
   - Preserve all other draft entries unchanged unless the student asks to remove or replace them.`;

async function callGeminiWithRetry(
  ai: GoogleGenAI,
  contents: Array<Record<string, unknown>>,
  // Preserve one quick primary retry; permit one fallback *only* after a second
  // fast 503. Never retry 429, malformed files or authentication errors.
  maxRetries = 1,
) {
  let lastError: unknown = null;
  const startedAt = Date.now();
  for (let attempt = 0; attempt <= maxRetries + 1; attempt++) {
    const fallback = attempt > maxRetries;
    const model = fallback ? OVERLOAD_FALLBACK_MODEL : PRIMARY_MODEL;
    try {
      return await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: TIMETABLE_RESPONSE_SCHEMA,
        },
      });
    } catch (err: unknown) {
      lastError = err;
      const status = Number((err as { status?: number })?.status || 0);
      const message = err instanceof Error ? err.message : String(err);
      const isOverload503 = status === 503 ||
        (status === 0 && /503|high demand|service unavailable|overloaded/i.test(message));
      // Full backend response must still fit the frontend's existing 95s
      // deadline. If a request is already slow, fail cleanly so the user's
      // original PDF and prompt remain available for the existing Retry button.
      if (!isOverload503 || fallback || Date.now() - startedAt >= 9000) {
        throw err;
      }
      // Back off briefly before the primary retry and fallback. 429 stays
      // untouched because a quota error should never trigger extra traffic.
      const baseDelay = attempt < maxRetries ? 900 : 300;
      const delay = baseDelay + Math.floor(Math.random() * 300);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: jsonHeaders });
  }
  if (request.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  try {
    const authorization = request.headers.get("authorization") ?? "";
    const jwt = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return respond(
        { error: "Please sign in to use the Timetable AI Assistant.", code: "AUTH_REQUIRED" },
        401,
      );
    }

    const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
    const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
    if (!supabaseUrl || !anonKey) {
      return respond(
        {
          error: "Supabase authentication is not configured in the backend environment.",
          code: "AUTH_NOT_CONFIGURED",
        },
        503,
      );
    }

    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: sessionError } = await client.auth.getUser(jwt);
    const userId = String(authData?.user?.id ?? "").trim();
    if (
      sessionError ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        userId,
      )
    ) {
      return respond(
        { error: "Invalid or expired authentication session. Please sign in again.", code: "AUTH_INVALID" },
        401,
      );
    }

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("id,account_status")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) {
      console.error("Timetable AI profile verification error:", profileError.message);
      return respond(
        { error: "Unable to verify account status right now. Please try again.", code: "ACCOUNT_CHECK_UNAVAILABLE" },
        503,
      );
    }
    if (profile && profile.account_status && profile.account_status !== "active") {
      return respond(
        { error: "Your account is not permitted to use Timetable AI.", code: "ACCOUNT_RESTRICTED" },
        403,
      );
    }

    const geminiApiKey = (Deno.env.get("GEMINI_API_KEY") ?? "").trim();
    if (!geminiApiKey) {
      return respond(
        {
          error:
            "GEMINI_API_KEY is missing in the backend environment. Please configure GEMINI_API_KEY to enable Gemini 3.8 Flash Timetable AI.",
          code: "GEMINI_API_KEY_MISSING",
          provider: "gemini",
        },
        503,
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return respond({ error: "Invalid JSON request body.", code: "INVALID_BODY" }, 400);
    }

    if (body.ocrTextOnly === true || body.flattenedPdfText || body.documentText) {
      return respond(
        {
          error:
            "Plain-text PDF flattening is disabled. Send the original PDF or image file directly to Gemini 3.8 Flash multimodal input.",
          code: "FLATTENED_TEXT_REJECTED",
        },
        400,
      );
    }

    const userPrompt = String(body.prompt ?? body.message ?? "").trim();
    const rawAttachments = Array.isArray(body.attachments)
      ? body.attachments
      : body.attachment
      ? [body.attachment]
      : Array.isArray(body.images)
      ? body.images
      : [];

    if (!userPrompt && rawAttachments.length === 0) {
      return respond(
        { error: "Please provide a message or attach a timetable PDF/image.", code: "EMPTY_REQUEST" },
        400,
      );
    }

    const multimodalParts: Array<Record<string, unknown>> = [];
    for (const att of rawAttachments) {
      if (!att || typeof att !== "object") continue;
      const mimeType = String(att.mimeType ?? att.mime_type ?? att.mime ?? "").trim().toLowerCase();
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        return respond(
          {
            error: `Unsupported attachment format (${mimeType || "unknown"}). Please upload a PDF, PNG, JPEG, or WebP file.`,
            code: "UNSUPPORTED_MIME_TYPE",
          },
          400,
        );
      }
      const base64Data = String(att.data ?? "").replace(/^data:[^;]+;base64,/, "").trim();
      if (!base64Data) {
        return respond(
          { error: "Uploaded attachment is empty.", code: "EMPTY_ATTACHMENT" },
          400,
        );
      }
      const approxBytes = Math.floor((base64Data.length * 3) / 4);
      if (approxBytes > MAX_ATTACHMENT_BYTES) {
        return respond(
          { error: "Attachment exceeds the 15 MB size limit.", code: "ATTACHMENT_TOO_LARGE" },
          400,
        );
      }
      multimodalParts.push({
        inlineData: {
          mimeType,
          data: base64Data,
        },
      });
    }

    const currentEntries = validateAndNormalizeEntries(body.currentEntries ?? body.timetable ?? []);
    const draftEntries = validateAndNormalizeEntries(body.draftEntries ?? body.draft ?? currentEntries);
    const previousDraftEntries = Array.isArray(body.previousDraftEntries)
      ? validateAndNormalizeEntries(body.previousDraftEntries)
      : null;
    const rawExtracted = body.extracted ?? body.source ?? null;
    const previousExtracted = rawExtracted && typeof rawExtracted === "object"
      ? rawExtracted
      : null;
    const rawHistory = Array.isArray(body.messages)
      ? body.messages
      : Array.isArray(body.history)
      ? body.history
      : [];
    const history = rawHistory.slice(-12);

    const contextSummary = JSON.stringify({
      language: body.lang === "ar" ? "ar" : "en",
      current_saved_timetable: currentEntries,
      active_draft_entries: draftEntries,
      previous_draft_entries_for_undo: previousDraftEntries,
      cached_visual_document_extraction: previousExtracted,
      conversation_history: history.map((m: Record<string, unknown>) => ({
        role: m?.role === "assistant" ? "assistant" : "user",
        content: String(m?.content ?? m?.text ?? "").slice(0, 1500),
      })),
    });

    const userParts: Array<Record<string, unknown>> = [
      ...multimodalParts,
      {
        text: `Context JSON:\n${contextSummary}\n\nStudent Request:\n${
          userPrompt || "Please analyze this uploaded timetable visually and prepare my schedule."
        }`,
      },
    ];

    const ai = new GoogleGenAI({
      apiKey: geminiApiKey,
      // Bound slow native-PDF processing below the frontend's 95s deadline.
      httpOptions: { timeout: 80000, headers: { "User-Agent": "aistudio-build" } },
    });

    // Advice-only questions need ordinary conversation, not a timetable
    // mutation or a strict JSON lesson extraction. Keep all PDF/image and
    // lesson-edit commands on the existing validated structured path below.
    const adviceOnly = multimodalParts.length === 0 &&
      /(?:how (?:can|should|do|to)|best way|tips? (?:for|to)|advice (?:for|on)|إزاي|كيف|نصائح|أفضل طريقة)/i.test(userPrompt) &&
      /(?:manage|organize|organise|plan|balance|study|time|timetable|schedule|revision|ذاكر|تنظيم|جدول|مذاكرة|وقت)/i.test(userPrompt) &&
      !/(?:\b(?:add|remove|delete|move|edit|change|create|generate|put|schedule)\s+(?:my\s+)?(?:class|lesson|subject|period)|(?:أضف|احذف|انقل|عدّل|غير|أنشئ)\s+(?:حصة|مادة|الجدول))/i.test(userPrompt);
    if (adviceOnly) {
      const textRequest = {
        role: "user",
        parts: [{
          text: `You are the NEIS Circle student timetable assistant. Answer this
student's general question about time management clearly and concisely in
${body.lang === "ar" ? "Arabic" : "English"}. Do not invent classes, imply a
schedule was modified, or request personal information. Student question:
${userPrompt.slice(0, 1400)}`,
        }],
      };
      let advice: { text?: string; modelVersion?: string } | null = null;
      try {
        advice = await ai.models.generateContent({
          model: PRIMARY_MODEL,
          contents: [textRequest],
          config: { maxOutputTokens: 450, temperature: 0.55 },
        });
      } catch (adviceError: unknown) {
        const status = Number((adviceError as { status?: number })?.status || 0);
        if (status !== 503) throw adviceError;
        advice = await ai.models.generateContent({
          model: OVERLOAD_FALLBACK_MODEL,
          contents: [textRequest],
          config: { maxOutputTokens: 450, temperature: 0.55 },
        });
      }
      const adviceText = String(advice?.text ?? "").trim();
      if (!adviceText) {
        return respond({ error: "The AI response was empty. Please retry.", code: "EMPTY_MODEL_OUTPUT" }, 502);
      }
      return respond({
        reply: adviceText.slice(0, 1800),
        changed: false,
        entries: draftEntries,
        extracted: previousExtracted ?? {
          summary: "",
          document_language: body.lang === "ar" ? "ar" : "en",
          all_detected_subjects: [],
          ambiguous_items: [],
          detected_lessons: [],
        },
        model: String(advice?.modelVersion ?? PRIMARY_MODEL).replace(/^models\//, ""),
        provider: "gemini",
      });
    }

    const response = await callGeminiWithRetry(ai, [
      {
        role: "user",
        parts: userParts,
      },
    ]);

    const rawText = String(response?.text ?? "").trim();
    if (!rawText) {
      return respond(
        { error: "Gemini returned an empty response. Please retry.", code: "EMPTY_MODEL_OUTPUT" },
        502,
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return respond(
        { error: "Gemini returned malformed structured output. Please retry.", code: "INVALID_JSON_OUTPUT" },
        502,
      );
    }

    const validatedEntries = validateAndNormalizeEntries(parsed.entries);
    const extractedObj = parsed.extracted && typeof parsed.extracted === "object"
      ? (parsed.extracted as Record<string, unknown>)
      : {
          summary: "",
          document_language: body.lang === "ar" ? "ar" : "en",
          all_detected_subjects: [],
          ambiguous_items: [],
          detected_lessons: validatedEntries,
        };

    return respond({
      reply: String(parsed.reply ?? "").trim() ||
        (body.lang === "ar"
          ? "تم تحليل الجدول الدراسي وتجهيز المسودة للمراجعة."
          : "Your timetable has been analyzed and prepared as a draft for review."),
      changed: Boolean(parsed.changed),
      entries: validatedEntries,
      extracted: {
        summary: String(extractedObj.summary ?? ""),
        document_language: String(extractedObj.document_language ?? (body.lang === "ar" ? "ar" : "en")),
        page_count: Number(extractedObj.page_count || 1),
        all_detected_subjects: Array.isArray(extractedObj.all_detected_subjects)
          ? extractedObj.all_detected_subjects.map(String)
          : [],
        ambiguous_items: Array.isArray(extractedObj.ambiguous_items)
          ? extractedObj.ambiguous_items.map(String)
          : [],
        detected_lessons: Array.isArray(extractedObj.detected_lessons)
          ? validateAndNormalizeEntries(extractedObj.detected_lessons)
          : validatedEntries,
      },
      model: String(response?.modelVersion ?? PRIMARY_MODEL).replace(/^models\//, ""),
      provider: "gemini",
    });
  } catch (error: unknown) {
    const status = Number((error as { status?: number })?.status || 0);
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Timetable AI Gemini error:", status, message.replace(/AIza[0-9A-Za-z-_]+/g, "[REDACTED]"));

    if (status === 503 || /(?:503|high demand|UNAVAILABLE|service unavailable|overloaded)/i.test(message)) {
      return respond(
        {
          error: "Gemini is temporarily overloaded (HTTP 503). Your PDF and message are saved in this chat. Please try Retry after about 20 seconds.",
          code: "GEMINI_SERVICE_UNAVAILABLE_503",
          retryAfterSeconds: 20,
          provider: "gemini",
        },
        503,
      );
    }
    if (status === 429 || /429|quota|rate.?limit|resource_exhausted/i.test(message)) {
      return respond(
        {
          error:
            "Gemini free-tier rate limit reached. Please wait a moment and click Retry — your uploaded file and message are preserved.",
          code: "GEMINI_RATE_LIMIT_429",
          retryAfterSeconds: 15,
          provider: "gemini",
        },
        429,
      );
    }
    if (status === 400 || /invalid_argument/i.test(message)) {
      return respond(
        {
          error: "The uploaded timetable document could not be processed by Gemini. Please verify the PDF or image file.",
          code: "GEMINI_INVALID_DOCUMENT",
          provider: "gemini",
        },
        400,
      );
    }
    return respond(
      {
        error: "Timetable AI encountered a temporary service error. Please try again.",
        code: "GEMINI_UPSTREAM_ERROR",
        provider: "gemini",
      },
      500,
    );
  }
});
