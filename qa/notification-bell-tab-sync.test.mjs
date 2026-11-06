import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const script=fs.readFileSync('scripts/social/notifications-v174.js','utf8');
const css=fs.readFileSync('styles/app.css','utf8');
const site=fs.readFileSync('index.html','utf8');
assert.match(css,/\.top-actions \[data-action="notifications"\]>.count-badge/);
assert.match(site,/data-action="notifications"/);

let badge=null;
const bell={
  dataset:{},
  querySelector(selector){assert.equal(selector,':scope > .count-badge');return badge;},
  append(node){badge=node;}
};
const document={
  title:'',
  hidden:false,
  querySelector(selector){return selector==='.top-actions [data-action="notifications"]'?bell:null;},
  createElement(tag){assert.equal(tag,'i');return {
    className:'',
    textContent:'',
    attributes:{},
    setAttribute(k,v){this.attributes[k]=v;},
    classList:{hidden:false,toggle(className,on){assert.equal(className,'hidden');this.hidden=on;}}
  };},
  addEventListener(){}
};
const context={
  document,window:null,console,Date,Promise,
  state:{notifications:[],view:'home'},
  authUser:{id:'test-user'},
  navigator:{},
  addEventListener(){},
  updateBadges(){},render(){},
  setInterval(){},clearInterval(){},setTimeout(){}
};
context.window=context;
vm.createContext(context);
vm.runInContext(script,context);
const rt=context.NEISNotificationRuntime;
rt.updateTabBadge();
assert.equal(document.title,'NEIS Circle');
assert.equal(bell.dataset.unreadCount,'0');
assert.equal(badge,null);

rt.applyRealtime({eventType:'INSERT',new:{id:'1',read_at:null,title:'New notification'}});
assert.equal(document.title,'(1) NEIS Circle');
assert.equal(bell.dataset.unreadCount,'1');
assert.equal(badge.textContent,'1');
assert.equal(badge.classList.hidden,false);

rt.applyRealtime({eventType:'INSERT',new:{id:'2',read_at:null,title:'Another notification'}});
assert.equal(document.title,'(2) NEIS Circle');
assert.equal(badge.textContent,'2');

rt.applyRealtime({eventType:'UPDATE',new:{id:'1',read_at:new Date().toISOString()}});
assert.equal(document.title,'(1) NEIS Circle');
assert.equal(badge.textContent,'1');

rt.applyRealtime({eventType:'UPDATE',new:{id:'2',read_at:new Date().toISOString()}});
assert.equal(document.title,'NEIS Circle');
assert.equal(bell.dataset.unreadCount,'0');
assert.equal(badge.classList.hidden,true);

rt.ingestPush({id:'push-3',title:'Push notification',type:'message'});
assert.equal(document.title,'(1) NEIS Circle');
assert.equal(badge.textContent,'1');
assert.equal(badge.classList.hidden,false);

// An external module may change the array and call only updateTabBadge.
context.state.notifications=[{id:'4',read_at:null},{id:'5',read_at:null},{id:'6',read_at:null}];
rt.updateTabBadge();
assert.equal(document.title,'(3) NEIS Circle');
assert.equal(badge.textContent,'3');
assert.equal(bell.dataset.unreadCount,'3');
console.log('NOTIFICATION_BELL_TAB_SYNC=PASS');
