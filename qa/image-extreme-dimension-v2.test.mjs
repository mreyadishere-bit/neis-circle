import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';

const v1=fs.readFileSync('scripts/article-image-optimizer-v1.js','utf8');
const v2=fs.readFileSync('scripts/article-image-optimizer-v2.js','utf8');
const bridge=fs.readFileSync('scripts/media-auto-compression-v2.js','utf8');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try{
  for(const width of [1440,390]){
    const page=await browser.newPage({viewport:{width,height:820}});
    try{
      await page.setContent('<html><body><canvas id="fixture"></canvas></body></html>');
      await page.evaluate(()=>{
        window.state={lang:'en'};
        window.__uploads=[];
        window.__messages=[];
        window.toast=message=>window.__messages.push(message);
        window.uploadMedia=async(file,folder)=>{
          if(file.size>8*1048576){window.__messages.push('Image must be smaller than 8 MB');return ''}
          window.__uploads.push({size:file.size,mime:file.type,folder,name:file.name});
          return 'https://example.invalid/uploads/'+file.name;
        };
      });
      await page.addScriptTag({content:v1});
      await page.addScriptTag({content:bridge});
      await page.addScriptTag({content:v2});
      const result=await page.evaluate(async()=>{
        const canvas=document.querySelector('#fixture');
        canvas.width=2800;canvas.height=2100;
        const ctx=canvas.getContext('2d');
        ctx.fillStyle='#2472ce';ctx.fillRect(0,0,2800,2100);
        ctx.fillStyle='#f5f5f0';ctx.font='bold 165px sans-serif';
        ctx.fillText('NEIS Circle',210,850);
        const valid=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.95));
        const big=new File([valid,new Uint8Array(Math.max(0,25*1048576-valid.size))],
          '25mb.jpg',{type:'image/jpeg'});
        const url=await window.uploadMedia(big,'posts');
        if(!url||window.__uploads.length!==1)throw Error('25MB upload did not work');
        if(window.__uploads[0].size>7.5*1048576)throw Error('Upload exceeded target');
        const oldUpload=window.__uploads[0];

        // Exercise the same dimensions that the old >180MP guard rejected
        // without allocating hundreds of MB inside the test runner.
        const originalImage=window.Image;
        const originalCreateBitmap=window.createImageBitmap;
        const fakeWidth=20000,fakeHeight=13000; // 260 million pixels
        let bitmapRequest=null;
        class HugeMetadataImage extends originalImage {
          get naturalWidth(){return fakeWidth}
          get naturalHeight(){return fakeHeight}
        }
        window.Image=HugeMetadataImage;
        window.createImageBitmap=async(file,options)=>{
          bitmapRequest={
            width:options?.resizeWidth,height:options?.resizeHeight,
            quality:options?.resizeQuality,orientation:options?.imageOrientation
          };
          if(!bitmapRequest.width||bitmapRequest.width>3400||
             !bitmapRequest.height||bitmapRequest.height>3400)
            throw Error('Expected bounded resize decode');
          const thumb=document.createElement('canvas');
          thumb.width=bitmapRequest.width;
          thumb.height=bitmapRequest.height;
          thumb.getContext('2d').fillRect(0,0,thumb.width,thumb.height);
          return originalCreateBitmap(thumb);
        };
        let extreme;
        try{
          extreme=await window.NEISImageOptimizer.prepare(big);
        }finally{
          window.Image=originalImage;
          window.createImageBitmap=originalCreateBitmap;
        }
        if(!extreme.changed||extreme.file.size>7.5*1048576)
          throw Error('Large-dimension image did not downsample');
        if(Math.abs((extreme.width/extreme.height)-(fakeWidth/fakeHeight))>0.002)
          throw Error('Huge image aspect ratio changed');
        if(window.__messages.some(x=>x.includes('Image must be smaller than 8 MB')))
          throw Error('Legacy rejection surfaced');
        const small=new File([valid],'small.jpg',{type:'image/jpeg'});
        const same=await window.NEISImageOptimizer.prepare(small);
        if(same.file!==small||same.changed)throw Error('Small image was unnecessarily changed');
        return {original:big.size,uploaded:oldUpload.size,outputType:oldUpload.mime,
          extremeWidth:extreme.width,extremeHeight:extreme.height,
          extremeSize:extreme.file.size,requested:bitmapRequest,version:window.NEISImageOptimizer.version};
      });
      assert.equal(result.version,2);
      assert.equal(result.requested.width,3400);
      assert.ok(result.extremeSize<7.5*1048576);
      assert.equal(result.outputType,'image/webp');
      console.log('EXTREME_DIMENSION_COMPRESS_'+width+'=PASS '+JSON.stringify(result));
    }finally{await page.close()}
  }
}finally{await browser.close()}
