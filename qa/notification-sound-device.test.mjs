import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const src=fs.readFileSync('scripts/social/notifications-v174.js','utf8');
const sw=fs.readFileSync('neis-pwa-sw.js','utf8');
const pwa=fs.readFileSync('scripts/pwa-install-v117.js','utf8');
assert.match(sw,/PUSH_REFRESH_URL = "https:\/\/supabase\.neiscircle\.site\/functions\/v1\/refresh-web-push-subscription"/);
assert.match(pwa,/neis-pwa-sw\.js\?v=13/);
assert.match(pwa,/data-test-notification-sound/);
assert.match(pwa,/data-pwa-onboarding-sound/);
assert.match(pwa,/event==='SIGNED_OUT'/);
assert.match(pwa,/\['INITIAL_SESSION','SIGNED_IN'\]\.includes\(event\)/);
assert.match(pwa,/NEISNotificationRuntime\?\.refresh\?\.\(true,\{force:true\}\)/);

const actions={};
const store=new Map();
let audible=0,gestureAllowed=false,attempts=0;
let latestAudioContext=null;
class MockAudioContext {
  constructor(){this.state='suspended';this.currentTime=0;this.destination={};latestAudioContext=this;}
  async resume(){attempts++;if(gestureAllowed)this.state='running';}
  createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}
  createOscillator(){audible++;return {type:'',frequency:{setValueAtTime(){}},connect(){},start(){},stop(){}};}
}
const context={
 window:{AudioContext:MockAudioContext},
 document:{addEventListener:(event,listener)=>{actions[event]=listener;},title:''},
 state:{notifications:[],view:'home'},
 localStorage:{getItem:key=>store.get(key)||null},
 sessionStorage:{getItem:()=>null,setItem:()=>{}},
 authUser:{id:'synthetic-test-id'},
 updateBadges(){},render(){},
 setInterval:()=>0,clearInterval(){},setTimeout:()=>0,
 console,Date,Promise
};
vm.createContext(context);
vm.runInContext(src,context);
const nt=context.window.NEISNotificationRuntime;
assert(nt);
assert.equal(nt.soundEnabledOnThisDevice(),true);
// Browser initially refuses AudioContext.resume even if the first click fires.
actions.pointerdown();
await Promise.resolve();
assert.equal(nt.snapshot().soundUnlocked,false);
gestureAllowed=true;
actions.pointerdown();
await Promise.resolve();
await Promise.resolve();
assert.equal(nt.snapshot().soundUnlocked,true);
assert.ok(attempts>=2);

// Never chime for first hydration (past notifications), only later arrivals.
const row=id=>({id,read_at:null,title:'Test',created_at:new Date().toISOString()});
nt.applyRows([row('old')],{soundForNew:true});
await Promise.resolve();
assert.equal(audible,0);
nt.applyRows([row('new'),row('old')],{soundForNew:true});
await Promise.resolve();
assert.ok(audible>0,'new notification plays after baseline loaded');
const afterFirst=audible;
nt.ingestPush({...row('new'),silent:false});
await Promise.resolve();
assert.equal(audible,afterFirst,'same push and poll notification must not chime twice');

store.set('neis-device-push-prefs-v1:synthetic-test-id',JSON.stringify({sound:false}));
nt.ingestPush(row('muted'));
await Promise.resolve();
assert.equal(audible,afterFirst,'device-local sound setting must mute chimes');
assert.equal(nt.soundEnabledOnThisDevice(),false);
assert.equal(await nt.playSound(true),true,'manual test-sound must work even when alerts muted');
assert.ok(audible>afterFirst,'sound test is audible');
store.set('neis-device-push-prefs-v1:synthetic-test-id',JSON.stringify({sound:true}));
gestureAllowed=false;
latestAudioContext.state='suspended';
const beforeBlocked=audible;
nt.ingestPush(row('blocked'));
await Promise.resolve(); await Promise.resolve();
assert.equal(audible,beforeBlocked,'a blocked browser must not claim to play audio');
assert.equal(nt.snapshot().pendingSound,true,'blocked notification must remain pending');
gestureAllowed=true;
actions.pointerdown();
await Promise.resolve();await Promise.resolve();await Promise.resolve();await Promise.resolve();
assert.ok(audible>beforeBlocked,'pending notification rings after trusted gesture');
assert.equal(nt.snapshot().pendingSound,false);
const playedOnce=audible;
nt.ingestPush(row('blocked'));
await Promise.resolve();await Promise.resolve();
assert.equal(audible,playedOnce,'retries must not duplicate a successfully played notification');
// The notification badge remains intact.
assert.equal(context.document.title,'(3) NEIS Circle');
console.log('NOTIFICATION_SOUND_DEVICE_TEST=PASS');
