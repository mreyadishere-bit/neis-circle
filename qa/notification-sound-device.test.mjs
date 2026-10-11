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
assert.match(pwa,/Notification\.permission==='granted'\)return/);
assert.match(pwa,/function scheduleNotificationOnboarding\(delay=700\)/);
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

// Reproduce the reported bug: unread tab brackets increase from a routine
// refresh(false) after initial hydration, while the browser audio is unlocked.
const audioBeforeCountRefresh=audible;
nt.applyRows([row('dm-poll'),...context.state.notifications],{soundForNew:false});
await new Promise(resolve=>setImmediate(resolve));
assert.ok(audible>audioBeforeCountRefresh,'new DM detected by silent routine refresh must ring');
assert.equal(context.document.title,'(3) NEIS Circle');
const audioAfterCountRefresh=audible;
nt.applyRows([...context.state.notifications],{soundForNew:false});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(audible,audioAfterCountRefresh,'identical routine refresh must be silent');

// Realtime and polling must share the same de-duplication for one notification.
nt.applyRealtime({eventType:'INSERT',new:row('dm-realtime')});
await new Promise(resolve=>setImmediate(resolve));
assert.ok(audible>audioAfterCountRefresh,'incoming realtime DM must ring');
const audioAfterRealtime=audible;
nt.applyRows([...context.state.notifications],{soundForNew:false});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(audible,audioAfterRealtime,'same realtime DM on subsequent poll must not ring twice');
assert.equal(context.document.title,'(4) NEIS Circle');

store.set('neis-device-push-prefs-v1:synthetic-test-id',JSON.stringify({sound:false}));
nt.ingestPush(row('muted'));
await Promise.resolve();
assert.equal(audible,audioAfterRealtime,'device-local sound setting must mute chimes');
assert.equal(nt.soundEnabledOnThisDevice(),false);
assert.equal(await nt.playSound(true),true,'manual test-sound must work even when alerts muted');
assert.ok(audible>audioAfterRealtime,'sound test is audible');
store.set('neis-device-push-prefs-v1:synthetic-test-id',JSON.stringify({sound:true}));
gestureAllowed=false;
latestAudioContext.state='suspended';
const beforeBlocked=audible;
nt.ingestPush(row('blocked'));
await new Promise(resolve=>setImmediate(resolve));
assert.equal(audible,beforeBlocked,'a blocked browser must not claim to play audio');
assert.equal(nt.snapshot().pendingSound,true,'blocked notification must remain pending');
gestureAllowed=true;
actions.pointerdown();
await new Promise(resolve=>setImmediate(resolve));
assert.ok(audible>beforeBlocked,'pending notification rings after trusted gesture');
assert.equal(nt.snapshot().pendingSound,false);
const playedOnce=audible;
nt.ingestPush(row('blocked'));
await Promise.resolve();await Promise.resolve();
assert.equal(audible,playedOnce,'retries must not duplicate a successfully played notification');
// The actual user symptom: another component updates the shared notification
// array and calls updateBadges() => updateTabBadge(), without any event hook.
const beforeExternal=audible;
context.state.notifications=[row('external-dm'),...context.state.notifications];
nt.updateTabBadge();
await new Promise(resolve=>setImmediate(resolve));
assert.ok(audible>beforeExternal,
  'tab-bracket count changing because of an incoming DM must produce a chime');
const afterExternal=audible;
nt.updateTabBadge();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(audible,afterExternal,'rerendering the badge must not ring again');

// Explicit muting always wins, even when the counter increases.
store.set('neis-device-push-prefs-v1:synthetic-test-id',JSON.stringify({sound:false}));
context.state.notifications=[row('muted-from-badge'),...context.state.notifications];
nt.updateTabBadge();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(audible,afterExternal,'counter must respect device mute preference');
store.set('neis-device-push-prefs-v1:synthetic-test-id',JSON.stringify({sound:true}));

// The notification badge remains intact.
assert.equal(context.document.title,'(8) NEIS Circle');
assert.equal(nt.snapshot().version,'174.13');
// Check the same incoming chime pathway as live notifications, not the
// separate Test Sound which intentionally bypasses sound preferences.
store.set('neis-local-notification-sound-v1:synthetic-test-id','off');
const beforeMutedIncoming=audible;
assert.equal(await nt.testIncomingAlert(),false);
assert.equal(nt.snapshot().lastChimeResult,'device-sound-disabled');
assert.equal(audible,beforeMutedIncoming);
store.set('neis-local-notification-sound-v1:synthetic-test-id','on');
assert.equal(await nt.testIncomingAlert(),true);
assert.equal(nt.snapshot().lastChimeResult,'played');
assert.ok(audible>beforeMutedIncoming);
assert.equal(nt.soundEnabledOnThisDevice(),true);
// Remote preference must not override the explicit device-local sound value.
store.set('neis-device-push-prefs-v1:synthetic-test-id',JSON.stringify({sound:false}));
assert.equal(nt.soundEnabledOnThisDevice(),true);
assert.match(pwa,/data-test-incoming-alert/);
assert.match(pwa,/NEISNotificationRuntime\?\.setDeviceSoundEnabled/);
// Incoming chat events must chime without waiting for notifications-table
// Realtime or a badge refresh; ignore self-messages and duplicates.
const chatSource=fs.readFileSync('scripts/05-social.js','utf8');
assert.match(chatSource,/notificationRuntime\.signalIncomingMessage\?\.\(\{\s*id:incoming\.id,senderId:incoming\.sender_id,scope:'direct'/);
assert.match(chatSource,/notificationRuntime\.signalIncomingMessage\?\.\(\{\s*id:incoming\.id,senderId,scope:'circle'/);
assert.equal(nt.snapshot().version,'174.13');
const beforeRealDm=audible;
await new Promise(resolve=>setTimeout(resolve,1350));
assert.equal(await nt.signalIncomingMessage({id:'real-incoming-id',senderId:'other-student',scope:'direct'}),true);
assert.ok(audible>beforeRealDm,'actual incoming DM must play a chime');
assert.ok(nt.snapshot().lastIncomingMessageSignalAt>0);
const afterRealDm=audible;
assert.equal(await nt.signalIncomingMessage({id:'real-incoming-id',senderId:'other-student',scope:'direct'}),false);
assert.equal(audible,afterRealDm,'duplicate Realtime message must not chime again');
assert.equal(await nt.signalIncomingMessage({id:'self-sent',senderId:'synthetic-test-id',scope:'direct'}),false);
assert.equal(audible,afterRealDm,'own messages never chime');
store.set('neis-device-push-prefs-v1:synthetic-test-id',JSON.stringify({circle_messages:false}));
await new Promise(resolve=>setTimeout(resolve,1350));
assert.equal(await nt.signalIncomingMessage({id:'muted-circle',senderId:'other-student',scope:'circle'}),false);
assert.equal(audible,afterRealDm,'muted category does not ring');
store.set('neis-device-push-prefs-v1:synthetic-test-id',JSON.stringify({circle_messages:true}));
assert.equal(await nt.signalIncomingMessage({id:'circle-message',senderId:'other-student',scope:'circle'}),true);
assert.ok(audible>afterRealDm,'incoming Circle message must ring when enabled');
// Regression for production complaint: a first incoming message chimes, then
// user marks all notifications read, and two more arrive within 1.25 seconds.
const sourceMarkAll=chatSource;
assert.match(sourceMarkAll,/\.eq\('user_id',authUser\.id\)\.in\('id',unreadIds\)/,
  'Mark all read must target a snapshot of IDs owned by the current account');
assert.doesNotMatch(sourceMarkAll,/\.update\(\{read_at:readAt\}\)\.is\('read_at',null\)/,
  'Mark all read must not capture a freshly arriving notification');
context.state.notifications.forEach(n=>{if(!n.read_at)n.read_at=new Date().toISOString();});
nt.updateTabBadge();
assert.equal(context.document.title,'NEIS Circle',
  'Mark all read clears unread tab brackets');
const beforeAfterRead=audible;
const rapid1={...row('post-read-1'),type:'message',entity_id:'new-chat-msg-1'};
nt.applyRealtime({eventType:'INSERT',new:rapid1});
await new Promise(resolve=>setImmediate(resolve));
assert.ok(audible>beforeAfterRead,'first incoming message after Mark all read must ring');
const afterRapid1=audible;
assert.equal(await nt.signalIncomingMessage({
 id:'new-chat-msg-1',senderId:'other-student',scope:'direct'
}),false,'notification and chat event for same message must ring only once');
assert.equal(audible,afterRapid1);
const rapid2={...row('post-read-2'),type:'message',entity_id:'new-chat-msg-2'};
nt.applyRealtime({eventType:'INSERT',new:rapid2});
await new Promise(resolve=>setImmediate(resolve));
assert.ok(audible>afterRapid1,
  'different incoming message must ring even inside previous 1250ms window');
const afterRapid2=audible;
assert.equal(await nt.signalIncomingMessage({
 id:'new-chat-msg-2',senderId:'other-student',scope:'direct'
}),false,'do not ring same message twice across both channels');
assert.equal(audible,afterRapid2);
assert.equal(context.document.title,'(2) NEIS Circle');
console.log('POST_MARK_ALL_READ_INCOMING_SOUND=PASS');
console.log('NOTIFICATION_SOUND_DEVICE_TEST=PASS');
