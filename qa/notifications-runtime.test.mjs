import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../scripts/social/notifications-v174.js',import.meta.url),'utf8');

let fetchCount=0;
let renderCount=0;
let badgeCount=0;
let releaseFetch;
const pending=new Promise(resolve=>{releaseFetch=resolve});

class Query {
  select(){return this}
  order(){return this}
  limit(){
    fetchCount+=1;
    return pending.then(()=>({data:[{id:'n1',read_at:null,created_at:'2026-10-03T12:00:00Z'}],error:null}));
  }
}

const context={
  console,
  Date,
  Promise,
  setInterval:()=>1,
  clearInterval:()=>{},
  state:{notifications:[],view:'home'},
  authUser:{id:'u1'},
  updateBadges(){badgeCount+=1},
  render(){renderCount+=1},
  sb:{
    from(table){
      assert.equal(table,'notifications');
      return new Query();
    },
    channel(){
      return {
        on(){return this},
        subscribe(){return this}
      };
    },
    async removeChannel(){}
  }
};
context.window=context;
vm.createContext(context);
vm.runInContext(source,context,{filename:'notifications-v174.js'});

const api=context.NEISNotificationRuntime;
assert.equal(api.version,'174.6');

// Concurrent refreshes must share one backend request.
const first=api.refresh(false,{force:true});
const second=api.refresh(false,{force:true});
assert.equal(fetchCount,1,'notification refreshes must be single-flight');
releaseFetch();
await Promise.all([first,second]);
assert.equal(context.state.notifications.length,1);
assert.equal(context.state.notifications[0].id,'n1');
assert.equal(renderCount,0,'background notification sync must not rerender unrelated views');
assert.ok(badgeCount>=1);

// Realtime updates should only render the notifications screen.
api.applyRealtime({eventType:'INSERT',new:{id:'n2',read_at:'2026-10-03T12:01:00Z'}});
assert.equal(renderCount,0);
assert.equal(context.state.notifications[0].id,'n2');

// Push may arrive before Realtime. The later authoritative row must enrich the same item.
api.ingestPush({id:'n3',type:'message',title:'New message',body:'Hello',route:'messages/c1',created_at:'2026-10-03T12:03:00Z'});
assert.equal(context.state.notifications.filter(n=>n.id==='n3').length,1);
api.applyRealtime({eventType:'INSERT',new:{
  id:'n3',
  type:'message',
  entity_type:'message',
  entity_id:'m3',
  route:'messages/c1?message=m3',
  read_at:null,
  created_at:'2026-10-03T12:03:00Z'
}});
const merged=context.state.notifications.find(n=>n.id==='n3');
assert.equal(merged.entity_type,'message','Realtime row must enrich the push placeholder');
assert.equal(merged.entity_id,'m3');
assert.equal(merged.route,'messages/c1?message=m3');
assert.equal(context.state.notifications.filter(n=>n.id==='n3').length,1,'Push and Realtime must not duplicate notification rows');

context.state.view='notifications';
api.applyRealtime({eventType:'UPDATE',new:{id:'n2',read_at:'2026-10-03T12:02:00Z'}});
assert.equal(renderCount,1,'notifications view may rerender itself');
assert.equal(context.state.notifications[0].read_at,'2026-10-03T12:02:00Z');

api.applyRealtime({eventType:'DELETE',old:{id:'n2'}});
assert.equal(context.state.notifications.some(n=>n.id==='n2'),false);

console.log('Notification runtime unit test passed:',api.snapshot());
