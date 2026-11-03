import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
try{
  for(const mobile of [false,true]){
    const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:900}});
    await page.setContent('<nav class="rail-nav"><button data-nav="library">Saved</button></nav><nav class="bottom-nav"><button data-mobile-more>More</button></nav><div id="view"><p id="original-home">Existing Home remains intact</p></div>');
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
    await page.close();
  }
  console.log('NEIS_PLAY_V1_BROWSER=PASS');
}finally{await browser.close()}
