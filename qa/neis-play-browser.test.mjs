import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try{
  for(const mobile of [false,true]){
    const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:900}});
    await page.setContent('<nav class="rail-nav"><button data-nav="library">Saved</button></nav><nav class="bottom-nav"><button data-mobile-more>More</button></nav><div id="view"><div class="dashboard"><div class="main-column"><p id="original-home">Existing Home remains intact</p></div></div></div>');
    await page.evaluate(()=>{window.state={view:'home',lang:'en'}});
    await page.addStyleTag({path:'styles/neis-play-v1.css'});
    await page.addScriptTag({path:'scripts/neis-play-v1.js'});
    assert.equal(await page.locator('[data-neis-play-open]').count(),2);
    await page.locator('[data-neis-play-open]').nth(mobile?1:0).click({force:true});
    await page.locator('#neisPlayRoot').waitFor();
    assert.equal(await page.locator('#original-home').count(),1,'original page must remain untouched');
    assert.ok((await page.locator('#neisPlayContent').innerText()).includes('Sign in to play'));
    await page.locator('#neisPlayRoot [data-play="close"]').click();
    assert.equal(await page.locator('#neisPlayRoot').count(),0);
    assert.equal(await page.locator('#original-home').count(),1);
    assert.equal(await page.locator('[data-neis-play-home]').count(),1,'Home should have a nonintrusive challenge card');
    await page.locator('#view').evaluate(el=>{el.innerHTML='<form id="circleChatForm"><textarea id="circleChatInput"></textarea><button type="submit">Send</button></form>';window.state.view='circle-detail'});
    await page.locator('#circleChatForm [data-neis-play-open]').waitFor();
    assert.equal(await page.locator('#circleChatInput').count(),1,'chat input preserved');
    await page.close();
  }
  console.log('NEIS_PLAY_V1_BROWSER=PASS');
}finally{await browser.close()}
