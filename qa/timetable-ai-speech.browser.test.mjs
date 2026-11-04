import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try{
  for(const viewport of [{width:390,height:844},{width:1280,height:820}]){
    const page=await browser.newPage({viewport});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="view"><div class="tt-head-actions"></div></main>');
    await page.evaluate(()=>{
      window.state={view:'timetable',lang:'en',onboardingComplete:true,timetable:{ready:true,rows:[]}};
      window.authUser={id:'student-test'};
      window.__requests=[];
      window.sb={
        functions:{invoke:async(name,args)=>{
          window.__requests.push({name,body:args.body});
          return {data:{entries:[],changed:false,reply:'Here is a plan.'},error:null};
        }},
        rpc:async()=>({data:[],error:null})
      };
      window.__aborted=0;
      window.SpeechRecognition=class MockRecognition{
        start(){window.__speech=this}
        abort(){window.__aborted++}
      };
    });
    await page.addStyleTag({path:'styles/timetable-ai-v1.css'});
    await page.addStyleTag({path:'styles/ui-v14.css'});
    await page.addScriptTag({path:'scripts/timetable-ai-v1.js'});
    await page.locator('#ttAiOpen').click();
    const mic=page.locator('.ttai-mic');
    await mic.waitFor();
    assert.equal(await mic.getAttribute('aria-label'),'Speak your message');
    assert.equal(await mic.isDisabled(),false);
    await mic.click();
    assert.equal(await mic.getAttribute('aria-label'),'Stop dictation');
    assert.equal(await page.locator('.ttai-speech-status').innerText(),'Listening…');
    await page.evaluate(()=>{
      window.__speech.onresult({
        results:[[ {transcript:'help me manage my timetable'} ]]
      });
    });
    assert.equal(await page.locator('.ttai-input').inputValue(),'help me manage my timetable');
    assert.equal(await page.evaluate(()=>window.__requests.length),0,'speech-to-text must never auto-send');
    await page.locator('.ttai-input').fill('help me manage my timetable please');
    await page.locator('.ttai-send').click();
    await page.waitForFunction(()=>window.__requests.length===1);
    assert.equal(await page.evaluate(()=>window.__requests[0].body.message),'help me manage my timetable please');
    await page.waitForFunction(()=>document.querySelector('.ttai-chat')?.textContent?.includes('Here is a plan.'),null,{timeout:9000});
    await page.locator('.ttai-mic').click();
    await page.locator('.ttai-icon-btn').last().click();
    assert.ok(await page.evaluate(()=>window.__aborted)>0,'closing must release microphone');
    // Arabic recognition must be independent of English dictated text.
    await page.evaluate(()=>window.state.lang='ar');
    await page.locator('#ttAiOpen').click();
    await page.locator('.ttai-mic').click();
    assert.equal(await page.evaluate(()=>window.__speech.lang),'ar-EG');
    assert.equal(await page.evaluate(()=>window.__requests.length),1);
    assert.deepEqual(errors,[],errors.join('; '));
    await page.close();
  }
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.setContent('<div id="view"><div class="tt-head-actions"></div></div>');
  await page.evaluate(()=>{
    window.state={view:'timetable',lang:'en',onboardingComplete:true,timetable:{ready:true,rows:[]}};
    window.authUser={id:'student-test'};
    window.SpeechRecognition=undefined;
    window.webkitSpeechRecognition=undefined;
  });
  await page.addScriptTag({path:'scripts/timetable-ai-v1.js'});
  await page.locator('#ttAiOpen').click();
  assert.equal(await page.locator('.ttai-mic').isDisabled(),true,'unsupported browser displays disabled mic');
  assert.match(await page.locator('.ttai-mic').getAttribute('title'),/not supported/);
  await page.close();
  console.log('TIMETABLE_SPEECH_TO_TEXT_BROWSER=PASS');
}finally{await browser.close()}
