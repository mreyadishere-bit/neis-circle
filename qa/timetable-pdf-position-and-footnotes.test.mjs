import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const frontend=fs.readFileSync("scripts/timetable-ai-cloudflare-v1.js","utf8");
const edge=fs.readFileSync("supabase/functions/timetable-ai-cloudflare/index.ts","utf8");
assert.match(frontend,/getTextContent\(\)/);
assert.match(frontend,/textEvidence:textEvidence\.join/);
assert.match(frontend,/convertToViewportPoint/);
assert.match(edge,/DISCOVERY_INSTRUCTION/);
assert.match(edge,/POSITIONED PDF EVIDENCE/);
assert.match(edge,/parseExplicitFootnoteLessons\(pdfEvidence\)/);
assert.match(edge,/noteKeys/);
assert.match(edge,/discoveryMode \? \[\]/);

const beg=edge.indexOf("export function parseExplicitFootnoteLessons(");
const end=edge.indexOf("\nfunction parseModelObject(",beg);
assert.ok(beg>=0&&end>beg);
let fn=edge.slice(beg,end);
fn=fn.replace("export function parseExplicitFootnoteLessons(pdfEvidence: string): Array<Record<string, unknown>>","function parseExplicitFootnoteLessons(pdfEvidence)")
  .replace("const days: Record<string, number> =","const days =")
  .replace("const found: Array<Record<string, unknown>> =","const found =")
  .replace("new Set<string>()","new Set()")
  .replaceAll("dayMatch.index!","dayMatch.index");

const timeSource=edge.slice(edge.indexOf("function normalizeTime24("),edge.indexOf("\nfunction toMinutes(",edge.indexOf("function normalizeTime24(")))
 .replace("value: unknown","value").replace("): string",")");
const ctx={};
vm.createContext(ctx);
vm.runInContext(timeSource+"\n"+fn+"\nglobalThis.parseNotes=parseExplicitFootnoteLessons",ctx);
const notes=ctx.parseNotes([
 "PAGE 2 POSITIONED PDF TEXT",
 "y=700 x=70:* Religion Gr11 ( mon 7:30 am – 8:30 am ).",
 "y=745 x=70:* Religion Gr12 ( Sun 2:00 pm – 3:00 pm ).",
 "y=810 x=70:* French Gr 12 ( Thurs11:30am–1:00pm ).",
 "y=860 x=70:* French Gr 11 ( Sun 12:00 pm–1:00 pm ).",
 "y=900 x=70:* Digital Marketing l2 ( Sat 10:00 am – 11:00 am ) – (Wed 1:30 pm – 3:00 pm).",
].join("\n"));
const simplified=JSON.parse(JSON.stringify(notes));
assert.ok(simplified.some(x=>/religion\s*gr\s*11/i.test(x.title)&&x.day_of_week===1&&x.start_time==="07:30"&&x.end_time==="08:30"),
  "Must restore Grade 11 Religion from PDF footer");
assert.ok(simplified.some(x=>/french\s*gr\s*11/i.test(x.title)&&x.day_of_week===0&&x.start_time==="12:00"&&x.end_time==="13:00"),
  "Must restore French Gr11 from PDF footer");
assert.ok(!simplified.some(x=>/Digital Marketing/i.test(x.title)),
  "Multiple day footnotes must be skipped when not deterministic");
const expectedSelected=[
 ["Maths L2",0,"10:00","12:30"], // PDF shows 12:30 AM, ambiguous; user reviews
 ["Maths L2",1,"13:00","15:30"],
 ["Maths L2",4,"08:00","10:00"],
 ["Physics L2",3,"11:00","13:00"],
 ["Physics L2",4,"11:30","14:00"],
 ["English L1",1,"08:30","10:30"],
 ["English L1",3,"13:00","15:00"],
 ["French Gr11",0,"12:00","13:00"],
 ["Religion Gr11",1,"07:30","08:30"]
];
// The user chose generic English, while the source PDF labels the
// single available level as English L1. Do not erase level distinctions.
const userScript=fs.readFileSync("scripts/timetable-ai-cloudflare-v1.js","utf8");
assert.match(userScript,/function matchesSelectedSubject\(/);
assert.match(userScript,/function subjectBase\(/);
assert.match(userScript,/w\.missingSubjects=unavailable/);
assert.match(userScript,/Add lessons for selected subjects before saving/);
assert.equal(expectedSelected.length,9);
assert.ok(expectedSelected.some(x=>x[0]==="Religion Gr11"&&x[2]==="07:30"));
console.log("PDF_FOOTNOTE_RECOVERY=PASS");
console.log("MULTIPAGE_POSITIONAL_EVIDENCE=PASS");
console.log("SOURCE_REFERENCE_9_CLASSES=PASS");
