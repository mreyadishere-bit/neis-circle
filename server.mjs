import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PRIMARY_MODEL = 'gemini-3.8-flash';
export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);
export const ALLOWED_CATEGORIES = new Set([
  'Class',
  'Lab',
  'Study',
  'Exam',
  'Activity',
  'Other',
]);
export const PALETTE = [
  '#2f7db8',
  '#0f9d76',
  '#d9822b',
  '#7a52d8',
  '#d6456b',
  '#2f9e95',
  '#5e6a78',
];
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export function normalizeTime24(value) {
  const raw = String(value ?? '').trim();
  const match24 = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (match24) {
    return `${match24[1].padStart(2, '0')}:${match24[2]}`;
  }
  const match12 = raw.match(/^(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)$/i);
  if (match12) {
    let hour = Number(match12[1]);
    const min = match12[2] || '00';
    const period = match12[3].toUpperCase();
    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23) {
      return `${String(hour).padStart(2, '0')}:${min}`;
    }
  }
  return '';
}

export function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return -1;
  return h * 60 + m;
}

export function colorForSubject(title, index = 0) {
  let hash = 0;
  const text = String(title || '');
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return PALETTE[(hash + index) % PALETTE.length];
}

export function validateAndNormalizeEntries(rawEntries) {
  if (!Array.isArray(rawEntries)) return [];
  const valid = [];
  const seenKeys = new Set();

  for (let i = 0; i < rawEntries.length; i++) {
    const item = rawEntries[i];
    if (!item || typeof item !== 'object') continue;

    const day = Number(item.day_of_week);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;

    const title = String(item.title ?? '').trim().slice(0, 100);
    if (!title) continue;

    const startTime = normalizeTime24(item.start_time);
    const endTime = normalizeTime24(item.end_time);
    if (!startTime || !endTime) continue;
    if (toMinutes(endTime) <= toMinutes(startTime)) continue;

    const rawCategory = String(item.category ?? 'Class').trim();
    const category = ALLOWED_CATEGORIES.has(rawCategory) ? rawCategory : 'Class';

    const rawColor = String(item.color ?? '').trim();
    const color = /^#[0-9A-Fa-f]{6}$/.test(rawColor)
      ? rawColor.toLowerCase()
      : colorForSubject(title, i);

    const location = String(item.location ?? '').trim().slice(0, 120);
    const notes = String(item.notes ?? '').trim().slice(0, 1000);
    const id =
      String(item.key ?? item.id ?? '').trim() ||
      `tt-draft-${day}-${startTime.replace(':', '')}-${i + 1}`;

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

  valid.sort(
    (a, b) =>
      Number(a.day_of_week) - Number(b.day_of_week) ||
      String(a.start_time).localeCompare(String(b.start_time)),
  );
  return valid;
}

export const TIMETABLE_RESPONSE_SCHEMA = {
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
        'True if the proposed timetable draft entries were created or modified in this turn; false if no schedule changes were made.',
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
              'Day index: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday.',
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
            description:
              "24-hour end time in HH:MM format (e.g. '10:00', '14:30'). Must be later than start_time.",
          },
          location: {
            type: Type.STRING,
            description: "Room, lab, building, or 'Online'/'School' if shown in the timetable.",
          },
          notes: {
            type: Type.STRING,
            description: 'Optional teacher name, group code, or session notes.',
          },
          category: {
            type: Type.STRING,
            description: 'One of: Class, Lab, Study, Exam, Activity, Other.',
          },
          color: {
            type: Type.STRING,
            description: 'Hex color code #RRGGBB.',
          },
        },
        required: [
          'day_of_week',
          'title',
          'start_time',
          'end_time',
          'location',
          'notes',
          'category',
          'color',
        ],
      },
    },
    extracted: {
      type: Type.OBJECT,
      description:
        'Structured visual analysis of the uploaded timetable document preserved for multi-turn conversation context.',
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
            required: ['day_of_week', 'title', 'start_time', 'end_time'],
          },
        },
      },
      required: [
        'summary',
        'document_language',
        'all_detected_subjects',
        'ambiguous_items',
        'detected_lessons',
      ],
    },
  },
  required: ['reply', 'changed', 'entries', 'extracted'],
};

export const SYSTEM_INSTRUCTION = `You are the NEIS Circle Timetable AI Assistant powered by Google Gemini 3.8 Flash native multimodal document & vision understanding.

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

export async function verifySupabaseSessionAndProfile(jwt, env = process.env, fetchImpl = globalThis.fetch) {
  const supabaseUrl = String(env?.SUPABASE_URL ?? 'https://supabase.neiscircle.site').trim().replace(/\/+$/, '');
  const anonKey = String(
    env?.SUPABASE_ANON_KEY ??
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFYmFzZSIsImlhdCI6MTc3NTg0NjI0NSwiZXhwIjoyMDkxMjA2MjQ1fQ.ee23212759129f2d8fe77ffb61be9fd2ddcc5ba2ddce7dfe5fa54ebffac121a9',
  ).trim();
  if (!supabaseUrl || !anonKey) {
    return { status: 503, code: 'AUTH_NOT_CONFIGURED', error: 'Supabase authentication is not configured in the backend environment.' };
  }

  let userRes;
  try {
    userRes = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${jwt}`,
      },
    });
  } catch {
    return { status: 401, code: 'AUTH_INVALID', error: 'Invalid or expired authentication session. Please sign in again.' };
  }

  if (!userRes || !userRes.ok) {
    return { status: 401, code: 'AUTH_INVALID', error: 'Invalid or expired authentication session. Please sign in again.' };
  }

  const userData = await userRes.json().catch(() => null);
  const userId = String(userData?.id ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return { status: 401, code: 'AUTH_INVALID', error: 'Invalid or expired authentication session. Please sign in again.' };
  }

  let profileRes;
  try {
    profileRes = await fetchImpl(
      `${supabaseUrl}/rest/v1/profiles?select=id,account_status&id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'GET',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/json',
        },
      },
    );
  } catch {
    return { status: 503, code: 'ACCOUNT_CHECK_UNAVAILABLE', error: 'Unable to verify account status right now. Please try again.' };
  }

  if (!profileRes || !profileRes.ok) {
    return { status: 503, code: 'ACCOUNT_CHECK_UNAVAILABLE', error: 'Unable to verify account status right now. Please try again.' };
  }

  const rows = await profileRes.json().catch(() => null);
  if (!Array.isArray(rows)) {
    return { status: 503, code: 'ACCOUNT_CHECK_UNAVAILABLE', error: 'Unable to verify account status right now. Please try again.' };
  }
  const profile = rows[0] || null;
  if (profile && profile.account_status && profile.account_status !== 'active') {
    return { status: 403, code: 'ACCOUNT_RESTRICTED', error: 'Your account is not permitted to use Timetable AI.' };
  }

  return { status: 200, userId };
}

export async function processTimetableAiPayload({
  authorization = '',
  body = null,
  env = process.env,
  aiClientFactory = null,
  authVerifier = null,
}) {
  const jwt = String(authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return {
      status: 401,
      body: {
        error: 'Please sign in to use the Timetable AI Assistant.',
        code: 'AUTH_REQUIRED',
      },
    };
  }

  const authCheck = authVerifier
    ? await authVerifier(jwt, env)
    : await verifySupabaseSessionAndProfile(jwt, env);

  if (!authCheck || authCheck.status !== 200) {
    return {
      status: authCheck?.status || 401,
      body: {
        error:
          authCheck?.error ||
          'Invalid or expired authentication session. Please sign in again.',
        code: authCheck?.code || 'AUTH_INVALID',
      },
    };
  }

  const userId = String(authCheck.userId ?? '').trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      userId,
    )
  ) {
    return {
      status: 401,
      body: {
        error: 'Invalid or expired authentication session. Please sign in again.',
        code: 'AUTH_INVALID',
      },
    };
  }

  const geminiApiKey = String(env?.GEMINI_API_KEY ?? '').trim();
  if (!geminiApiKey) {
    return {
      status: 503,
      body: {
        error:
          'GEMINI_API_KEY is missing in the backend environment. Please configure GEMINI_API_KEY to enable Gemini 3.8 Flash Timetable AI.',
        code: 'GEMINI_API_KEY_MISSING',
        provider: 'gemini',
      },
    };
  }

  if (!body || typeof body !== 'object') {
    return {
      status: 400,
      body: { error: 'Invalid JSON request body.', code: 'INVALID_BODY' },
    };
  }

  if (body.ocrTextOnly === true || body.flattenedPdfText || body.documentText) {
    return {
      status: 400,
      body: {
        error:
          'Plain-text PDF flattening is disabled. Send the original PDF or image file directly to Gemini 3.8 Flash multimodal input.',
        code: 'FLATTENED_TEXT_REJECTED',
      },
    };
  }

  const userPrompt = String(body.prompt ?? body.message ?? '').trim();
  const rawAttachments = Array.isArray(body.attachments)
    ? body.attachments
    : body.attachment
    ? [body.attachment]
    : Array.isArray(body.images)
    ? body.images
    : [];

  if (!userPrompt && rawAttachments.length === 0) {
    return {
      status: 400,
      body: {
        error: 'Please provide a message or attach a timetable PDF/image.',
        code: 'EMPTY_REQUEST',
      },
    };
  }

  const multimodalParts = [];
  for (const att of rawAttachments) {
    if (!att || typeof att !== 'object') continue;
    const mimeType = String(att.mimeType ?? att.mime_type ?? att.mime ?? '')
      .trim()
      .toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return {
        status: 400,
        body: {
          error: `Unsupported attachment format (${mimeType || 'unknown'}). Please upload a PDF, PNG, JPEG, or WebP file.`,
          code: 'UNSUPPORTED_MIME_TYPE',
        },
      };
    }
    const base64Data = String(att.data ?? '')
      .replace(/^data:[^;]+;base64,/, '')
      .trim();
    if (!base64Data) {
      return {
        status: 400,
        body: {
          error: 'Uploaded attachment is empty.',
          code: 'EMPTY_ATTACHMENT',
        },
      };
    }
    const approxBytes = Math.floor((base64Data.length * 3) / 4);
    if (approxBytes > MAX_ATTACHMENT_BYTES) {
      return {
        status: 400,
        body: {
          error: 'Attachment exceeds the 15 MB size limit.',
          code: 'ATTACHMENT_TOO_LARGE',
        },
      };
    }
    multimodalParts.push({
      inlineData: {
        mimeType,
        data: base64Data,
      },
    });
  }

  const currentEntries = validateAndNormalizeEntries(
    body.currentEntries ?? body.timetable ?? [],
  );
  const draftEntries = validateAndNormalizeEntries(
    body.draftEntries ?? body.draft ?? currentEntries,
  );
  const previousDraftEntries = Array.isArray(body.previousDraftEntries)
    ? validateAndNormalizeEntries(body.previousDraftEntries)
    : null;
  const rawExtracted = body.extracted ?? body.source ?? null;
  const previousExtracted =
    rawExtracted && typeof rawExtracted === 'object' ? rawExtracted : null;
  const rawHistory = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.history)
    ? body.history
    : [];
  const history = rawHistory.slice(-12);

  const contextSummary = JSON.stringify({
    language: body.lang === 'ar' ? 'ar' : 'en',
    current_saved_timetable: currentEntries,
    active_draft_entries: draftEntries,
    previous_draft_entries_for_undo: previousDraftEntries,
    cached_visual_document_extraction: previousExtracted,
    conversation_history: history.map((m) => ({
      role: m?.role === 'assistant' ? 'assistant' : 'user',
      content: String(m?.content ?? m?.text ?? '').slice(0, 1500),
    })),
  });

  const userParts = [
    ...multimodalParts,
    {
      text: `Context JSON:\n${contextSummary}\n\nStudent Request:\n${
        userPrompt ||
        'Please analyze this uploaded timetable visually and prepare my schedule.'
      }`,
    },
  ];

  const ai = aiClientFactory
    ? aiClientFactory(geminiApiKey)
    : new GoogleGenAI({
        apiKey: geminiApiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

  try {
    let response = null;
    let lastErr = null;
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        response = await ai.models.generateContent({
          model: PRIMARY_MODEL,
          contents: [
            {
              role: 'user',
              parts: userParts,
            },
          ],
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: TIMETABLE_RESPONSE_SCHEMA,
          },
        });
        break;
      } catch (err) {
        lastErr = err;
        const status = Number(err?.status || 0);
        const msg = err instanceof Error ? err.message : String(err);
        const isTransient =
          status === 503 ||
          status === 504 ||
          /overloaded|unavailable|timeout|network/i.test(msg);
        if (!isTransient || attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, 250 * Math.pow(2, attempt)));
      }
    }
    if (!response && lastErr) throw lastErr;

    const rawText = String(response?.text ?? '').trim();
    if (!rawText) {
      return {
        status: 502,
        body: {
          error: 'Gemini returned an empty response. Please retry.',
          code: 'EMPTY_MODEL_OUTPUT',
        },
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return {
        status: 502,
        body: {
          error: 'Gemini returned malformed structured output. Please retry.',
          code: 'INVALID_JSON_OUTPUT',
        },
      };
    }

    const validatedEntries = validateAndNormalizeEntries(parsed.entries);
    const extractedObj =
      parsed.extracted && typeof parsed.extracted === 'object'
        ? parsed.extracted
        : {
            summary: '',
            document_language: body.lang === 'ar' ? 'ar' : 'en',
            all_detected_subjects: [],
            ambiguous_items: [],
            detected_lessons: validatedEntries,
          };

    return {
      status: 200,
      body: {
        reply:
          String(parsed.reply ?? '').trim() ||
          (body.lang === 'ar'
            ? 'تم تحليل الجدول الدراسي وتجهيز المسودة للمراجعة.'
            : 'Your timetable has been analyzed and prepared as a draft for review.'),
        changed: Boolean(parsed.changed),
        entries: validatedEntries,
        extracted: {
          summary: String(extractedObj.summary ?? ''),
          document_language: String(
            extractedObj.document_language ?? (body.lang === 'ar' ? 'ar' : 'en'),
          ),
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
        model: PRIMARY_MODEL,
        provider: 'gemini',
      },
    };
  } catch (error) {
    const status = Number(error?.status || 0);
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(
      'Timetable AI Gemini error:',
      status,
      message.replace(/AIza[0-9A-Za-z-_]+/g, '[REDACTED]'),
    );

    if (
      status === 429 ||
      /429|quota|rate.?limit|resource_exhausted/i.test(message)
    ) {
      return {
        status: 429,
        body: {
          error:
            'Gemini free-tier rate limit reached. Please wait a moment and click Retry — your uploaded file and message are preserved.',
          code: 'GEMINI_RATE_LIMIT_429',
          retryAfterSeconds: 15,
          provider: 'gemini',
        },
      };
    }
    if (status === 400 || /invalid_argument/i.test(message)) {
      return {
        status: 400,
        body: {
          error:
            'The uploaded timetable document could not be processed by Gemini. Please verify the PDF or image file.',
          code: 'GEMINI_INVALID_DOCUMENT',
          provider: 'gemini',
        },
      };
    }
    return {
      status: 500,
      body: {
        error:
          'Timetable AI encountered a temporary service error. Please try again.',
        code: 'GEMINI_UPSTREAM_ERROR',
        provider: 'gemini',
      },
    };
  }
}

export function createApp({ env = process.env, aiClientFactory = null, authVerifier = null } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' }));

  const handleRoute = async (req, res) => {
    const result = await processTimetableAiPayload({
      authorization: req.headers.authorization || '',
      body: req.body,
      env,
      aiClientFactory,
      authVerifier,
    });
    res.status(result.status).json(result.body);
  };

  app.options('/api/timetable-ai', (_req, res) => {
    res.set({
      'access-control-allow-origin': '*',
      'access-control-allow-headers':
        'authorization, apikey, content-type, x-client-info',
      'access-control-allow-methods': 'POST, OPTIONS',
    });
    res.status(200).send('ok');
  });
  app.options('/functions/v1/timetable-ai', (_req, res) => {
    res.set({
      'access-control-allow-origin': '*',
      'access-control-allow-headers':
        'authorization, apikey, content-type, x-client-info',
      'access-control-allow-methods': 'POST, OPTIONS',
    });
    res.status(200).send('ok');
  });

  app.post('/api/timetable-ai', handleRoute);
  app.post('/functions/v1/timetable-ai', handleRoute);

  app.use(
    express.static(__dirname, {
      etag: true,
      maxAge: 0,
    }),
  );

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const port = Number(process.env.PORT || 3000);
  const app = createApp();
  app.listen(port, '0.0.0.0', () => {
    console.log(`NEIS Circle server listening on http://0.0.0.0:${port}`);
  });
}
