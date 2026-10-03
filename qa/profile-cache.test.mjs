import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../scripts/profile-cache-v172.js',import.meta.url),'utf8');

let now=1_000_000;
class FakeDate extends Date {
  static now(){return now}
}
class SessionStorageMock {
  constructor(){this.map=new Map()}
  get length(){return this.map.size}
  key(index){return [...this.map.keys()][index]??null}
  getItem(key){return this.map.has(key)?this.map.get(key):null}
  setItem(key,value){this.map.set(String(key),String(value))}
  removeItem(key){this.map.delete(String(key))}
}

const context={
  console,
  Date:FakeDate,
  sessionStorage:new SessionStorageMock()
};
context.window=context;
vm.createContext(context);
vm.runInContext(source,context,{filename:'profile-cache-v172.js'});

assert.equal(context.NEISProfileCache.version,'172.0');
assert.equal(context.NEISProfileCache.read('u1'),null);

const rows=[
  {id:'u1',full_name:'User One',grade:'Grade 11'},
  {id:'u2',full_name:'User Two',grade:'Grade 10'}
];
assert.equal(context.NEISProfileCache.write('u1',rows),true);

let cached=context.NEISProfileCache.read('u1');
assert.equal(cached.fresh,true);
assert.equal(cached.rows.length,2);
assert.equal(cached.rows[0].full_name,'User One');

now+=context.NEISProfileCache.ttlMs-1;
cached=context.NEISProfileCache.read('u1');
assert.equal(cached.fresh,true);

now+=2;
cached=context.NEISProfileCache.read('u1');
assert.equal(cached.fresh,false,'cache must become stale after TTL');

context.NEISProfileCache.clear('u1');
assert.equal(context.NEISProfileCache.read('u1'),null);

context.NEISProfileCache.write('u1',rows);
context.NEISProfileCache.write('u2',rows);
context.NEISProfileCache.clear();
assert.equal(context.NEISProfileCache.read('u1'),null);
assert.equal(context.NEISProfileCache.read('u2'),null);

console.log('Profile cache unit test passed.');
