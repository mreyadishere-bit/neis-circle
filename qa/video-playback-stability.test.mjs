import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src=fs.readFileSync('scripts/05-social.js','utf8');
const helperStart=src.indexOf('function neisMediaPlayingOrVisible(post){');
const helperEnd=src.indexOf('function patchHomeRealtime(options={}){',helperStart);
const renderStart=src.indexOf('const baseRender=render;');
const renderEnd=src.indexOf('\nfunction openFullImage(',renderStart);
assert.ok(helperStart>=0 && helperEnd>helperStart && renderEnd>renderStart);
const helper=src.slice(helperStart,helperEnd);
const renderWrapper=src.slice(renderStart,renderEnd);
assert.equal((src.match(/if\(node&&\(forceIds\.has\(id\)\|\|node\.dataset\.postVersion!==version\)\&\&!neisMediaPlayingOrVisible\(node\)\)\{/g)||[]).length,2,
 'Home and Circle realtime updates must preserve visible media nodes');
assert.match(renderWrapper,/lastMediaRenderRoute===currentRoute&&neisVisibleEmbeddedPlayer\(\)/,
 'Same-route render must protect media');
assert.match(renderWrapper,/if\(state\.view==='home'\)patchHomeRealtime\(\)/,
 'Other Home posts can still update without deleting player');

const iframe={tagName:'IFRAME',getBoundingClientRect(){return {top:120,bottom:520,left:30,right:750,width:720,height:400}}};
const player={isConnected:true,querySelectorAll(){return [iframe]}};
let mediaVisible=true,baseRenders=0,partialUpdates=0,badgeUpdates=0;
const context={
 window:{innerHeight:900,innerWidth:1440},
 location:{hash:'#/home'},
 document:{querySelector(selector){
  if(selector==='#view')return {querySelectorAll(){return mediaVisible?[player]:[]}};
  return null;
 }},
 state:{view:'home',onboardingComplete:true},
 authUser:{id:'student'},
 render(){baseRenders++},
 patchHomeRealtime(){partialUpdates++},
 patchCircleHomeRealtime(){partialUpdates++},
 updateBadges(){badgeUpdates++},
 requestAnimationFrame(){},
 fitMobileConversationList(){},
 $(){return null},
 bindV6(){},
 connectionsView(){},searchView(){},notificationsView(){},profileView(){},circleView(){}
};
context.window.NEISPublicPolls={};
vm.createContext(context);
vm.runInContext(helper+'\n'+renderWrapper,context);
assert.equal(context.window.NEISMediaPlaybackGuard.isProtected(player),true);
context.render();
assert.equal(baseRenders,1,'initial render must work');
context.render();
assert.equal(baseRenders,1,'same-route refresh must NOT tear down iframe');
assert.equal(partialUpdates,1,'Home updates may patch other cards');
assert.equal(badgeUpdates,2);
context.location.hash='#/notifications';
context.render();
assert.equal(baseRenders,2,'different route must perform full render for navigation');
assert.equal(context.state.view,'home');
// No video on screen: normal render should not be suppressed.
mediaVisible=false;context.location.hash='#/home';context.render();
assert.equal(baseRenders,3,'when media is gone a full refresh is allowed');
console.log('VIDEO_EMBED_STAYS_MOUNTED_DURING_REFRESH=PASS');
