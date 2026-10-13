import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';

const v1=fs.readFileSync('scripts/article-image-optimizer-v1.js','utf8');
const v2=fs.readFileSync('scripts/article-image-optimizer-v2.js','utf8');
const bridge=fs.readFileSync('scripts/media-auto-compression-v2.js','utf8');
const fast=fs.readFileSync('scripts/media-fast-publish-v3.js','utf8');
const css=fs.readFileSync('styles/media-fast-publish-v3.css','utf8');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});

try{
  for(const width of [1440,390]){
    const page=await browser.newPage({viewport:{width,height:800}});
    const errs=[];
    page.on('pageerror',err=>errs.push(err.message));
    try{
      await page.setContent('<html><body><div id="modalRoot"><form id="postFormPlus">'+
        '<input id="postImages" type="file" accept="image/jpeg,image/png,image/webp" multiple>'+
        '<div class="modal-actions"><button id="publish" type="button">Publish</button></div></form></div>'+
        '<canvas id="fixture"></canvas></body></html>');
      await page.addStyleTag({content:css});
      await page.evaluate(()=>{
        window.state={lang:'en'};
        window.__sent=[];window.__toasts=[];window.__encodes=0;
        const old=HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob=function(...args){
          window.__encodes++;
          return old.call(this,...args);
        };
        window.toast=text=>window.__toasts.push(text);
        window.uploadMedia=async(file,folder)=>{
          if(file.size>8*1048576){window.__toasts.push('Image must be smaller than 8 MB');return ''}
          window.__sent.push({folder,size:file.size,type:file.type,name:file.name});
          return 'https://example.invalid/image/'+file.name;
        };
      });
      for(const script of [v1,bridge,v2,fast])await page.addScriptTag({content:script});
      assert.equal(await page.evaluate(()=>window.NEISImageOptimizer.version),3);

      const result=await page.evaluate(async()=>{
        const canvas=document.getElementById('fixture');
        canvas.width=3000;canvas.height=2000;
        const cx=canvas.getContext('2d');
        cx.fillStyle='#367cbe';cx.fillRect(0,0,3000,2000);
        cx.fillStyle='#fff';cx.font='bold 150px sans-serif';
        cx.fillText('NEIS Circle',140,700);
        const source=await new Promise(ok=>canvas.toBlob(ok,'image/jpeg',.96));
        const giant=new File([source,new Uint8Array(Math.max(0,25*1048576-source.size))],
          '25mb.jpg',{type:'image/jpeg'});
        const small=new File([source],'small.jpg',{type:'image/jpeg'});
        window.__encodes=0;
        const data=new DataTransfer();data.items.add(giant);
        const input=document.getElementById('postImages');
        input.files=data.files;
        input.dispatchEvent(new Event('change',{bubbles:true}));
        await new Promise((resolve,reject)=>{
          const start=Date.now();
          const check=()=>{
            const node=document.querySelector('.neis-image-processing-status');
            if(node?.dataset.phase==='ready'){resolve();return}
            if(node?.dataset.phase==='error'){reject(Error(node.textContent));return}
            if(Date.now()-start>14000){reject(Error('Precompression timed out'));return}
            setTimeout(check,35);
          };
          check();
        });
        const countBeforeUpload=window.__encodes;
        const a=await window.uploadMedia(giant,'posts');
        const countAfterUpload=window.__encodes;
        const b=await window.uploadMedia(small,'gallery');
        const status=document.querySelector('.neis-image-processing-status');
        return {
          sent:window.__sent,original:giant.size,smaller:small.size,
          countBeforeUpload,countAfterUpload,
          phase:status?.dataset.phase,status:status?.textContent,
          messages:window.__toasts,a,b
        };
      });
      assert.ok(result.a&&result.b,'uploads should work');
      assert.equal(result.sent.length,2);
      assert.ok(result.sent[0].size<=7.5*1048576);
      assert.equal(result.sent[0].type,'image/webp');
      assert.ok(result.sent[0].name.endsWith('.webp'));
      assert.equal(result.sent[1].size,result.smaller);
      assert.equal(result.sent[1].name,'small.jpg');
      assert.ok(result.countBeforeUpload<=3,'should use at most three compression encodes');
      assert.equal(result.countAfterUpload,result.countBeforeUpload,'selected image must be cached');
      assert.equal(result.phase,'done');
      assert.ok(result.status.includes('uploaded'));
      assert.ok(!result.messages.some(s=>s.includes('Image must be smaller than 8 MB')));
      assert.deepEqual(errs,[],'page has no JS errors');
      console.log('FAST_IMAGE_PREPROCESS_'+width+'=PASS '+JSON.stringify({
        before:result.original,after:result.sent[0].size,
        encodes:result.countBeforeUpload,cached:true,status:result.phase
      }));
    }finally{await page.close()}
  }

  // Extreme-resolution metadata: must use a bounded bitmap and at most
  // three encodes without allocating a 200+ MP test canvas.
  const page=await browser.newPage();
  try{
    await page.setContent('<html><body></body></html>');
    await page.evaluate(()=>{
      window.state={lang:'en'};
      window.uploadMedia=async()=> 'mock';
    });
    for(const script of [v1,bridge,v2,fast])await page.addScriptTag({content:script});
    const res=await page.evaluate(async()=>{
      // JPEG SOF reports 20,000 x 13,000 without allocating 260 million pixels.
      const jpegHeader=new Uint8Array([
        0xff,0xd8, 0xff,0xc0,0x00,0x11,0x08,
        0x32,0xc8, 0x4e,0x20, 0x03,0x01,0x11,0x00,
        0x02,0x11,0x01, 0x03,0x11,0x01, 0xff,0xd9]);
      const file=new File([jpegHeader,new Uint8Array(10*1048576)],
        'huge.jpg',{type:'image/jpeg'});
      const nativeBitmap=window.createImageBitmap;
      let requested=null;
      window.createImageBitmap=async(f,o)=>{
        requested=o;
        const canvas=document.createElement('canvas');
        canvas.width=o.resizeWidth;canvas.height=o.resizeHeight;
        canvas.getContext('2d').fillRect(0,0,canvas.width,canvas.height);
        return nativeBitmap(canvas);
      };
      try{
        const optimized=await window.NEISImageOptimizer.prepare(file);
        return {requested,bytes:optimized.after,large:optimized.changed,
          width:optimized.width,height:optimized.height};
      }finally{window.createImageBitmap=nativeBitmap}
    });
    assert.equal(res.requested.resizeWidth,2600);
    assert.ok(res.bytes<=7.5*1048576);
    assert.ok(res.large);
    console.log('FAST_IMAGE_EXTREME_DIMENSIONS=PASS '+JSON.stringify(res));
  }finally{await page.close()}
}finally{await browser.close()}
