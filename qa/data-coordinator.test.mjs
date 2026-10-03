import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const source=fs.readFileSync(new URL('../scripts/data-coordinator-v171.js',import.meta.url),'utf8');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

let underlyingCalls=0;
async function underlyingLoad(){
  underlyingCalls+=1;
  const value=underlyingCalls;
  await delay(90);
  return value;
}

const context={
  console,
  Date,
  Promise,
  performance,
  setTimeout,
  clearTimeout,
  loadLiveData:underlyingLoad
};
context.window=context;
vm.createContext(context);
vm.runInContext(source,context,{filename:'data-coordinator-v171.js'});

assert.equal(typeof context.loadLiveData,'function');
assert.equal(context.loadLiveData.__neisDataCoordinated,true);
assert.equal(context.NEISDataCoordinator.version,'171.0');

// Same burst: two callers should share one physical load.
const first=context.loadLiveData();
const second=context.loadLiveData();
const firstResults=await Promise.all([first,second]);
assert.deepEqual(firstResults,[1,1]);
assert.equal(underlyingCalls,1,'same-burst requests should execute one underlying load');

// A request arriving during an active load must not be lost.
// It should wait for exactly one trailing load.
const third=context.loadLiveData();
await delay(60);
const fourth=context.loadLiveData();

assert.equal(underlyingCalls,2,'third request should have started its load');
const thirdValue=await third;
const fourthValue=await fourth;

assert.equal(thirdValue,2);
assert.equal(fourthValue,3,'request arriving mid-flight should resolve from the trailing refresh');
assert.equal(underlyingCalls,3,'mid-flight burst should add exactly one trailing load');

const snapshot=context.NEISDataCoordinator.snapshot();
assert.equal(snapshot.requested,4);
assert.equal(snapshot.executed,3);
assert.ok(snapshot.coalesced>=2);
assert.equal(snapshot.trailingCycles,1);
assert.equal(snapshot.failures,0);

console.log('Data coordinator unit test passed:',snapshot);
