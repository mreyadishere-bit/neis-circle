import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = process.cwd();
const failures = [];
const warnings = [];

function walk(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, ext));
    else if (!ext || full.endsWith(ext)) out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

const jsFiles = walk(path.join(root, 'scripts'), '.js');
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures.push(`JavaScript syntax failed: ${rel(file)}\n${result.stderr || result.stdout}`);
  }
}

const htmlPath = path.join(root, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(code => code.trim());

inlineScripts.forEach((code, index) => {
  try {
    new vm.Script(code, { filename: `index.inline.${index + 1}.js` });
  } catch (error) {
    failures.push(`Inline script syntax failed (#${index + 1}): ${error.message}`);
  }
});

const localScriptSrcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)]
  .map(match => match[1])
  .filter(src => !/^https?:\/\//i.test(src));

const runtimeHtml = html.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
const localStyleHrefs = [...runtimeHtml.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]*>/gi)]
  .map(match => match[1])
  .filter(href => href.startsWith('styles/'));

function duplicateValues(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1);
}

for (const [src, count] of duplicateValues(localScriptSrcs.map(v => v.split('?')[0]))) {
  failures.push(`Duplicate script include: ${src} x${count}`);
}

for (const [href, count] of duplicateValues(localStyleHrefs.map(v => v.split('?')[0]))) {
  failures.push(`Duplicate stylesheet include: ${href} x${count}`);
}

for (const src of localScriptSrcs) {
  const diskPath = path.join(root, src.split('?')[0]);
  if (!fs.existsSync(diskPath)) failures.push(`Missing script referenced by index.html: ${src}`);
  if (!src.includes('?v=')) warnings.push(`Local script has no explicit cache version: ${src}`);
}

for (const href of localStyleHrefs) {
  const diskPath = path.join(root, href.split('?')[0]);
  if (!fs.existsSync(diskPath)) failures.push(`Missing stylesheet referenced by index.html: ${href}`);
}

const obsoleteLoaded = localScriptSrcs.filter(src =>
  /(?:public-polls-v161|home-polls-v169)\.js/i.test(src)
);
if (obsoleteLoaded.length) {
  failures.push(`Obsolete Home poll module is still loaded: ${obsoleteLoaded.join(', ')}`);
}

const activeHomePollModules = localScriptSrcs.filter(src => /home-polls-v\d+\.js/i.test(src));
if (activeHomePollModules.length !== 1) {
  failures.push(`Expected exactly one active Home poll module, found ${activeHomePollModules.length}: ${activeHomePollModules.join(', ')}`);
}

const dataCoordinators = localScriptSrcs.filter(src => /data-coordinator-v\d+\.js/i.test(src));
if (dataCoordinators.length !== 1) {
  failures.push(`Expected exactly one active data coordinator, found ${dataCoordinators.length}: ${dataCoordinators.join(', ')}`);
} else {
  const localRuntimeScripts = localScriptSrcs.filter(src => src.startsWith('scripts/'));
  if (localRuntimeScripts.at(-1) !== dataCoordinators[0]) {
    failures.push(`Data coordinator must be the last local runtime script. Last script is ${localRuntimeScripts.at(-1)}`);
  }
}

const profileCaches = localScriptSrcs.filter(src => /profile-cache-v\d+\.js/i.test(src));
if (profileCaches.length !== 1) {
  failures.push(`Expected exactly one active profile cache module, found ${profileCaches.length}: ${profileCaches.join(', ')}`);
} else {
  const runtimeIndex = localScriptSrcs.findIndex(src => /runtime-core-v\d+\.js/i.test(src));
  const cacheIndex = localScriptSrcs.indexOf(profileCaches[0]);
  if (runtimeIndex < 0 || cacheIndex < 0 || cacheIndex > runtimeIndex) {
    failures.push('Profile cache module must load before runtime-core.');
  }
}

const secondaryLoaders = localScriptSrcs.filter(src => /secondary-data-v\d+\.js/i.test(src));
if (secondaryLoaders.length !== 1) {
  failures.push(`Expected exactly one active secondary data loader, found ${secondaryLoaders.length}: ${secondaryLoaders.join(', ')}`);
} else {
  const runtimeIndex = localScriptSrcs.findIndex(src => /runtime-core-v\d+\.js/i.test(src));
  const secondaryIndex = localScriptSrcs.indexOf(secondaryLoaders[0]);
  if (runtimeIndex < 0 || secondaryIndex < 0 || secondaryIndex > runtimeIndex) {
    failures.push('Secondary data loader must load before runtime-core.');
  }
}

const serviceWorker = path.join(root, 'neis-pwa-sw.js');
if (!fs.existsSync(serviceWorker)) failures.push('neis-pwa-sw.js is missing');

const messageReactionDataPath = path.join(root, 'scripts', 'social', 'message-reactions-data-v180.js');
if (!fs.existsSync(messageReactionDataPath)) {
  failures.push('Missing scoped message reaction data module.');
} else {
  const messageReactionDataSource = fs.readFileSync(messageReactionDataPath, 'utf8');
  for (const token of ['dm_message_id','circle_message_id','CHUNK_SIZE=100','idsFromState']) {
    if (!messageReactionDataSource.includes(token)) failures.push('Message reaction data module is missing expected behavior: ' + token);
  }
}
const messageReactionDataScripts = localScriptSrcs.filter(src => /social\/message-reactions-data-v\d+\.js/i.test(src));
if (messageReactionDataScripts.length !== 1) {
  failures.push(`Expected exactly one message reaction data module, found ${messageReactionDataScripts.length}: ${messageReactionDataScripts.join(', ')}`);
} else {
  const moduleIndex = localScriptSrcs.indexOf(messageReactionDataScripts[0]);
  const socialIndex = localScriptSrcs.findIndex(src => /scripts\/05-social\.js/i.test(src));
  if (socialIndex < 0 || moduleIndex > socialIndex) failures.push('Message reaction data module must load before 05-social.js.');
}

const conversationDataPath = path.join(root, 'scripts', 'social', 'conversation-data-v179.js');
if (!fs.existsSync(conversationDataPath)) {
  failures.push('Missing isolated conversation data module.');
} else {
  const conversationDataSource = fs.readFileSync(conversationDataPath, 'utf8');
  for (const token of ['hydrate','inflight','limit(200)','conversation_members']) {
    if (!conversationDataSource.includes(token)) failures.push('Conversation data module is missing expected behavior: ' + token);
  }
  if (conversationDataSource.includes('render()')) failures.push('Conversation data module must never call full render().');
}
const conversationDataScripts = localScriptSrcs.filter(src => /social\/conversation-data-v\d+\.js/i.test(src));
if (conversationDataScripts.length !== 1) {
  failures.push(`Expected exactly one conversation data module, found ${conversationDataScripts.length}: ${conversationDataScripts.join(', ')}`);
} else {
  const moduleIndex = localScriptSrcs.indexOf(conversationDataScripts[0]);
  const socialIndex = localScriptSrcs.findIndex(src => /scripts\/05-social\.js/i.test(src));
  if (socialIndex < 0 || moduleIndex > socialIndex) failures.push('Conversation data module must load before 05-social.js.');
}

const messageDomPath = path.join(root, 'scripts', 'social', 'messages-dom-v178.js');
if (!fs.existsSync(messageDomPath)) {
  failures.push('Missing isolated DM DOM patch module.');
} else {
  const messageDomSource = fs.readFileSync(messageDomPath, 'utf8');
  for (const token of ['patchThread','patchActiveFlow','patchCircleFlow','activeMessages']) {
    if (!messageDomSource.includes(token)) failures.push('DM DOM module is missing expected capability: ' + token);
  }
  if (messageDomSource.includes('render()')) failures.push('DM DOM patch module must never call full render().');
}
const messageDomScripts = localScriptSrcs.filter(src => /social\/messages-dom-v\d+\.js/i.test(src));
if (messageDomScripts.length !== 1) {
  failures.push(`Expected exactly one DM DOM module, found ${messageDomScripts.length}: ${messageDomScripts.join(', ')}`);
} else {
  const moduleIndex = localScriptSrcs.indexOf(messageDomScripts[0]);
  const socialIndex = localScriptSrcs.findIndex(src => /scripts\/05-social\.js/i.test(src));
  if (socialIndex < 0 || moduleIndex > socialIndex) failures.push('DM DOM module must load before 05-social.js.');
}

const messageStatePath = path.join(root, 'scripts', 'social', 'messages-state-v177.js');
if (!fs.existsSync(messageStatePath)) {
  failures.push('Missing isolated realtime message state module.');
} else {
  const messageStateSource = fs.readFileSync(messageStatePath, 'utf8');
  for (const token of ['applyDirectMessage','applyCircleMessage','applyMessageReaction','applyConversationMember']) {
    if (!messageStateSource.includes(token)) failures.push('Message state module is missing expected mutation: ' + token);
  }
}
const messageStateScripts = localScriptSrcs.filter(src => /social\/messages-state-v\d+\.js/i.test(src));
if (messageStateScripts.length !== 1) {
  failures.push(`Expected exactly one message state module, found ${messageStateScripts.length}: ${messageStateScripts.join(', ')}`);
} else {
  const moduleIndex = localScriptSrcs.indexOf(messageStateScripts[0]);
  const socialIndex = localScriptSrcs.findIndex(src => /scripts\/05-social\.js/i.test(src));
  if (socialIndex < 0 || moduleIndex > socialIndex) failures.push('Message state module must load before 05-social.js.');
}

const videoEmbedsPath = path.join(root, 'scripts', 'social', 'video-embeds-v176.js');
if (!fs.existsSync(videoEmbedsPath)) {
  failures.push('Missing isolated video embed parser.');
} else {
  const videoEmbedsSource = fs.readFileSync(videoEmbedsPath, 'utf8');
  for (const token of ['youtubeVideoId','googleDriveFileId','drive.google.com','youtube-nocookie.com']) {
    if (!videoEmbedsSource.includes(token)) failures.push('Video embed parser is missing expected support: ' + token);
  }
}
const videoEmbedScripts = localScriptSrcs.filter(src => /social\/video-embeds-v\d+\.js/i.test(src));
if (videoEmbedScripts.length !== 1) {
  failures.push(`Expected exactly one video embed parser, found ${videoEmbedScripts.length}: ${videoEmbedScripts.join(', ')}`);
} else {
  const parserIndex = localScriptSrcs.indexOf(videoEmbedScripts[0]);
  const socialIndex = localScriptSrcs.findIndex(src => /scripts\/05-social\.js/i.test(src));
  if (socialIndex < 0 || parserIndex > socialIndex) failures.push('Video embed parser must load before 05-social.js.');
}

const realtimeRegistryPath = path.join(root, 'scripts', 'social', 'realtime-v175.js');
if (!fs.existsSync(realtimeRegistryPath)) {
  failures.push('Missing isolated realtime subscription registry.');
} else {
  const realtimeRegistrySource = fs.readFileSync(realtimeRegistryPath, 'utf8');
  for (const table of ['posts','comments','reactions','messages','conversations','conversation_members','circle_messages','message_reactions','circle_meetings','follows','circle_members','profiles','articles','gallery_items','reports']) {
    if (!realtimeRegistrySource.includes("'" + table + "'")) failures.push('Realtime registry is missing table: ' + table);
  }
}
const realtimeRegistryScripts = localScriptSrcs.filter(src => /social\/realtime-v\d+\.js/i.test(src));
if (realtimeRegistryScripts.length !== 1) {
  failures.push(`Expected exactly one realtime registry module, found ${realtimeRegistryScripts.length}: ${realtimeRegistryScripts.join(', ')}`);
} else {
  const registryIndex = localScriptSrcs.indexOf(realtimeRegistryScripts[0]);
  const socialIndex = localScriptSrcs.findIndex(src => /scripts\/05-social\.js/i.test(src));
  if (socialIndex < 0 || registryIndex > socialIndex) failures.push('Realtime registry must load before 05-social.js.');
}

const notificationRuntimePath = path.join(root, 'scripts', 'social', 'notifications-v174.js');
if (!fs.existsSync(notificationRuntimePath)) {
  failures.push('Missing isolated notification runtime.');
} else {
  const notificationRuntimeSource = fs.readFileSync(notificationRuntimePath, 'utf8');
  for (const token of ['refreshPromise','lastFullSyncAt','applyRealtime','startFallback']) {
    if (!notificationRuntimeSource.includes(token)) failures.push('Notification runtime is missing expected behavior: ' + token);
  }
}
const notificationRuntimeScripts = localScriptSrcs.filter(src => /social\/notifications-v\d+\.js/i.test(src));
if (notificationRuntimeScripts.length !== 1) {
  failures.push(`Expected exactly one notification runtime module, found ${notificationRuntimeScripts.length}: ${notificationRuntimeScripts.join(', ')}`);
} else {
  const runtimeIndex = localScriptSrcs.indexOf(notificationRuntimeScripts[0]);
  const socialIndex = localScriptSrcs.findIndex(src => /scripts\/05-social\.js/i.test(src));
  if (socialIndex < 0 || runtimeIndex > socialIndex) {
    failures.push('Notification runtime must load before 05-social.js.');
  }
}

const socialPath = path.join(root, 'scripts', '05-social.js');
if (fs.existsSync(socialPath)) {
  const socialSource = fs.readFileSync(socialPath, 'utf8');
  if (!socialSource.includes('NEISVideoEmbeds')) failures.push('Google Drive video embed support must remain wired into 05-social.js.');
  if (!socialSource.includes('NEISMessageState')) failures.push('Realtime message handlers must remain delegated to the message state module.');
  if (!socialSource.includes('NEISMessageDom')) failures.push('DM DOM patching must remain delegated to the message DOM module.');
  if (!socialSource.includes('NEISConversationData')) failures.push('Conversation hydration must remain delegated to the conversation data module.');
  if (!socialSource.includes('NEISMessageReactionData')) failures.push('Message reaction loading must remain scoped through its data module.');
  if (!socialSource.includes('messageDom.patchCircleFlow')) failures.push('Circle chat DOM patching must remain delegated to the message DOM module.');
  if (!socialSource.includes('videoEmbedUrlValid')) failures.push('Post composer must validate generalized video embed URLs.');
  if (!socialSource.includes('videoEmbedMarkup')) failures.push('Post cards must render generalized video embeds.');
  for (const legacyNotificationToken of ['notificationChannelUid','notificationRefreshPromise','notificationLastFullSyncAt','async function unlockNotificationSound','async function setupNotificationRealtime']) {
    if (socialSource.includes(legacyNotificationToken)) failures.push('Notification runtime leaked back into 05-social.js: ' + legacyNotificationToken);
  }
  const targetedRealtimeTables = ['posts','comments','reactions','comment_likes','comment_creator_hearts','follows','circle_members','circle_meetings'];
  for (const table of targetedRealtimeTables) {
    const legacyPattern = new RegExp("table:'" + table + "'\\},refreshV6");
    if (legacyPattern.test(socialSource)) {
      failures.push('High-frequency realtime table ' + table + ' must not use refreshV6.');
    }
  }
  for (const handler of ['handlePostRealtime','handleCommentRealtime','handleReactionRealtime','handleCommentEngagementRealtime','handleFollowRealtime','handleCircleMemberRealtime','handleCircleMeetingRealtime','handleMessageRealtime','handleConversationRealtime','handleConversationMemberRealtime','handleCircleMessageRealtime','handleMessageReactionRealtime']) {
    if (!socialSource.includes(handler)) failures.push('Missing targeted realtime handler: ' + handler);
  }
  for (const legacyRealtimeToken of ['v6ChannelUid','v6RealtimeStatus','sb.channel(\`neis-v7-']) {
    if (socialSource.includes(legacyRealtimeToken)) failures.push('Realtime subscription lifecycle leaked back into 05-social.js: ' + legacyRealtimeToken);
  }
  for (const deadRefresh of ['async function refreshMessagesV6','async function refreshCircleMessagesV96']) {
    if (socialSource.includes(deadRefresh)) failures.push('Unused full-refresh chat loader must not return: ' + deadRefresh);
  }
  if (/state\.posts\.forEach\([^\n]+state\.allComments\.filter/.test(socialSource)) {
    failures.push('Loaded comment counts must be computed in one pass, not by filtering all comments once per post.');
  }
  if (/from\('message_reactions'\)\.select\('\*'\)\.order\('created_at'\)/.test(socialSource)) {
    failures.push('Unscoped message_reactions select must not return to 05-social.js.');
  }
  const forbiddenMessageBindings = [
    "table:'messages'},refreshMessagesV6",
    "table:'conversations'},refreshMessagesV6",
    "table:'conversation_members'},refreshMessagesV6",
    "table:'circle_messages'},refreshCircleMessagesV96",
    "table:'message_reactions'},refreshMessageReactionsV1"
  ];
  for (const binding of forbiddenMessageBindings) {
    if (socialSource.includes(binding)) failures.push('Legacy message realtime binding must not return: ' + binding);
  }
  const startConversationIndex = socialSource.indexOf('async function startConversation');
  if (startConversationIndex >= 0) {
    const end = socialSource.indexOf('async function markConversationRead', startConversationIndex);
    const section = socialSource.slice(startConversationIndex, end > startConversationIndex ? end : startConversationIndex + 1800);
    if (section.includes('await loadLiveData()')) failures.push('startConversation must hydrate only the target conversation, not call loadLiveData().');
  }
  const globalLoadStart = socialSource.indexOf('const coreLoad=loadLiveData;');
  const globalLoadEnd = socialSource.indexOf('let messageRefreshTimer=', globalLoadStart);
  if (globalLoadStart >= 0 && globalLoadEnd > globalLoadStart) {
    const globalLoadSource = socialSource.slice(globalLoadStart, globalLoadEnd);
    if (/from\(['"]notifications['"]\)/.test(globalLoadSource)) {
      failures.push('Global loadLiveData must not fetch notifications; use the targeted notification loader.');
    }
    if (/removeChannel\(v6Channel\)/.test(globalLoadSource)) {
      failures.push('Global loadLiveData must not tear down the persistent v6 realtime channel.');
    }
    if (!/setupV6Realtime\(uid\)/.test(globalLoadSource)) {
      failures.push('Global loadLiveData must use setupV6Realtime(uid).');
    }
  }
}

const hotfixPath = path.join(root, 'scripts', 'hotfix-v21.js');
if (fs.existsSync(hotfixPath)) {
  const hotfixSource = fs.readFileSync(hotfixPath, 'utf8');
  const deleteStart = hotfixSource.indexOf('deleteDirectMessage=async function');
  if (deleteStart >= 0) {
    const section = hotfixSource.slice(deleteStart, deleteStart + 2200);
    if (section.includes('await loadLiveData()')) failures.push('Direct-message delete hotfix must not call global loadLiveData().');
  }
}

const contentAdminPath = path.join(root, 'scripts', '02-content-admin.js');
if (fs.existsSync(contentAdminPath)) {
  const contentAdminSource = fs.readFileSync(contentAdminPath, 'utf8');
  if (/table:'posts'\},async\(\)=>\{await loadLiveData\(\);render\(\)\}/.test(contentAdminSource)) {
    failures.push('02-content-admin.js must not keep the legacy full-refresh posts realtime listener.');
  }
}

const secondaryPath = path.join(root, 'scripts', 'secondary-data-v173.js');
if (!fs.existsSync(secondaryPath)) {
  failures.push('Missing secondary-data-v173.js.');
} else {
  const secondarySource = fs.readFileSync(secondaryPath, 'utf8');
  for (const resource of ['articles','gallery_items','profile_badges']) {
    if (!secondarySource.includes(resource)) failures.push('Secondary data loader is missing resource: ' + resource);
  }
  if (!secondarySource.includes('admin_report_details')) failures.push('Admin reports must be owned by the secondary data loader.');
}

const contentAdminSecondaryPath = path.join(root, 'scripts', '02-content-admin.js');
if (fs.existsSync(contentAdminSecondaryPath)) {
  const source = fs.readFileSync(contentAdminSecondaryPath, 'utf8');
  const loadStart = source.indexOf('loadLiveData=async function');
  const loadEnd = source.indexOf('window.NEISPrimaryContentLoad', loadStart);
  const loader = loadStart >= 0 ? source.slice(loadStart, loadEnd > loadStart ? loadEnd : loadStart + 12000) : '';
  for (const forbidden of ["from('articles')","from('gallery_items')"]) {
    if (loader.includes(forbidden)) failures.push('Primary content loader must not fetch ' + forbidden + '.');
  }
  if (source.includes("sb.channel('neis-platform-v3')")) failures.push('Legacy neis-platform-v3 realtime channel must not return.');
}

const runtimeCorePath = path.join(root, 'scripts', 'runtime-core-v166.js');
if (fs.existsSync(runtimeCorePath)) {
  const runtimeSource = fs.readFileSync(runtimeCorePath, 'utf8');
  if (runtimeSource.includes("safeQuery('articles'")) failures.push('runtime-core must use NEISSecondaryData for articles.');
  if (!runtimeSource.includes('NEISSecondaryData.loadArticles')) failures.push('runtime-core must route startup articles through NEISSecondaryData.');
}

if (fs.existsSync(socialPath)) {
  const source = fs.readFileSync(socialPath, 'utf8');
  const globalLoadStart = source.indexOf('const coreLoad=loadLiveData;');
  const globalLoadEnd = source.indexOf('let messageRefreshTimer=', globalLoadStart);
  const globalLoad = globalLoadStart >= 0 ? source.slice(globalLoadStart, globalLoadEnd) : '';
  if (globalLoad.includes('admin_report_details')) failures.push('Global social load must not fetch admin reports.');
  if (globalLoad.includes("from('profile_badges')")) failures.push('Global social load must not fetch profile badges.');
  for (const handler of ['handleProfileRealtime','handleArticleRealtime','handleGalleryRealtime','handleReportRealtime']) {
    if (!source.includes(handler)) failures.push('Missing targeted secondary realtime handler: ' + handler);
  }
}

const primaryHydrationPath = path.join(root, 'scripts', '02-content-admin.js');
if (fs.existsSync(primaryHydrationPath)) {
  const source = fs.readFileSync(primaryHydrationPath, 'utf8');
  const start = source.indexOf('loadLiveData=async function');
  const end = source.indexOf('window.NEISPrimaryContentLoad', start);
  const loader = start >= 0 ? source.slice(start, end > start ? end : start + 14000) : '';
  if (loader.includes("from('comments')")) failures.push('Primary content loader must not duplicate the social comments query.');
  if (loader.includes('profiles!posts_author_id_fkey')) failures.push('Primary posts loader must use the cached member directory instead of an embedded profile join.');
}

const socialHydrationPath = path.join(root, 'scripts', '05-social.js');
if (fs.existsSync(socialHydrationPath)) {
  const source = fs.readFileSync(socialHydrationPath, 'utf8');
  for (const forbidden of ['profile:profiles','creator:profiles','comments_author_id_fkey']) {
    if (source.includes(forbidden)) failures.push('Social hydration must not use embedded profile join: ' + forbidden);
  }
  if (!source.includes('profile:profileData(comment.author_id)')) failures.push('Comments must attach profiles locally from state.members.');
  if (!source.includes('profile:profileData(message.sender_id)')) failures.push('Circle messages must attach sender profiles locally.');
}

const largeFiles = [
  ...jsFiles,
  ...walk(path.join(root, 'styles'), '.css')
].map(file => ({ file: rel(file), bytes: fs.statSync(file).size }))
 .filter(item => item.bytes > 200_000)
 .sort((a, b) => b.bytes - a.bytes);

for (const item of largeFiles) {
  warnings.push(`Large source file: ${item.file} (${Math.round(item.bytes / 1024)} KB)`);
}

const riskyOverrides = ['render=function', 'home=function', 'loadLiveData=async function', 'postCard=function'];
const overrideCounts = {};
for (const token of riskyOverrides) {
  let count = 0;
  for (const file of jsFiles) {
    const source = fs.readFileSync(file, 'utf8');
    count += source.split(token).length - 1;
  }
  overrideCounts[token] = count;
}

console.log(`Checked ${jsFiles.length} JavaScript files and ${inlineScripts.length} inline scripts.`);
console.log('Architecture baseline:', JSON.stringify(overrideCounts));
if (warnings.length) {
  console.log('\nWarnings (non-blocking):');
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (failures.length) {
  console.error('\nQuality gate failed:');
  for (const failure of failures) console.error(`\n- ${failure}`);
  process.exit(1);
}

console.log('\nStatic quality gate passed.');
