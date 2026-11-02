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


// Cross-check AI-proposed grid positions against independent PDF text coordinates.
// For a PDF with readable column headings, an unlocated grid lesson is uncertain,
// not a saveable timetable entry. Explicit printed footer lessons are parsed below.
// Build the subject picker from the PDF's real multi-line column headings,
// rather than letting the model silently erase L1/L2 suffixes.
export function extractPdfSubjectHeaders(evidence: string): string[] {
  const page=(evidence||"").split(/PAGE 2 POSITIONED PDF TEXT/)[0];
  const lines=page.split("\n");
  // PDF text may split words into different y groups. Find the header band by
  // the FIRST timetable weekday, not by one exact "Day Math ..." text line.
  const parsed=lines.flatMap(line=>{
    const y=Number(line.match(/^y=(-?\d+)/)?.[1]);
    return [...line.matchAll(/x=(-?\d+):([^|\n]+)/g)].map(m=>({
      x:Number(m[1]),y,text:m[2].trim()
    })).filter(t=>Number.isFinite(y)&&Number.isFinite(t.x));
  });
  const firstDay=parsed.find(t=>/^(Sat|Sun|Mon|Tue|Wed|Thu|Fri)$/i.test(t.text));
  if(!firstDay)return [];
  const candidates=parsed.filter(t=>t.y<firstDay.y && t.y>firstDay.y-160);
  const headings=candidates.filter(t=>/^(Arabic|Math|Physic|Physics|Chemist|Chemistry|English|Biolog|Biology|ICT|Histor)$/i.test(t.text))
    .sort((a,b)=>a.x-b.x);
  if(headings.length<4)return [];
  const pretty=(name:string)=>{
    if(/^Math/i.test(name))return "Math";
    if(/^Physic/i.test(name))return "Physics";
    if(/^Chemist/i.test(name))return "Chemistry";
    if(/^Biolog/i.test(name))return "Biology";
    if(/^Histor/i.test(name))return "History";
    if(/^English/i.test(name))return "English";
    if(/^Arabic/i.test(name))return "Arabic";
    if(/^ICT/i.test(name))return "ICT";
    return "";
  };
  const result:string[]=[];
  for(const [i,h] of headings.entries()){
    const next=headings[i+1]?.x??1050;
    // A level sits below OR beside its heading, inside that subject's column.
    const level=candidates.filter(t=>t.y>=h.y-5&&t.y<=h.y+55 &&
       t.x>=h.x-12&&t.x<next&&/^l\s*[12]$/i.test(t.text))
      .sort((a,b)=>Math.abs(a.y-h.y)-Math.abs(b.y-h.y))[0];
    const title=pretty(h.text);
    if(title)result.push(title+(level?" L"+level.text.replace(/\D/g,""):""));
  }
  return [...new Set(result)];
}

export function verifyPdfGridLessons(
  lessons: unknown[],
  evidence: string,
): { accepted: Array<Record<string, unknown>>; rejected: number } {
  const rows = Array.isArray(lessons) ? lessons : [];
  const firstPage = evidence.split(/PAGE 2 POSITIONED PDF TEXT/)[0] || "";
  const headerLine = firstPage.split("\n").find((line) =>
    /x=\d+:(?:Math|Physics|Physic|Chemist|English|Arabic|Biolog|ICT|Histor)/i.test(line) &&
    /x=\d+:Day\b/i.test(line)
  );
  if (!headerLine) return {accepted: rows.filter((r): r is Record<string, unknown> => !!r && typeof r === "object"), rejected: 0};
  const tokens = [...firstPage.matchAll(/x=(\d+):([^|\n]+)/g)].map((m) => ({
    x: Number(m[1]), text: m[2].trim().toLowerCase(),
  }));
  const headings = [...headerLine.matchAll(/x=(\d+):([^|\n]+)/g)]
    .map((m) => ({x:Number(m[1]), word:m[2].trim().toLowerCase()}))
    .filter((h) => /^(arabic|math|physic|physics|chemist|english|biolog|ict|histor)/.test(h.word))
    .sort((a,b)=>a.x-b.x);
  if (headings.length < 3) return {accepted:rows.filter((r): r is Record<string, unknown>=>!!r&&typeof r==="object"),rejected:0};
  const canonical=(t:string)=>t.toLowerCase().replace(/[^a-z0-9]/g,"").replace(/maths/g,"math").replace(/physics/g,"physic").replace(/chemistry/g,"chemist").replace(/biology/g,"biolog").replace(/history/g,"histor");
  const columns=headings.map((h,i)=>{
    const next=headings[i+1]?.x ?? 1050;
    const suffix=tokens.filter((t)=>t.x>=h.x-5&&t.x<next&&/^(l[12]|[12])$/.test(t.text))
      .map((t)=>t.text).find((x)=>/^l[12]$/.test(x));
    return {x:h.x,left:i?(headings[i-1].x+h.x)/2:Math.max(0,h.x-40),
      right:next===1050?1050:(h.x+next)/2,
      name:canonical(h.word+(suffix||""))};
  });
  const accepted:Array<Record<string,unknown>>=[];
  let rejected=0;
  for(const r of rows){
    if(!r||typeof r!=="object"){rejected++;continue}
    const lesson=r as Record<string,unknown>;
    const x=Number(lesson.source_x);
    const page=Number(lesson.source_page);
    const title=canonical(String(lesson.title||""));
    const col=columns.find((c)=>x>=c.left&&x<c.right);
    // The heading survives across pages. Do not substitute adjacent columns.
    const titleBase=title.replace(/l[12]$/,"");
    const colBase=col?.name.replace(/l[12]$/,"");
    if(!Number.isFinite(x)||x<0||x>1000||!Number.isInteger(page)||
      page<1||page>5||!col||titleBase!==colBase||
      (/l[12]$/.test(title)&&col.name!==title)){
      rejected++;continue;
    }
    accepted.push(lesson);
  }
  return {accepted,rejected};
}

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
  "The timetable may CONTINUE across pages. Match x-positions and inherited column headings from previous pages, not only visible row labels.",
  "Explicit notes below the main grid may contain French Gr11, Religion Gr11, or other subjects. Extract those even if absent from main headers.",
  "Never confuse 11 AM with 11 PM or change AM/PM to fit expectations. If a printed time is internally contradictory, report it as ambiguous.",
  "Return ONLY a JSON object. Required key extracted: {all_detected_subjects: string[], detected_lessons: object[], ambiguous_items: string[]}. Optional reply. No entries array needed.",
  "extracted must have summary, document_language, page_count, all_detected_subjects, ambiguous_items, detected_lessons.",
  "Every grid lesson must include source_page (1-based) and source_x (0-1000 normalized horizontal CENTER of its actual cell); if you cannot locate it, mark it ambiguous instead. Keep exact column identity across pages.",
  "For each extracted lesson provide day_of_week, title, start_time, end_time, location, notes, source_page, source_x. All values must come from visible source evidence.",
  "Use the user's Arabic or English language. Avoid adding timetable events or choosing subjects.",
].join("\n");


// Text-layer notes are evidence only. Only parse explicit standalone lines
// with a single weekday and two written times; never guess grid locations.
// This catches subjects printed BELOW the main grid such as French Gr11.
export function parseExplicitFootnoteLessons(pdfEvidence: string): Array<Record<string, unknown>> {
  const days: Record<string, number> = {
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  };
  const found: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const rawLine of pdfEvidence.split(/\r?\n/).slice(0, 750)) {
    const line = rawLine.replace(/\bx=-?\d+:/g, "").replace(/\s*\|\s*/g, " ")
      .replace(/\s+/g, " ").trim();
    // Require a visible leading asterisk: prevents treating unrelated grid
    // row fragments or position markers as separately scheduled lessons.
    const lead = line.match(/(?:^|\s)\*\s*([^()]{2,85})\s*\(\s*(.{5,120})\)/);
    if (!lead) continue;
    const title = lead[1].replace(/^[^\p{L}\p{N}]+/u, "").trim();
    const schedule = lead[2];
    const dayMatch = schedule.match(/\b(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?)\b/i);
    const times = [...schedule.matchAll(/\b(\d{1,2}:\d{2})\s*(am|pm)\b/gi)];
    if (!title || !dayMatch || times.length !== 2 ||
        /\b(?:and|&|sun|mon|tue|wed|thu|fri|sat)\b.*\b(?:sun|mon|tue|wed|thu|fri|sat)\b/i.test(schedule.slice(dayMatch.index! + dayMatch[0].length))) continue;
    const day = days[dayMatch[1].slice(0, 3).toLowerCase()];
    const start = normalizeTime24(times[0][1] + " " + times[0][2]);
    const end = normalizeTime24(times[1][1] + " " + times[1][2]);
    if (day === undefined || !start || !end || end <= start) continue;
    const key = [title.toLowerCase().replace(/\s+/g, ""), day].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      title, day_of_week: day, start_time: start, end_time: end,
      category: "Class", location: "", notes: "",
    });
  }
  return found.slice(0, 30);
}


/**
 * Recover only independently readable, fully timed grid cells. This is not
 * OCR or timetable prediction: headings, day labels and AM/PM must ALL be
 * present in the PDF text layer. PDF image-only uploads still use visual AI.
 * Page 2 can continue page 1's columns without repeating its headings.
 */
export function parsePdfTextGridLessons(evidence: string): Array<Record<string, unknown>> {
  const sections=(evidence.match(/PAGE \d+ POSITIONED PDF TEXT[\s\S]*?(?=PAGE \d+ POSITIONED PDF TEXT|$)/g)||[]);
  if(!sections.length)return [];
  const tokenize=(source:string)=>{
    const found:Array<{x:number;y:number;text:string}>=[];
    for(const line of source.split("\n")){
      const y=Number(line.match(/^y=(-?\d+)/)?.[1]);
      if(!Number.isFinite(y))continue;
      for(const m of line.matchAll(/x=(-?\d+):([^|\n]+)/g)){
        found.push({x:Number(m[1]),y,text:m[2].trim()});
      }
    }
    return found;
  };
  const first=tokenize(sections[0]);
  const firstDay=first.find(t=>/^(sat|sun|mon|tue|tues|wed|thu|thurs|fri)$/i.test(t.text));
  if(!firstDay)return [];
  const headings=first.filter(t=>t.y<firstDay.y&&t.y>firstDay.y-160&&
    /^(arabic|math|physic|physics|chemist|chemistry|english|biolog|biology|ict|histor)$/i.test(t.text))
    .sort((a,b)=>a.x-b.x);
  const titles=extractPdfSubjectHeaders(evidence);
  if(headings.length<4||titles.length!==headings.length)return [];
  const days:Record<string,number>={sun:0,mon:1,tue:2,tues:2,wed:3,thu:4,thurs:4,fri:5,sat:6};
  const results:Array<Record<string,unknown>>=[];
  const seen=new Set<string>();
  for(const [pageIndex,section] of sections.entries()){
    const tokens=tokenize(section);
    const dayAnchors=tokens.filter(t=>days[t.text.toLowerCase()]!==undefined&&t.x<120)
      .sort((a,b)=>a.y-b.y);
    for(let j=0;j<dayAnchors.length;j++){
      const anchor=dayAnchors[j],day=days[anchor.text.toLowerCase()];
      const nextY=dayAnchors[j+1]?.y??1050;
      for(const [colIndex,h] of headings.entries()){
        const left=colIndex?(h.x+headings[colIndex-1].x)/2:Math.max(0,h.x-45);
        const right=colIndex+1<headings.length?(h.x+headings[colIndex+1].x)/2:1050;
        const cell=tokens.filter(t=>t.y>=anchor.y-4&&t.y<nextY-4&&t.x>=left&&t.x<right)
          .sort((a,b)=>a.y-b.y||a.x-b.x).map(t=>t.text).join(" ");
        // Do not repair ambiguous 10 AM -> 12:30 AM, or broken time digits.
        const times=[...cell.matchAll(/\b(\d{1,2}:\d{2})\s*(am|pm)\b/gi)];
        if(times.length!==2)continue;
        const start=normalizeTime24(times[0][1]+" "+times[0][2]);
        const end=normalizeTime24(times[1][1]+" "+times[1][2]);
        if(!start||!end||end<=start)continue;
        const title=titles[colIndex];
        const id=[day,title.toLowerCase(),start,end].join("|");
        if(seen.has(id))continue;
        seen.add(id);
        results.push({title,day_of_week:day,start_time:start,end_time:end,
          source_page:pageIndex+1,source_x:Math.round((left+right)/2),
          location:/onlin/i.test(cell)?"Online":"",notes:""});
      }
    }
  }
  return results;
}

/** Exact Arabic weekday/clock notes, including right-to-left Grade 11 notes. */
export function parseArabicDatedLessons(evidence:string):Array<Record<string,unknown>>{
  const result:Array<Record<string,unknown>>=[];
  const seen=new Set<string>();
  const dayMap:Record<string,number>={
    "الاحد":0,"الاثنين":1,"الاثنين":1,"الثلاثاء":2,
    "الاربعاء":3,"الخميس":4,"الجمعة":5,"السبت":6,
  };
  const ar=(value:string)=>value.normalize("NFKC").replace(/[\u064b-\u065f\u0670\u0640]/g,"")
    .replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه");
  const pageSections=(evidence.match(/PAGE \d+ POSITIONED PDF TEXT[\s\S]*?(?=PAGE \d+ POSITIONED PDF TEXT|$)/g)||[]);
  pageSections.forEach((page,pageIndex)=>{
    for(const line of page.split("\n")){
      const coords=[...line.matchAll(/x=(-?\d+):([^|\n]+)/g)]
        .map(m=>({x:Number(m[1]),text:m[2].trim()})).sort((a,b)=>b.x-a.x);
      if(coords.length<5)continue;
      const words=coords.flatMap(item=>item.text.split(/\s+/).filter(Boolean));
      const normalized=words.map(ar);
      const dayIndex=normalized.findIndex(w=>dayMap[w.replace(/[^\p{L}]/gu,"")]!==undefined);
      if(dayIndex<1)continue;
      const day=dayMap[normalized[dayIndex].replace(/[^\p{L}]/gu,"")];
      const title=words.slice(0,dayIndex).join(" ").replace(/[()*]/g,"").trim();
      // Require a plausible Arabic subject name, not page headings or rules.
      if(!/[\p{Script=Arabic}]/u.test(title)||title.length<6||/ملاحظات/.test(ar(title)))continue;
      const times:Array<string>=[];
      for(let i=dayIndex+1;i<words.length;i++){
        const m=words[i].match(/(\d{1,2}:\d{2})/);
        if(!m)continue;
        const next=ar(words.slice(i+1,i+3).join(" "));
        const local=ar(words[i]);
        const period=/(?:^|\s)(ص|صباحا|am)(?:\s|$)/i.test(next)||/ص$/.test(local)?"AM":
          /(?:^|\s)(م|مساء|pm)(?:\s|$)/i.test(next)||/م$/.test(local)?"PM":"";
        if(period)times.push(normalizeTime24(m[1]+" "+period));
      }
      if(times.length!==2||!times[0]||!times[1]||times[1]<=times[0])continue;
      const canonicalTitle=title.replace(/\s+/g," ");
      const id=[day,ar(canonicalTitle),times.join("-")].join("|");
      if(seen.has(id))continue;seen.add(id);
      result.push({title:canonicalTitle,day_of_week:day,start_time:times[0],end_time:times[1],
        location:/اونلاين|اونلين|online/i.test(ar(words.join(" ")))?"Online":"",
        notes:"",source_page:pageIndex+1});
    }
  });
  return result.slice(0,25);
}

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

async function callCloudflare(token: string, account: string, messages: unknown[], timeoutMs=40000) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = "https://api.cloudflare.com/client/v4/accounts/" + account + "/ai/run/" + PRIMARY_MODEL;
    const result = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
      },
      // Avoid very long output and token wastage. The discovery payload is
      // intentionally small and excludes any saveable "entries" table.
      body: JSON.stringify({ messages, max_tokens: 2200, temperature: 0 }),
      signal: controller.signal,
    });
    if (!result.ok) {
      // Read ONLY provider error code metadata (never upstream prompt/body).
      const errorData = await result.json().catch(() => null);
      const code = Number(errorData?.errors?.[0]?.code || 0);
      const err = new Error("CLOUDFLARE_HTTP_ERROR") as Error & { status?: number; providerCode?: number };
      err.status = result.status;
      err.providerCode = code;
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

// Gemini is the preferred multimodal reader if a server-side Gemini key exists.
// Keep the current Cloudflare implementation as a safe fallback for unavailable
// Gemini credentials/quotas; never expose either key in the browser.
const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_FAST_FALLBACK = "gemini-3.1-flash-lite";
async function callGemini(key: string, messages: Array<{role:string;content:unknown}>, model=GEMINI_MODEL, timeoutMs=16000) {
  const controller=new AbortController();
  const deadline=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const system=String(messages[0]?.content||"");
    const content=messages[1]?.content;
    const pieces=Array.isArray(content)?content:[{type:"text",text:String(content||"")}];
    const parts=pieces.map((p:Record<string,unknown>)=>{
      if(p.type==="text")return {text:String(p.text||"")};
      const uri=String((p.image_url as {url?:string})?.url||"");
      const match=uri.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if(!match)throw new Error("INVALID_GEMINI_IMAGE");
      return {inlineData:{mimeType:match[1],data:match[2]}};
    });
    const url="https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent";
    const response=await fetch(url,{method:"POST",headers:{"x-goog-api-key":key,"Content-Type":"application/json"},
      body:JSON.stringify({systemInstruction:{parts:[{text:system}]},
        contents:[{role:"user",parts}],generationConfig:{responseMimeType:"application/json",maxOutputTokens:8192}}),
      signal:controller.signal});
    if(!response.ok){
      const err=new Error("GEMINI_HTTP_ERROR") as Error & {status?:number};
      err.status=response.status;throw err;
    }
    const result=await response.json();
    const text=(result.candidates?.[0]?.content?.parts||[]).map((p:{text?:string})=>p.text||"").join("");
    if(!text){const reason=String(result.candidates?.[0]?.finishReason||"UNKNOWN").replace(/[^A-Z_]/g,"").slice(0,32);const err=new Error("GEMINI_EMPTY_OUTPUT_"+reason) as Error & {status?:number};err.status=502;throw err;}
    return text;
  }finally{clearTimeout(deadline)}
}

// Read dense PDFs in bounded two-page chunks. Each request receives only its
// own images and positioned text, with the first page's header as context.
async function discoverGeminiByPageGroups(
  key: string,
  imageParts: Array<Record<string, unknown>>,
  evidence: string,
  systemInstruction: string,
): Promise<string> {
  const pages=evidence.split(/(?=PAGE \d+ POSITIONED PDF TEXT)/).filter(Boolean);
  const header=(pages[0]||"").slice(0,2400);
  const groups:Array<{start:number;images:Array<Record<string,unknown>>}>=[];
  for(let i=0;i<imageParts.length;i++)groups.push({start:i,images:imageParts.slice(i,i+1)});
  const responses=await Promise.all(groups.map(async group=>{
    const pageNumbers=group.images.map((_,i)=>group.start+i+1);
    const localEvidence=pageNumbers.map(n=>(pages[n-1]||"").slice(0,6500)).join("\n\n");
    const instruction="Analyze ONLY original PDF page(s) "+pageNumbers.join(", ")+
      ". Every detected lesson must use ORIGINAL source_page numbering "+pageNumbers.join(" or ")+
      " and its source_x coordinate. Do not reinterpret the attached images as page 1 unless it is original page 1."+
      " The source has continuing columns; use the first-page heading evidence to identify columns."+
      "\nFIRST PAGE HEADER CONTEXT:\n"+header+
      "\nCURRENT PAGE POSITIONED TEXT:\n"+localEvidence+
      "\nReturn extraction JSON with all_detected_subjects, detected_lessons and ambiguous_items. Do not invent sessions.";
    const messages=[
      {role:"system",content:systemInstruction},
      {role:"user",content:[{type:"text",text:instruction},...group.images]},
    ];
    let raw:string;
    try{raw=await callGemini(key,messages,GEMINI_MODEL,20000);}
    catch{
      raw=await callGemini(key,messages,GEMINI_FAST_FALLBACK,11000);
    }
    const parsed=parseModelObject(raw);
    const item=parsed?.extracted && typeof parsed.extracted==="object"?parsed.extracted:parsed;
    if(!item||!Array.isArray(item.all_detected_subjects)||!Array.isArray(item.detected_lessons))
      throw new Error("GEMINI_CHUNK_INVALID_JSON");
    const lessons=item.detected_lessons.map((lesson:Record<string,unknown>)=>{
      const copy={...lesson};
      const sourcePage=Number(copy.source_page);
      if(group.start && !pageNumbers.includes(sourcePage) &&
        sourcePage>=1 && sourcePage<=group.images.length){
        copy.source_page=group.start+sourcePage;
      }
      return copy;
    });
    return {subjects:item.all_detected_subjects.map(String),lessons,
      ambiguities:Array.isArray(item.ambiguous_items)?item.ambiguous_items.map(String):[]};
  }));
  const seenLessons=new Set<string>();
  const lessons:Array<Record<string,unknown>>=[];
  for(const group of responses)for(const lesson of group.lessons){
    const identity=[lesson.title,lesson.day_of_week,lesson.start_time,lesson.end_time,
      lesson.source_page,lesson.source_x].join("|");
    if(seenLessons.has(identity))continue;
    seenLessons.add(identity);lessons.push(lesson);
  }
  return JSON.stringify({extracted:{
    all_detected_subjects:[...new Set(responses.flatMap(x=>x.subjects))],
    detected_lessons:lessons,
    ambiguous_items:responses.flatMap(x=>x.ambiguities).slice(0,40),
    page_count:imageParts.length,
    summary:"Combined independent visual timetable page readings",
  }});
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
    const geminiKey=(Deno.env.get("GEMINI_API_KEY")||"").trim();
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
    const pdfEvidence = discoveryMode && typeof body.textEvidence === "string"
      ? body.textEvidence.slice(0, 38000) : "";
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
      ? "Read the attached timetable page images AND the independently extracted positioned PDF text below. The PDF spans multiple pages: page 2 may CONTINUE the same column headers from page 1 rather than starting a new table. Match the exact subject column and row for each lesson; do not transfer a neighbor's time to another subject. CRITICAL: also read footnotes below the grid, including French, Religion, or Grade 11 subjects. Only include lessons supported by their correct column/day or explicit standalone note. If the source has impossible AM/PM (such as 10:00 AM to 12:30 AM), flag it as ambiguous instead of guessing. No draft generation. Return JSON extraction only.\n\nPOSITIONED PDF EVIDENCE:\n" + pdfEvidence
      : "Context JSON:\n" + contextSummary + "\n\nRequest: " + (prompt || "Update this timetable draft.");
    const textPart = { type: "text", text: messageText };
    const messages = [
      { role: "system", content: discoveryMode ? DISCOVERY_INSTRUCTION : SYSTEM_INSTRUCTION },
      { role: "user", content: parts.length ? [textPart, ...parts] : textPart.text },
    ];
    let actualProvider="cloudflare";
    let raw:string;
    if(geminiKey && discoveryMode && parts.length>1){
      // Two-page requests run concurrently, not one three-page mega-request.
      raw=await discoverGeminiByPageGroups(geminiKey,parts,pdfEvidence,DISCOVERY_INSTRUCTION);
      actualProvider="gemini";
    }else if(geminiKey){
      try{raw=await callGemini(geminiKey,messages,GEMINI_MODEL,33000);actualProvider="gemini"}
      catch(primaryError){
        try{raw=await callGemini(geminiKey,messages,GEMINI_FAST_FALLBACK,13000);actualProvider="gemini-lite"}
        catch(secondaryError){
          console.error("Timetable Gemini inference failed",JSON.stringify({
            primaryStatus:Number((primaryError as {status?:number}).status||0),
            secondaryStatus:Number((secondaryError as {status?:number}).status||0),
            primaryType:primaryError instanceof Error?primaryError.name:"unknown",
            secondaryType:secondaryError instanceof Error?secondaryError.name:"unknown"
          }));
          throw secondaryError;
        }
      }
    }else raw=await callCloudflare(token,account,messages);
    const parsed = parseModelObject(raw);
    // Discovery returns "extracted", not a saveable "entries" array. The
    // previous check rejected correct extraction responses and wasted the
    // student's entire upload. Accept a direct extraction object as well.
    const extractedObject = parsed?.extracted && typeof parsed.extracted === "object"
      ? parsed.extracted as Record<string, unknown>
      : parsed;
    const hasDiscovery = !!extractedObject &&
      (Array.isArray(extractedObject.all_detected_subjects) ||
       Array.isArray(extractedObject.detected_lessons));
    if (!parsed || (discoveryMode ? !hasDiscovery : !Array.isArray(parsed.entries))) {
      return respond({
        error: "AI returned an incomplete timetable. You can retry or use the PDF's readable text to choose subjects manually.",
        code: "INVALID_MODEL_OUTPUT",
      }, 502);
    }
    // A file can only seed the guided selection wizard, never a ready-to-save
    // draft. Ignore generated entries/changed even if the AI disregards prompts.
    const entries = discoveryMode ? [] : validateAndNormalizeEntries(parsed.entries);
    const extracted = extractedObject && !Array.isArray(extractedObject)
      ? extractedObject : {};
    const explicitNotes = discoveryMode ? [
      ...parseExplicitFootnoteLessons(pdfEvidence),
      ...parseArabicDatedLessons(pdfEvidence),
    ] : [];
    const textGridLessons = discoveryMode ? parsePdfTextGridLessons(pdfEvidence) : [];
    const rawLessons = Array.isArray(extracted.detected_lessons) ? extracted.detected_lessons : [];
    const checked = discoveryMode && pdfEvidence ? verifyPdfGridLessons(rawLessons,pdfEvidence)
      : {accepted:rawLessons,rejected:0};
    const modelLessons = checked.accepted;
    // Explicit single-day printed notes outrank model guesses for that same
    // subject/day, while never touching unrelated grid lessons.
    const lessonIdentity=(r:Record<string,unknown>)=>String(r.title||"").toLowerCase()
      .replace(/\\s+/g,"").replace(/physic(s)?/g,"physics").replace(/maths/g,"math")+
      "|"+String(r.day_of_week??"");
    const independentlyVerified=[...textGridLessons,...explicitNotes];
    const groundedKeys=new Set(independentlyVerified.map(lessonIdentity));
    // The PDF's own readable, complete cells outrank a conflicting AI time.
    const groundedLessons = validateAndNormalizeEntries([
      ...modelLessons.filter((r: Record<string, unknown>)=>!groundedKeys.has(lessonIdentity(r))),
      ...independentlyVerified,
    ]);
    const pdfHeaders=discoveryMode&&pdfEvidence?extractPdfSubjectHeaders(pdfEvidence):[];
    const modelSubjects=(Array.isArray(extracted.all_detected_subjects) ? extracted.all_detected_subjects : []).map(String);
    // When PDF headings exist, they are authoritative over generic model labels.
    // For example: "Physics" must not replace separate "Physics L1"/"Physics L2".
    // Never let a generic model label erase a more specific PDF level.
    // The previous regex accidentally matched a literal backslash rather than
    // whitespace, and discarded qualified model labels when a header was generic.
    const allCandidates=[...pdfHeaders,...modelSubjects,...independentlyVerified.map(r=>String(r.title))];
    const base=(x:string)=>x.trim().toLowerCase().replace(/\\s+(?:l[12]|gr\\s*1[12])$/i,"").replace(/\\s+/g," ");
    const isQualified=(x:string)=>/\\s+(?:l[12]|gr\\s*1[12])$/i.test(x.trim());
    const qualifiedBases=new Set(allCandidates.filter(isQualified).map(base));
    const detectedSubjects=[...new Set(allCandidates.filter(x=>
      !qualifiedBases.has(base(x))||isQualified(x)))];
    return respond({
      reply: String(parsed.reply || (body.lang === "ar" ? "تم تحليل الجدول." : "Timetable analyzed. Review your draft.")).slice(0, 1400),
      changed: discoveryMode ? false : Boolean(parsed.changed),
      entries,
      extracted: {
        summary: String(extracted.summary ?? "").slice(0, 1200),
        document_language: String(extracted.document_language ?? (body.lang === "ar" ? "ar" : "en")),
        page_count: Math.max(1, Math.min(5, Number(extracted.page_count || attachments.length || 1))),
        all_detected_subjects: detectedSubjects.slice(0, 80),
        ambiguous_items: [
          ...(Array.isArray(extracted.ambiguous_items) ? extracted.ambiguous_items.map(String) : []),
          ...(checked.rejected ? [checked.rejected + " grid lesson(s) need manual review: the PDF column could not be verified."] : []),
        ].slice(0, 40),
        detected_lessons: discoveryMode ? groundedLessons : (modelLessons.length ? validateAndNormalizeEntries(modelLessons) : entries),
      },
      model: actualProvider==="gemini"?GEMINI_MODEL:actualProvider==="gemini-lite"?GEMINI_FAST_FALLBACK:PRIMARY_MODEL,
      provider: actualProvider,
    });
  } catch (error: unknown) {
    const status = Number((error as {status?: number})?.status ?? 0);
    const aborted = error instanceof Error && error.name === "AbortError";
    // Never log message text, personal data, the API token, or image contents.
    console.error("Cloudflare timetable request failure: status=" + status + ", timeout=" + aborted);
    const providerCode = Number((error as {providerCode?: number})?.providerCode ?? 0);
    const errorType=error instanceof Error?error.message:"";
    const providerIsGemini=errorType.startsWith("GEMINI_") || (status===429 && providerCode===0);
    if(providerIsGemini && status===429)return respond({
      error:"Gemini is rate limited or its available quota has been exhausted. Your PDF is still selected. Retry when the limit resets.",
      code:"GEMINI_QUOTA_LIMIT",retryAfterSeconds:60
    },429);
    if(providerIsGemini && errorType==="GEMINI_CHUNK_INVALID_JSON")return respond({
      error:"Gemini returned an incomplete page result. Your PDF has not been saved; please retry the visual import.",
      code:"GEMINI_INVALID_PAGE_RESULT"
    },502);
    if(aborted)return respond({
      error:"Gemini did not respond before the request deadline. The PDF is preserved for retry.",
      code:"GEMINI_TIMEOUT"
    },503);
    if (status === 429 && providerCode === 3036) return respond(
      { error: "Cloudflare's free daily AI allowance has been used. Keep the PDF and continue editing manually, or retry when the daily allocation resets.",
        code: "CLOUDFLARE_DAILY_LIMIT", retryAfterSeconds: 3600 }, 429
    );
    if (status === 429) return respond(
      { error: "Cloudflare inference is at capacity. Your PDF remains selected; use the partial text extraction or retry later.",
        code: providerCode === 3040 ? "CLOUDFLARE_CAPACITY" : "CLOUDFLARE_RATE_LIMIT",
        retryAfterSeconds: 30 }, 429
    );
    if (status === 403) return respond(
      { error: "Cloudflare model access is not enabled on this account.", code: "CLOUDFLARE_ACCESS_DENIED" }, 503
    );
    if (status === 408 || status === 503 || status === 502 || aborted) return respond(
      { error: "Visual AI did not finish in time. Your prepared pages are preserved; try again or continue with the readable PDF text.",
        code: aborted ? "CLOUDFLARE_TIMEOUT" : "CLOUDFLARE_TEMPORARY_ERROR" }, 503
    );
    return respond({ error: "Could not analyze timetable. Please retry.", code: "CLOUDFLARE_UPSTREAM_ERROR" }, 502);
  }
});
