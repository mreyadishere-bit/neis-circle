import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../scripts/secondary-data-v173.js',import.meta.url),'utf8');

class SessionStorageMock {
  constructor(){this.map=new Map()}
  get length(){return this.map.size}
  key(index){return [...this.map.keys()][index]??null}
  getItem(key){return this.map.has(String(key))?this.map.get(String(key)):null}
  setItem(key,value){this.map.set(String(key),String(value))}
  removeItem(key){this.map.delete(String(key))}
}

function makeContext(storage,counts){
  const rows={
    articles:[{id:1,title_en:'A',status:'published'}],
    gallery_items:[{id:2,caption_en:'G'}],
    profile_badges:[{user_id:'u1',badge_key:'community_builder'}]
  };
  class Query {
    constructor(table){this.table=table}
    select(){return this}
    order(){return this}
    then(resolve,reject){
      counts[this.table]=(counts[this.table]||0)+1;
      return Promise.resolve({data:rows[this.table]||[],error:null}).then(resolve,reject);
    }
  }
  const context={
    console,
    sessionStorage:storage,
    state:{articles:[],gallery:[],profileBadges:[],reports:[],isAdmin:true,view:'home'},
    authUser:{id:'u1'},
    sb:{
      from(table){return new Query(table)},
      rpc(name){
        assert.equal(name,'admin_report_details');
        counts.reports=(counts.reports||0)+1;
        return Promise.resolve({data:[{id:'r1'}],error:null});
      }
    },
    render(){counts.render=(counts.render||0)+1}
  };
  context.window=context;
  vm.createContext(context);
  vm.runInContext(source,context,{filename:'secondary-data-v173.js'});
  return context;
}

const storage=new SessionStorageMock();
const counts={};
let context=makeContext(storage,counts);

assert.equal(context.NEISSecondaryData.version,'173.0');

await context.NEISSecondaryData.loadArticles();
await context.NEISSecondaryData.loadArticles();
assert.equal(counts.articles,1,'fresh articles must be single-flight/cached in memory');

await context.NEISSecondaryData.loadGallery();
await context.NEISSecondaryData.loadGallery();
assert.equal(counts.gallery_items,1,'fresh gallery must not refetch');

await context.NEISSecondaryData.loadBadges();
await context.NEISSecondaryData.loadBadges();
assert.equal(counts.profile_badges,1,'fresh badges must not refetch');

await context.NEISSecondaryData.loadReports();
await context.NEISSecondaryData.loadReports();
assert.equal(counts.reports,1,'reports may use short in-memory TTL');

context=makeContext(storage,counts);
await context.NEISSecondaryData.loadArticles();
await context.NEISSecondaryData.loadGallery();
await context.NEISSecondaryData.loadBadges();
assert.equal(counts.articles,1,'articles should reuse session cache after runtime reload');
assert.equal(counts.gallery_items,1,'gallery should reuse session cache after runtime reload');
assert.equal(counts.profile_badges,1,'badges should reuse session cache after runtime reload');

await context.NEISSecondaryData.loadReports();
assert.equal(counts.reports,2,'private reports must not persist in session storage');

await context.NEISSecondaryData.loadArticles({force:true,useCache:false});
assert.equal(counts.articles,2,'forced article refresh must hit the backend');

context.NEISSecondaryData.clearUser();
assert.equal(storage.length,0,'clearUser must clear persistent secondary caches');

console.log('Secondary data unit test passed.');
