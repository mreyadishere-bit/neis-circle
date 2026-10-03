import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../scripts/social/message-reactions-data-v180.js',import.meta.url),'utf8');
const context={console};
context.window=context;
vm.createContext(context);
vm.runInContext(source,context,{filename:'message-reactions-data-v180.js'});

const api=context.NEISMessageReactionData;
assert.equal(api.version,'180.0');
assert.equal(api.chunkSize,100);

const calls=[];
const sb={
  from(table){
    assert.equal(table,'message_reactions');
    return {
      select(){return this},
      in(column,ids){calls.push({column,ids:[...ids]});this._column=column;this._ids=[...ids];return this},
      order(){
        const rows=(this._ids||[]).map((id,index)=>({
          id:(this._column==='dm_message_id'?'d':'c')+'-'+id,
          [this._column]:id,
          created_at:new Date(2026,0,1,0,0,index).toISOString()
        }));
        return Promise.resolve({data:rows,error:null});
      }
    };
  }
};

const dmIds=Array.from({length:205},(_,i)=>'dm'+i);
const circleIds=['c1','c2','c2'];
const result=await api.load({sb,dmMessageIds:dmIds,circleMessageIds:circleIds});
assert.equal(result.error,null);
assert.equal(calls.length,4,'205 DM ids should use 3 chunks plus 1 Circle chunk');
assert.deepEqual(calls.map(x=>x.ids.length),[100,100,5,2]);
assert.equal(result.data.length,207);

const state={liveMessages:[{id:'m1'},{id:'m2'}],circleMessages:[{id:7},{id:8}]};
assert.deepEqual(api.idsFromState(state),{dmMessageIds:['m1','m2'],circleMessageIds:[7,8]});

const empty=await api.load({sb,dmMessageIds:[],circleMessageIds:[]});
assert.deepEqual(empty,{data:[],error:null});

console.log('Message reaction data unit test passed.');
