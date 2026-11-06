import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const normal=readFileSync('scripts/05-social.js','utf8');
const poll=readFileSync('scripts/home-polls-v170.js','utf8');
const legacy=readFileSync('scripts/public-polls-v161.js','utf8');
for(const [file,text,radio] of [['regular posts',normal,'cpImageDisplayMode'],['home polls',poll,'ppImageMode'],['legacy polls',legacy,'ppImageMode']]){
 assert.match(text,new RegExp('name="'+radio+'" value="fill" checked'),file+' should default to Fill');
 assert.doesNotMatch(text,new RegExp('name="'+radio+'" value="fit" checked'),file+' should not default to Fit');
}
assert.match(normal,/name="editPostImageDisplayMode" value="fit" \$\{currentMode==='fit'\?'checked':''\}/,'editing preserves explicitly selected Fit');
assert.match(poll,/name="ppsImageMode" value="fit" '\+\(post.image_display_mode==='fill'\?'':'checked'\)/,'editing poll preserves Fit');
const sql=readFileSync('supabase/migrations/20261106185000_post_image_fill_default.sql','utf8');
assert.match(sql,/alter table public.posts alter column image_display_mode set default 'fill'/i);
assert.doesNotMatch(sql,/update\s+(?:public\.)?posts\b/i,'migration cannot modify existing posts');
console.log('NEW_POST_FILL_EXISTING_FIT_PRESERVED=PASS');
