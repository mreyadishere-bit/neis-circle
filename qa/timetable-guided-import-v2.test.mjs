import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {webcrypto} from "node:crypto";

const source=fs.readFileSync("scripts/timetable-ai-cloudflare-v1.js","utf8");
const edge=fs.readFileSync("supabase/functions/timetable-ai-cloudflare/index.ts","utf8");
const css=fs.readFileSync("styles/timetable-ai-v1.css","utf8");
assert.match(source,/mode:file\?"discover":"edit"/);
assert.match(source,/startWizard\(data\.extracted\)/);
assert.match(source,/void submit\(""\)/);
assert.match(source,/stateAI\.wizard\.step==="review"/);
assert.match(edge,/DISCOVERY_INSTRUCTION/);
assert.match(edge,/entries = discoveryMode \? \[\] : validateAndNormalizeEntries/);
assert.match(edge,/changed: discoveryMode \? false/);
assert.match(css,/ttai-wiz-subjects/);
assert.match(css,/ttai-wiz-edit-grid/);

const exposed="globalThis.__test={stateAI,subjectKey,suggestedColor,normalizeSubjects,startWizard,buildWizardDraft,normalizeDraft,diff,rows};";
const injectable=source.replace(/\}\)\(\);\s*$/,exposed+"\n})();");
assert.notEqual(injectable,source);
const ctx={
  document:{readyState:"loading",addEventListener(){}},
  crypto:webcrypto,window:{},structuredClone,console,Set,Map,
  state:{lang:"en",timetable:{rows:[],ready:true},view:"timetable",onboardingComplete:true},
  authUser:{id:"11111111-1111-4111-8111-111111111111"},
};
vm.createContext(ctx);vm.runInContext(injectable,ctx);
const api=ctx.__test;
const ref=[
  ["Maths L2",0,"10:00","12:30","School","#2f7db8"],
  ["ICT",0,"12:30","14:00","School","#10a879"],
  ["Religion",1,"07:30","08:30","School","#5e6a78"],
  ["English",1,"08:30","10:30","Online","#efb83f"],
  ["Maths L2",1,"13:00","15:30","School","#2f7db8"],
  ["ICT",2,"10:00","11:30","School","#10a879"],
  ["Physics L2",3,"11:00","13:00","Online","#7a52d8"],
  ["English",3,"13:00","15:00","Online","#efb83f"],
  ["Maths L2",4,"08:00","10:00","School","#2f7db8"],
  ["Physics L2",4,"11:30","14:00","Online","#7a52d8"]
];
const original=ref.map(([title,day_of_week,start_time,end_time,location,color],i)=>({
  id:"11111111-1111-4111-8111-"+String(i+1).padStart(12,"0"),
  title,day_of_week,start_time,end_time,location,color,category:"Class",updated_at:"2026-10-01"
}));
ctx.state.timetable.rows=original;
api.stateAI.original=api.rows();api.stateAI.draft=structuredClone(api.stateAI.original);
assert.equal(api.diff().update.length,0);
assert.equal(new Set(api.rows().map(x=>x.color)).size,5,"Five subject colors from correct screenshot preserved");
const subjects=api.normalizeSubjects({
  all_detected_subjects:["English","Physics L2","Maths L2","ICT","Religion","Physics L1"," ICT "],
  detected_lessons:[]
});
assert.deepEqual(Array.from(subjects),["English","Physics L2","Maths L2","ICT","Religion","Physics L1"]);
assert.notEqual(api.subjectKey("Physics L1"),api.subjectKey("Physics L2"));
assert.equal(api.suggestedColor("Physics L2"),"#7a52d8");
assert.equal(api.suggestedColor("ICT"),"#10a879");
const extracted={
 all_detected_subjects:["English","Maths L2","Physics L2","ICT","Chemistry"],
 ambiguous_items:["Unclear handwritten time on Friday"],
 detected_lessons:[
  {title:"English",day_of_week:1,start_time:"08:30",end_time:"10:30"},
  {title:"Maths L2",day_of_week:1,start_time:"13:00",end_time:"15:30"},
  {title:"Physics L2",day_of_week:3,start_time:"11:00",end_time:"13:00"},
  {title:"Physics L1",day_of_week:3,start_time:"15:00",end_time:"16:00"},
  {title:"Chemistry",day_of_week:2,start_time:"09:00",end_time:"10:00"},
  {title:"ICT",day_of_week:0,start_time:"12:30",end_time:"14:00"},
  {title:"English",day_of_week:1,start_time:"08:30",end_time:"10:30"}
 ]
};
api.startWizard(extracted);
assert.equal(api.stateAI.wizard.step,"subjects");
assert.equal(api.stateAI.draft.length,original.length);
const selected=["English","Physics L2","Maths L2","ICT"];
selected.forEach(x=>api.stateAI.wizard.selected.add(api.subjectKey(x)));
api.stateAI.wizard.mode="replace";
api.stateAI.wizard.locations[api.subjectKey("English")]="Online";
api.stateAI.wizard.locations[api.subjectKey("Physics L2")]="Online";
api.buildWizardDraft();
assert.equal(api.stateAI.wizard.step,"review");
const imported=JSON.parse(JSON.stringify(api.stateAI.draft));
assert.equal(imported.length,4);
assert.ok(!imported.some(x=>/Chemistry|Physics L1/.test(x.title)));
assert.ok(imported.some(x=>x.title==="Physics L2"&&x.day_of_week===3&&x.location==="Online"&&x.color==="#7a52d8"));
assert.equal(api.stateAI.original.length,original.length,"No premature save");
assert.ok(api.stateAI.wizard.warnings.length>0);

api.stateAI.draft=structuredClone(api.stateAI.original);
api.startWizard(extracted);
api.stateAI.wizard.mode="merge";
selected.forEach(x=>api.stateAI.wizard.selected.add(api.subjectKey(x)));
api.buildWizardDraft();
assert.equal(api.stateAI.draft.length,original.length,"Avoid duplicate lessons");
assert.equal(api.diff().update.length,0,"Do not recolor existing items");
assert.equal(api.normalizeDraft(api.stateAI.original).find(x=>x.title==="Physics L2").color,"#7a52d8");
const edited=structuredClone(api.stateAI.original);edited[0].color="#ff0000";
api.stateAI.draft=edited;
assert.equal(api.diff().update.length,1,"Color-only changes count");
console.log("GUIDED_IMPORT_REGRESSION=PASS");
console.log("SUBJECT_LEVEL_DISTINCTION=PASS");
console.log("COLORS_MERGE_REPLACE=PASS");
