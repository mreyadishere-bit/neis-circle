import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
const optimizer=fs.readFileSync('scripts/article-image-optimizer-v1.js','utf8');
const editor=fs.readFileSync('scripts/06-image-editor.js','utf8');
const articles=fs.readFileSync('scripts/articles-v27.js','utf8');
assert.ok(articles.includes('await window.NEISImageOptimizer.prepare(file)'));
assert.ok(articles.includes("if(button)button.disabled=false"));
assert.ok(editor.includes('record.source=optimized.file'));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1100,height:750}});
try{
 await page.setContent('<html><body><input id="articleCover" type="file"><canvas id="src"></canvas></body></html>');
 await page.addScriptTag({content:optimizer});
 const results=await page.evaluate(async()=>{
   const optim=window.NEISImageOptimizer;
   const tiny=new File([new Uint8Array(2000)],'tiny.jpg',{type:'image/jpeg'});
   const unchanged=await optim.prepare(tiny);
   if(unchanged.file!==tiny||unchanged.changed)throw Error('Small images must pass untouched');
   const canvas=document.querySelector('canvas');
   canvas.width=3000;canvas.height=2700;
   const context=canvas.getContext('2d',{willReadFrequently:true});
   const data=context.createImageData(canvas.width,canvas.height);
   let seed=4132;
   for(let i=0;i<data.data.length;i+=4){
     seed=(Math.imul(seed,1664525)+1013904223)>>>0;
     data.data[i]=seed&255;
     data.data[i+1]=(seed>>>8)&255;
     data.data[i+2]=(seed>>>16)&255;
     data.data[i+3]=(i%7===0)?90:255;
   }
   context.putImageData(data,0,0);
   const src=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
   const big=new File([src], 'high-res-cover.png',{type:'image/png'});
   if(big.size<=8*1048576)throw Error('Test input is not sufficiently large: '+big.size);
   const optimized=await optim.prepare(big);
   if(!optimized.changed||optimized.file.size>optim.maxBytes)
     throw Error('Compression failed to meet upload limit');
   if(optimized.file.type!=='image/webp')throw Error('PNG transparency must be kept with WebP');
   const image=await createImageBitmap(optimized.file);
   const ratioBefore=canvas.width/canvas.height,ratioAfter=image.width/image.height;
   if(Math.abs(ratioBefore-ratioAfter)>0.001)throw Error('Image aspect ratio changed');
   const probe=document.createElement('canvas');probe.width=100;probe.height=100;
   probe.getContext('2d').drawImage(image,0,0,100,100);
   const alpha=probe.getContext('2d').getImageData(0,0,100,100).data;
   const partiallyTransparent=[...alpha].filter((n,i)=>i%4===3&&n<250).length;
   if(!partiallyTransparent)throw Error('Transparency was lost');
   let badFormat=false,badLarge=false;
   try{await optim.prepare(new File([new Uint8Array(22*1048576)],'animation.gif',{type:'image/gif'}))}
   catch(_){badFormat=true}
   try{await optim.prepare(new File([new Uint8Array(105*1048576)],'oversized.jpg',{type:'image/jpeg'}))}
   catch(_){badLarge=true}
   if(!badFormat||!badLarge)throw Error('Unsafe images should be rejected with errors');
   return {before:big.size,after:optimized.file.size,width:image.width,height:image.height,
     alphaPixels:partiallyTransparent,smallUnchanged:unchanged.file===tiny,
     name:optimized.file.name};
 });
 assert.ok(results.before>8*1048576);
 assert.ok(results.after<=7.5*1048576);
 console.log('ARTICLE_IMAGE_COMPRESSION=PASS '+JSON.stringify(results));
}finally{await browser.close()}
