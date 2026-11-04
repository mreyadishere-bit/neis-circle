import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const social=fs.readFileSync('scripts/05-social.js','utf8');
const sidebar=fs.readFileSync('styles/desktop-hover-rail-rtl-v4.css','utf8');
const html=fs.readFileSync('index.html','utf8');
assert.ok(!html.includes('<kbd>⌘ K</kbd>'),'keyboard hint hidden');
assert.ok(html.includes('Search people, posts, articles, opportunities'),'global search placeholder');
assert.match(sidebar,/not\(\.is-expanded\)[\s\S]*visibility:hidden!important/,'collapsed labels hidden');
assert.match(sidebar,/is-expanded[\s\S]*visibility:visible!important/,'expanded labels available');
assert.match(social,/\['article',t\('Articles'/,'articles category');
assert.match(social,/\['opportunity',t\('Opportunities'/,'opportunities category');
assert.ok(social.includes('type===\'article\'?\`articles/\${id}\`'),'article opens article route');
assert.ok(social.includes('data-search-open'),'search result delegation intact');
const begin=social.indexOf('async function searchAdditionalContent(query){');
const end=social.indexOf('\nfunction localSearchFallback',begin);
assert.ok(begin>0&&end>begin,'isolated extra search function');
const calls=[];
function queryTable(table){
 const record={table};
 const builder={
  select(fields){record.fields=fields;return builder},
  eq(field,value){record.eq=[field,value];return builder},
  or(filter){record.or=filter;return builder},
  limit(n){record.limit=n;return Promise.resolve({data:table==='articles'
   ?[{id:17,title_en:'Physics Challenge',title_ar:'تحدي الفيزياء',excerpt_en:'Science competition',category:'Education',status:'published'}]
   :[{id:'opp-1',title:'Physics Internship',description:'Learn physics',organization:'Science Lab',opportunity_type:'Internship'}],
    error:null})}
 };
 calls.push(record);return builder;
}
const context={
 sb:{from:queryTable},
 normalize:value=>String(value||'').toLocaleLowerCase(),
 t:(en)=>en,
 Promise,
};
const source=social.slice(begin,end);
vm.runInNewContext(source+'\nthis.find=searchAdditionalContent;',context);
const results=await context.find('Physics');
assert.equal(results.length,2);
assert.ok(results.some(r=>r.type==='article'&&r.title==='Physics Challenge'));
assert.ok(results.some(r=>r.type==='opportunity'&&r.title==='Physics Internship'));
assert.equal(calls.find(c=>c.table==='articles').eq[1],'published','private drafts excluded');
assert.ok(calls.every(c=>c.or.includes('ilike')),'partial title and body matching');
const arabic=await context.find('الفيزياء');
assert.equal(arabic.length,2);
assert.ok(calls.some(c=>c.table==='articles'&&c.or.includes('الفيزياء')),'Arabic preserved');
console.log('UNIFIED_SEARCH_SIDEBAR_REGRESSION=PASS');
