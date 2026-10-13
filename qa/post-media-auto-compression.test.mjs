import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';

const optimizer=fs.readFileSync('scripts/article-image-optimizer-v1.js','utf8');
const bridge=fs.readFileSync('scripts/media-auto-compression-v2.js','utf8');
const polls=fs.readFileSync('scripts/home-polls-v170.js','utf8');
const site=fs.readFileSync('scripts/02-content-admin.js','utf8');
assert.ok(polls.includes("await uploadMedia(file,'posts')"),'poll/posts call shared handler');
assert.ok(site.includes("async function uploadMedia(file,folder)"),'legacy 8MB handler exists');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
for(const [width,height] of [[1440,900],[390,780]]){
  const page=await browser.newPage({viewport:{width,height}});
  try{
    await page.setContent('<html><body><canvas id="source"></canvas></body></html>');
    await page.evaluate(()=>{
      window.__calls=[];window.__messages=[];
      window.state={lang:'en'};
      window.toast=msg=>window.__messages.push(msg);
      window.uploadMedia=async(file,folder)=>{
        if(file.size>8*1024*1024){
          window.__messages.push('Image must be smaller than 8 MB');
          return '';
        }
        window.__calls.push({bytes:file.size,mime:file.type,name:file.name,folder});
        return 'https://example.invalid/media/'+file.name;
      };
    });
    await page.addScriptTag({content:optimizer});
    await page.addScriptTag({content:bridge});
    const result=await page.evaluate(async()=>{
      if(!window.__neisMediaAutoCompressV2)throw Error('Wrapper missing');
      const canvas=document.querySelector('#source');
      canvas.width=2600;canvas.height=1800;
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='#2f77d8';ctx.fillRect(0,0,2600,1800);
      ctx.fillStyle='#e6f2fe';ctx.font='bold 160px sans-serif';
      ctx.fillText('NEIS Circle',200,650);
      const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.96));
      // Valid JPEG with trailing metadata payload: decodes normally but is 25MiB
      // on disk; verifies integration doesn't pass this huge upload upstream.
      const padding=new Uint8Array(Math.max(0,25*1048576+237-jpeg.size));
      const big=new File([jpeg,padding],'25mb.jpg',{type:'image/jpeg'});
      const small=new File([jpeg],'small.jpg',{type:'image/jpeg'});
      const a=await window.uploadMedia(big,'posts');
      const b=await window.uploadMedia(big,'circles/test');
      const c=await window.uploadMedia(small,'gallery');
      const beforeFailure=window.__calls.length;
      const gif=new File([new Uint8Array(9*1048576)],'animated.gif',{type:'image/gif'});
      const failed=await window.uploadMedia(gif,'posts');
      return {a,b,c,failed,beforeFailure,calls:window.__calls,
        messages:window.__messages,original:big.size,originalSmall:small.size};
    });
    assert.ok(result.a&&result.b&&result.c,'all 3 uploads succeed');
    assert.equal(result.failed,'','unsupported large GIF fails explicitly');
    assert.equal(result.beforeFailure,3,'failed compression never sends a file');
    assert.equal(result.calls.length,3);
    assert.deepEqual(result.calls.map(x=>x.folder),['posts','circles/test','gallery']);
    for(const upload of result.calls.slice(0,2)){
      assert.ok(upload.bytes<8*1048576,'compressed image meets old 8MB limit');
      assert.equal(upload.mime,'image/webp');
      assert.ok(upload.name.endsWith('.webp'));
    }
    assert.equal(result.calls[2].name,'small.jpg');
    assert.equal(result.calls[2].bytes,result.originalSmall);
    assert.ok(!result.messages.some(x=>x.includes('Image must be smaller than 8 MB')));
    assert.ok(result.messages.some(x=>x.includes('Image optimized:')));
    console.log('POST_25MB_UPLOAD_'+width+'=PASS '+JSON.stringify({
      source:result.original,compressed:result.calls[0].bytes,
      folders:result.calls.map(x=>x.folder),smallUnchanged:true}));
  }finally{await page.close()}
}
await browser.close();
