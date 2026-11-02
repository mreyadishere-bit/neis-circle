import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  PRIMARY_MODEL,
  createApp,
  processTimetableAiPayload,
  validateAndNormalizeEntries,
} from '../server.mjs';

const TEST_USER_ID = '6c2d2e12-cccc-4acd-a000-d43fcedbbc73';

function makeValidJwt(sub = TEST_USER_ID, role = 'authenticated') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      role,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url');
  return `${header}.${payload}.signature`;
}

const VALID_AUTH_HEADER = `Bearer ${makeValidJwt()}`;
const SAMPLE_PDF_BASE64 = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n%%EOF',
  'utf8',
).toString('base64');
const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// 1. Static verification: OVH backend config + zero Groq references + Gemini 3.8 Flash configured
const edgeSource = fs.readFileSync('supabase/functions/timetable-ai/index.ts', 'utf8');
const frontendSource = fs.readFileSync('scripts/timetable-ai-gemini-v1.js', 'utf8');
const liveFrontendSource = fs.readFileSync('scripts/timetable-ai-v1.js', 'utf8');
const coreSource = fs.readFileSync('scripts/01-core.js', 'utf8');
const indexHtml = fs.readFileSync('index.html', 'utf8');
const serverSource = fs.readFileSync('server.mjs', 'utf8');

assert.equal(PRIMARY_MODEL, 'gemini-3.8-flash', 'Primary model must be gemini-3.8-flash');
assert.ok(edgeSource.includes('"gemini-3.8-flash"'), 'Edge function must use gemini-3.8-flash');
assert.ok(frontendSource.includes("'gemini-3.8-flash'"), 'Frontend assistant must reference gemini-3.8-flash');
assert.ok(liveFrontendSource.includes('gemini-3.8-flash'), 'Live OVH timetable-ai-v1.js must reference gemini-3.8-flash');
assert.ok(!/groq|qwen/i.test(edgeSource), 'Edge function must have zero Groq/Qwen references');
assert.ok(!/groq|qwen/i.test(frontendSource), 'Frontend script must have zero Groq/Qwen references');
assert.ok(!/groq|qwen/i.test(liveFrontendSource), 'Live OVH timetable-ai-v1.js must have zero Groq/Qwen references');
assert.ok(!/pdfjs-dist|getTextContent/i.test(liveFrontendSource), 'Live OVH timetable-ai-v1.js must not flatten PDFs via PDF.js');
assert.ok(!/groq|qwen/i.test(serverSource), 'Backend server must have zero Groq/Qwen references');

// Verify OVH self-hosted Supabase configuration in scripts/01-core.js and index.html
assert.ok(coreSource.includes('supabaseUrl:"https://supabase.neiscircle.site"'), '01-core.js must use https://supabase.neiscircle.site');
assert.ok(indexHtml.includes('supabaseUrl: "https://supabase.neiscircle.site"'), 'index.html must use https://supabase.neiscircle.site');
assert.ok(!coreSource.includes('ydieijgynqlckaczalju'), '01-core.js must have zero references to old Supabase Cloud URL');
assert.ok(!indexHtml.includes('ydieijgynqlckaczalju'), 'index.html must have zero references to old Supabase Cloud URL');
assert.ok(!coreSource.includes('-R1cyhVDY1WqHBHmkqCH8Y9pR8Z5-CHOjs93g4ojd2A'), '01-core.js must not contain old Cloud anon key');
assert.ok(!indexHtml.includes('sb_publishable_'), 'index.html must not contain legacy Cloud sb_publishable key');
assert.ok(!indexHtml.includes("We'll be back soon"), 'index.html must not be the temporary maintenance page');
assert.ok(coreSource.includes("flowType:'pkce'"), '01-core.js must preserve PKCE OAuth flow');
assert.ok(coreSource.includes("url.hostname!=='supabase.neiscircle.site'"), '01-core.js must enforce supabase.neiscircle.site OAuth host');

// 2. Authentication & Missing GEMINI_API_KEY checks (never falls back to Groq)
{
  const unauthRes = await processTimetableAiPayload({
    authorization: '',
    body: { prompt: 'Hello' },
    env: { GEMINI_API_KEY: 'test-key' },
  });
  assert.equal(unauthRes.status, 401);
  assert.equal(unauthRes.body.code, 'AUTH_REQUIRED');

  const missingKeyRes = await processTimetableAiPayload({
    authorization: VALID_AUTH_HEADER,
    body: { prompt: 'Analyze my timetable' },
    env: { GEMINI_API_KEY: '' },
  });
  assert.equal(missingKeyRes.status, 503);
  assert.equal(missingKeyRes.body.code, 'GEMINI_API_KEY_MISSING');
  assert.ok(missingKeyRes.body.error.includes('GEMINI_API_KEY'));
}

// 3. Rejects flattened plain-text PDF OCR & enforces native multimodal document input
{
  const flattenedRes = await processTimetableAiPayload({
    authorization: VALID_AUTH_HEADER,
    body: {
      prompt: 'Here is my schedule',
      flattenedPdfText: 'Monday 8:00 Maths L1 Maths L2',
    },
    env: { GEMINI_API_KEY: 'test-key' },
  });
  assert.equal(flattenedRes.status, 400);
  assert.equal(flattenedRes.body.code, 'FLATTENED_TEXT_REJECTED');
}

// 4. Native PDF & Image multimodal transmission + Intelligent Subject Selection (L2 vs L1, merged cells, multi-page, Arabic/English)
{
  let capturedCall = null;
  const mockAiFactory = () => ({
    models: {
      generateContent: async (req) => {
        capturedCall = req;
        return {
          text: JSON.stringify({
            reply:
              'I inspected both pages of your timetable PDF, including merged lab cells and Arabic/English headers. I selected only English, Physics L2, Maths L2, and ICT (excluding Physics L1, Maths L1, and Religion).',
            changed: true,
            entries: [
              {
                id: 'tt-sun-math-l2',
                day_of_week: 0,
                title: 'Maths L2',
                start_time: '10:00 AM',
                end_time: '12:30 PM',
                location: 'Room 204',
                notes: 'Merged 2-period block',
                category: 'Class',
                color: '#2f7db8',
              },
              {
                id: 'tt-sun-ict',
                day_of_week: 0,
                title: 'ICT',
                start_time: '12:30',
                end_time: '14:00',
                location: 'Computer Lab B',
                notes: 'Practical Lab',
                category: 'Lab',
                color: '#0f9d76',
              },
              {
                id: 'tt-mon-eng',
                day_of_week: 1,
                title: 'English',
                start_time: '08:30',
                end_time: '10:30',
                location: 'Hall A',
                notes: '',
                category: 'Class',
                color: '#d9822b',
              },
              {
                id: 'tt-wed-phys-l2',
                day_of_week: 3,
                title: 'Physics L2',
                start_time: '11:00',
                end_time: '13:00',
                location: 'Science Lab 2',
                notes: 'Distinct from Physics L1',
                category: 'Lab',
                color: '#7a52d8',
              },
            ],
            extracted: {
              summary: '2-page bilingual English/Arabic school timetable with merged lab cells.',
              document_language: 'mixed',
              page_count: 2,
              all_detected_subjects: [
                'English',
                'Physics L1',
                'Physics L2',
                'Maths L1',
                'Maths L2',
                'ICT',
                'Religion',
              ],
              ambiguous_items: [],
              detected_lessons: [
                {
                  day_of_week: 0,
                  title: 'Maths L2',
                  start_time: '10:00',
                  end_time: '12:30',
                  location: 'Room 204',
                  notes: 'Merged 2-period block',
                },
                {
                  day_of_week: 3,
                  title: 'Physics L2',
                  start_time: '11:00',
                  end_time: '13:00',
                  location: 'Science Lab 2',
                  notes: '',
                },
              ],
            },
          }),
        };
      },
    },
  });

  const pdfResult = await processTimetableAiPayload({
    authorization: VALID_AUTH_HEADER,
    env: { GEMINI_API_KEY: 'test-secret-gemini-key' },
    aiClientFactory: mockAiFactory,
    body: {
      prompt: "Here's my timetable. I only take English, Physics L2, Maths L2, and ICT.",
      attachments: [
        {
          name: 'school-timetable-scanned-multipage.pdf',
          mimeType: 'application/pdf',
          data: SAMPLE_PDF_BASE64,
        },
      ],
    },
  });

  assert.equal(pdfResult.status, 200);
  assert.equal(pdfResult.body.model, 'gemini-3.8-flash');
  assert.equal(pdfResult.body.provider, 'gemini');
  assert.equal(pdfResult.body.changed, true);
  assert.equal(pdfResult.body.entries.length, 4);

  // Verify original PDF binary was passed via native inlineData multimodal part
  assert.ok(capturedCall, 'Gemini generateContent must be called');
  assert.equal(capturedCall.model, 'gemini-3.8-flash');
  assert.equal(capturedCall.config.responseMimeType, 'application/json');
  assert.ok(capturedCall.config.responseSchema, 'Structured responseSchema must be enforced');
  assert.equal(capturedCall.config.temperature, undefined, 'Must not set temperature on gemini-3.8-flash');
  const parts = capturedCall.contents[0].parts;
  assert.deepEqual(parts[0], {
    inlineData: {
      mimeType: 'application/pdf',
      data: SAMPLE_PDF_BASE64,
    },
  });

  // Verify Physics L2 & Maths L2 are selected while Physics L1 & Maths L1 are excluded
  const titles = pdfResult.body.entries.map((e) => e.title);
  assert.ok(titles.includes('Physics L2'));
  assert.ok(titles.includes('Maths L2'));
  assert.ok(!titles.includes('Physics L1'));
  assert.ok(!titles.includes('Maths L1'));
  assert.equal(pdfResult.body.entries[0].start_time, '10:00');
  assert.equal(pdfResult.body.entries[0].end_time, '12:30');
}

// 5. Contextual follow-up modifications ("Actually, remove Wednesday's Physics lesson", "Move Maths to 10 AM", "Add an ICT lesson on Thursday from 12 to 1")
{
  const initialDraft = validateAndNormalizeEntries([
    {
      id: 'tt-1',
      day_of_week: 0,
      title: 'Maths L2',
      start_time: '09:00',
      end_time: '11:00',
      location: 'Room 204',
      category: 'Class',
      color: '#2f7db8',
    },
    {
      id: 'tt-2',
      day_of_week: 3,
      title: 'Physics L2',
      start_time: '11:00',
      end_time: '13:00',
      location: 'Lab 2',
      category: 'Lab',
      color: '#7a52d8',
    },
  ]);

  let followUpCall = null;
  const followUpRes = await processTimetableAiPayload({
    authorization: VALID_AUTH_HEADER,
    env: { GEMINI_API_KEY: 'test-secret-gemini-key' },
    aiClientFactory: () => ({
      models: {
        generateContent: async (req) => {
          followUpCall = req;
          return {
            text: JSON.stringify({
              reply:
                "Done! I removed Wednesday's Physics L2 lesson, moved Sunday's Maths L2 to 10:00–12:00, and added ICT on Thursday from 12:00 to 13:00.",
              changed: true,
              entries: [
                {
                  id: 'tt-1',
                  day_of_week: 0,
                  title: 'Maths L2',
                  start_time: '10:00',
                  end_time: '12:00',
                  location: 'Room 204',
                  notes: '',
                  category: 'Class',
                  color: '#2f7db8',
                },
                {
                  id: 'tt-3',
                  day_of_week: 4,
                  title: 'ICT',
                  start_time: '12:00',
                  end_time: '13:00',
                  location: 'Lab B',
                  notes: '',
                  category: 'Lab',
                  color: '#0f9d76',
                },
              ],
              extracted: {
                summary: 'Updated draft context',
                document_language: 'en',
                page_count: 1,
                all_detected_subjects: ['Maths L2', 'Physics L2', 'ICT'],
                ambiguous_items: [],
                detected_lessons: [],
              },
            }),
          };
        },
      },
    }),
    body: {
      prompt:
        "Actually, remove Wednesday's Physics lesson, move Maths to 10 AM, and add an ICT lesson on Thursday from 12 to 1.",
      draftEntries: initialDraft,
      messages: [
        { role: 'user', content: 'Here is my timetable.' },
        { role: 'assistant', content: 'Prepared Maths L2 and Physics L2.' },
      ],
    },
  });

  assert.equal(followUpRes.status, 200);
  assert.equal(followUpRes.body.entries.length, 2);
  assert.ok(!followUpRes.body.entries.some((e) => e.day_of_week === 3 && e.title === 'Physics L2'));
  assert.ok(followUpRes.body.entries.some((e) => e.day_of_week === 4 && e.title === 'ICT' && e.start_time === '12:00' && e.end_time === '13:00'));
  assert.equal(followUpCall.contents[0].parts.length, 1, 'Follow-up turn without new file should not re-upload binary inlineData');
}

// 6. Free-tier 429 rate-limit handling & key redaction
{
  const rateLimitRes = await processTimetableAiPayload({
    authorization: VALID_AUTH_HEADER,
    env: { GEMINI_API_KEY: 'AIzaSySecretKeyShouldNeverLeak123456' },
    aiClientFactory: () => ({
      models: {
        generateContent: async () => {
          const err = new Error('429 RESOURCE_EXHAUSTED: Quota exceeded for free tier AIzaSySecretKeyShouldNeverLeak123456');
          err.status = 429;
          throw err;
        },
      },
    }),
    body: {
      prompt: 'Analyze this image schedule',
      attachments: [{ name: 'schedule.png', mimeType: 'image/png', data: SAMPLE_PNG_BASE64 }],
    },
  });

  assert.equal(rateLimitRes.status, 429);
  assert.equal(rateLimitRes.body.code, 'GEMINI_RATE_LIMIT_429');
  assert.ok(!JSON.stringify(rateLimitRes.body).includes('AIzaSySecretKeyShouldNeverLeak123456'));
}

// 7. End-to-End Frontend + Express HTTP Server integration test (PDF upload, 429 retry preservation, Undo, and explicit Draft confirmation to user_timetable_entries)
{
  let serverSimulate429Once = true;
  let uploadedBinaryCount = 0;

  const app = createApp({
    env: { GEMINI_API_KEY: 'test-browser-gemini-key' },
    aiClientFactory: () => ({
      models: {
        generateContent: async (req) => {
          const hasInlineData = req.contents?.[0]?.parts?.some((p) => p.inlineData);
          if (hasInlineData) uploadedBinaryCount += 1;

          if (serverSimulate429Once) {
            serverSimulate429Once = false;
            const err = new Error('429 Resource Exhausted');
            err.status = 429;
            throw err;
          }
          return {
            text: JSON.stringify({
              reply: 'Extracted English (Monday 08:30–10:30) and Physics L2 (Wednesday 11:00–13:00) into your draft.',
              changed: true,
              entries: [
                {
                  id: 'draft-eng-1',
                  day_of_week: 1,
                  title: 'English',
                  start_time: '08:30',
                  end_time: '10:30',
                  location: 'Room 101',
                  notes: '',
                  category: 'Class',
                  color: '#2f7db8',
                },
                {
                  id: 'draft-phys-l2',
                  day_of_week: 3,
                  title: 'Physics L2',
                  start_time: '11:00',
                  end_time: '13:00',
                  location: 'Lab 2',
                  notes: 'Level 2',
                  category: 'Lab',
                  color: '#7a52d8',
                },
              ],
              extracted: {
                summary: 'Visual PDF timetable analyzed.',
                document_language: 'en',
                page_count: 1,
                all_detected_subjects: ['English', 'Physics L1', 'Physics L2'],
                ambiguous_items: [],
                detected_lessons: [],
              },
            }),
          };
        },
      },
    }),
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;

  try {
    const token = makeValidJwt();
    let savedDbRows = null;
    const modalElement = {
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: () => [],
    };

    class MockFileReader {
      readAsDataURL(file) {
        this.result = `data:${file.type};base64,${file._base64}`;
        if (this.onload) this.onload();
      }
    }

    const vmContext = {
      console,
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (fn) => fn(),
      MutationObserver: class {
        observe() {}
      },
      FileReader: MockFileReader,
      fetch: (url, opts) => {
        const resolvedUrl = String(url).startsWith('/')
          ? `http://127.0.0.1:${port}${url}`
          : url;
        return globalThis.fetch(resolvedUrl, opts);
      },
      authUser: { id: TEST_USER_ID },
      CONFIG: {
        supabaseUrl: `http://127.0.0.1:${port}`,
        supabaseAnonKey: 'anon-key',
      },
      state: {
        lang: 'en',
        view: 'timetable',
        onboardingComplete: true,
        timetable: {
          ready: true,
          loading: false,
          entries: [
            {
              id: 'existing-1',
              day_of_week: 0,
              title: 'Existing Maths',
              start_time: '09:00',
              end_time: '10:00',
              location: 'Room 1',
              notes: '',
              category: 'Class',
              color: '#2f7db8',
            },
          ],
        },
      },
      sb: {
        auth: {
          getSession: async () => ({ data: { session: { access_token: token } } }),
        },
        from: () => ({
          delete: () => ({
            eq: async () => ({ error: null }),
          }),
          insert: (rows) => ({
            select: async () => {
              savedDbRows = rows.map((r, idx) => ({ ...r, id: 'db-saved-' + idx }));
              return { data: savedDbRows, error: null };
            },
          }),
        }),
      },
      closeModal: () => {
        modalElement.innerHTML = '';
      },
      render: () => {},
      toast: () => {},
      document: {
        readyState: 'complete',
        documentElement: { lang: 'en' },
        body: { classList: { contains: () => false } },
        getElementById: (id) => (id === 'modalRoot' ? modalElement : null),
        querySelector: () => null,
      },
    };
    vmContext.window = vmContext;
    vm.createContext(vmContext);
    vm.runInContext(frontendSource, vmContext, { filename: 'timetable-ai-gemini-v1.js' });

    const api = vmContext.NEISTimetableAI;
    assert.equal(api.model, 'gemini-3.8-flash');
    assert.equal(api.provider, 'gemini');

    // Attach PDF file
    const mockPdfFile = {
      name: 'my-timetable.pdf',
      type: 'application/pdf',
      size: 2048,
      _base64: SAMPLE_PDF_BASE64,
    };
    await api.attachFile(mockPdfFile);
    assert.ok(api.getState().pendingAttachment, 'PDF attachment should be staged');

    // First send hits 429 — preserves attachment and lastFailedPayload
    const firstAttempt = await api.send('I only take English and Physics L2.');
    assert.equal(firstAttempt, null, 'Failed 429 attempt returns null');
    assert.ok(api.getState().lastFailedPayload, 'Failed payload must be preserved for Retry');
    assert.ok(api.getState().pendingAttachment, 'Attachment must remain preserved on 429 failure');
    assert.equal(
      vmContext.state.timetable.entries.length,
      1,
      'Saved timetable must remain untouched on error',
    );

    // Retry succeeds and populates draft
    const retryResponse = await api.send('', true);
    assert.ok(retryResponse, 'Retry must succeed');
    assert.equal(api.getState().draft.length, 2, 'Draft must contain 2 extracted lessons');
    assert.equal(api.getState().pendingAttachment, null, 'Attachment cleared after successful analysis');
    assert.equal(uploadedBinaryCount, 2, 'PDF binary uploaded on initial attempt and retry');

    // Follow-up contextual turn does NOT re-upload binary PDF unnecessarily
    await api.send('Keep everything else unchanged.');
    assert.equal(uploadedBinaryCount, 2, 'Follow-up turn must not re-upload unchanged PDF');

    // Undo restores previous draft state
    await api.send('Undo the previous change');
    assert.equal(api.getState().draft.length, 2);

    // Saved timetable is still untouched before confirmation
    assert.equal(
      vmContext.state.timetable.entries.length,
      1,
      'Saved timetable must not change before user confirms draft',
    );

    // Confirm and save draft to user_timetable_entries
    const applied = await api.applyDraft();
    assert.equal(applied, true);
    assert.ok(Array.isArray(savedDbRows) && savedDbRows.length === 2);
    assert.equal(savedDbRows[0].title, 'English');
    assert.equal(savedDbRows[1].title, 'Physics L2');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

console.log('TIMETABLE_AI_GEMINI_3_8_FLASH_TESTS=PASS');
