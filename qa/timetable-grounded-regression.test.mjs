import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {stripTypeScriptTypes} from "node:module";

const server=fs.readFileSync("supabase/functions/timetable-ai-cloudflare/index.ts","utf8");
const client=fs.readFileSync("scripts/timetable-ai-cloudflare-v1.js","utf8");
const start=server.indexOf("function normalizeTime24(");
const end=server.indexOf("function parseModelObject(",start);
assert.ok(start>0&&end>start);
const isolated=server.slice(start,end).replace(/^export /gm,"");
const stripped=stripTypeScriptTypes(isolated);
const context=vm.createContext({console});
const api=vm.runInContext(stripped+"\n({parsePdfTextGridLessons,parseArabicDatedLessons,extractPdfSubjectHeaders})",context);

const evidence=[
 "PAGE 1 POSITIONED PDF TEXT",
 "y=220 x=55:Day | x=110:Arabic | x=180:Math | x=260:Physic | x=330:Physics | x=450:English | x=600:ICT",
 "y=250 x=195:l2 | x=280:l1 | x=350:l2 | x=470:l1 | x=630:L1",
 "y=300 x=55:Sat",
 "y=480 x=55:Sun | x=180:10:00",
 "y=498 x=183:am",
 "y=514 x=183:12:30",
 "y=530 x=184:am",
 "PAGE 2 POSITIONED PDF TEXT",
 "y=286 x=55:wed | x=335:11:00",
 "y=303 x=340:am",
 "y=322 x=339:1:00",
 "y=341 x=340:pm",
 "y=390 x=50:Thu | x=335:11:30",
 "y=407 x=340:am",
 "y=427 x=339:2:00",
 "y=445 x=340:pm",
 "PAGE 3 POSITIONED PDF TEXT",
 "y=215 x=920:تربية | x=870:وطنية | x=808:للصف | x=757:الحادى | x=716:عشر | x=645:(الأربعاء | x=585:7:30 | x=555:ص | x=532:الى | x=490:8:30 | x=458:ص | x=395:اونلاين"
].join("\n");
const grid=api.parsePdfTextGridLessons(evidence);
const wed=grid.find(x=>x.title==="Physics L2"&&x.day_of_week===3);
const thu=grid.find(x=>x.title==="Physics L2"&&x.day_of_week===4);
assert.ok(wed,"continued grid must recover Wednesday Physics L2");
assert.equal(wed.start_time,"11:00");assert.equal(wed.end_time,"13:00");
assert.ok(thu,"continued grid must recover Thursday Physics L2");
assert.equal(thu.start_time,"11:30");assert.equal(thu.end_time,"14:00");
assert.ok(!grid.some(x=>x.title==="Math L2"&&x.day_of_week===0),
 "contradictory printed 10AM to 12:30AM must not become a lesson");
const arabic=api.parseArabicDatedLessons(evidence);
assert.equal(arabic.length,1,"standalone Arabic Grade 11 note must be read");
assert.equal(arabic[0].day_of_week,3);
assert.equal(arabic[0].start_time,"07:30");
assert.equal(arabic[0].end_time,"08:30");
assert.equal(arabic[0].location,"Online");
assert.match(arabic[0].title,/تربية وطنية/);
assert.match(client,/const hasOption=options.some/,"known imported subjects stay visible in edit selection");
assert.match(client,/remaining.length\?wizardText\("Review "/,"do not advertise Save on missing-subject drafts");
assert.match(client,/const actionable=w.warnings.filter/,"filter ambiguous warnings against selected subjects");
console.log("TIMETABLE_GROUNDED_REGRESSION=PASS");
