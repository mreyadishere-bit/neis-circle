// fresh-run-trigger: chat-realtime-recovery-20261005
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

const mobileCssPath = path.join(root, 'styles', 'mobile-v30.css');
if (fs.existsSync(mobileCssPath)) {
  const mobileCss = fs.readFileSync(mobileCssPath, 'utf8');
  const contractStart = mobileCss.indexOf('v64 — final mobile DM viewport contract');
  const contract = contractStart >= 0 ? mobileCss.slice(contractStart) : '';
  if (!contract) failures.push('Missing final mobile DM viewport contract.');
  else {
    for (const token of [
      'height:calc(100dvh - 58px)!important',
      'padding:0 0 calc(74px + env(safe-area-inset-bottom))!important',
      '.messages.mobile-thread-open',
      'margin:0!important',
      'overflow:hidden!important'
    ]) {
      if (!contract.includes(token)) failures.push('Mobile DM viewport contract is missing: ' + token);
    }
  }
}

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

const chatFieldsPath = path.join(root, 'scripts', 'social', 'chat-fields-v182.js');
if (!fs.existsSync(chatFieldsPath)) {
  failures.push('Missing minimal chat field contract.');
} else {
  const chatFieldsSource = fs.readFileSync(chatFieldsPath, 'utf8');
  for (const token of ['conversation:','member:','message:','circleMessage:']) {
    if (!chatFieldsSource.includes(token)) failures.push('Chat field contract is missing: ' + token);
  }
  const chatFieldValues = [...chatFieldsSource.matchAll(/(?:conversation|member|message|circleMessage):'([^']+)'/g)]
    .flatMap(match => match[1].split(','));
  for (const forbidden of ['attachment_url','read_at','direct_key','created_by']) {
    if (chatFieldValues.includes(forbidden)) failures.push('Chat field contract includes unused payload field: ' + forbidden);
  }
}
const chatFieldScripts = localScriptSrcs.filter(src => /social\/chat-fields-v\d+\.js/i.test(src));
if (chatFieldScripts.length !== 1) failures.push('Expected exactly one chat field contract module.');
else {
  const fieldsIndex = localScriptSrcs.indexOf(chatFieldScripts[0]);
  const conversationIndex = localScriptSrcs.findIndex(src => /social\/conversation-data-v\d+\.js/i.test(src));
  const bootstrapIndex = localScriptSrcs.findIndex(src => /social\/chat-bootstrap-v\d+\.js/i.test(src));
  const realtimeIndex = localScriptSrcs.findIndex(src => /social\/realtime-v\d+\.js/i.test(src));
  if (conversationIndex < 0 || bootstrapIndex < 0 || realtimeIndex < 0 || fieldsIndex > conversationIndex || fieldsIndex > bootstrapIndex || fieldsIndex > realtimeIndex) {
    failures.push('Chat field contract must load before chat data and realtime modules.');
  }
}

const chatBootstrapPath = path.join(root, 'scripts', 'social', 'chat-bootstrap-v181.js');
if (!fs.existsSync(chatBootstrapPath)) {
  failures.push('Missing isolated chat bootstrap data module.');
} else {
  const chatBootstrapSource = fs.readFileSync(chatBootstrapPath, 'utf8');
  for (const token of ['loadDirect','loadCircle','cleared_at','limit(200)']) {
    if (!chatBootstrapSource.includes(token)) failures.push('Chat bootstrap module is missing expected behavior: ' + token);
  }
  if (chatBootstrapSource.includes('render()')) failures.push('Chat bootstrap data module must never call full render().');
}
const chatBootstrapScripts = localScriptSrcs.filter(src => /social\/chat-bootstrap-v\d+\.js/i.test(src));
if (chatBootstrapScripts.length !== 1) {
  failures.push(`Expected exactly one chat bootstrap module, found ${chatBootstrapScripts.length}: ${chatBootstrapScripts.join(', ')}`);
} else {
  const moduleIndex = localScriptSrcs.indexOf(chatBootstrapScripts[0]);
  const socialIndex = localScriptSrcs.findIndex(src => /scripts\/05-social\.js/i.test(src));
  if (socialIndex < 0 || moduleIndex > socialIndex) failures.push('Chat bootstrap module must load before 05-social.js.');
}

for (const chatDataFile of ['scripts/social/conversation-data-v179.js','scripts/social/chat-bootstrap-v181.js']) {
  if (fs.existsSync(path.join(root, chatDataFile))) {
    const source = fs.readFileSync(path.join(root, chatDataFile), 'utf8');
    if (/\.select\(['"]\*['"]\)/.test(source)) failures.push('Chat data modules must not use select(*) anymore: ' + chatDataFile);
  }
}

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

const pinnedSupabaseVersion='2.117.2';
if (!html.includes('@supabase/supabase-js@'+pinnedSupabaseVersion)) failures.push('index.html must pin Supabase JS to '+pinnedSupabaseVersion+'.');
const coreSupabaseSource=fs.readFileSync(path.join(root,'scripts','01-core.js'),'utf8');
if ((coreSupabaseSource.match(/@supabase\/supabase-js@2\.117\.2/g)||[]).length < 2) failures.push('Both Supabase fallback CDNs must pin v2.117.2.');

const realtimeRegistryPath = path.join(root, 'scripts', 'social', 'realtime-v175.js');
if (!fs.existsSync(realtimeRegistryPath)) {
  failures.push('Missing isolated realtime subscription registry.');
} else {
  const realtimeRegistrySource = fs.readFileSync(realtimeRegistryPath, 'utf8');
  for (const table of ['messages','conversations','conversation_members','circle_messages','message_reactions']) {
    const row = realtimeRegistrySource.split('\n').find(line => line.includes("['"+table+"'"));
    if (!row || !row.includes('columns(')) failures.push('Realtime chat binding must select minimal columns: '+table);
  }
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
  for (const token of [
    'refreshPromise','lastFullSyncAt','applyRealtime','startFallback',
    'NOTIFICATION_FIELDS','CACHE_PREFIX','hydrateCache(uid)',
    ".eq('user_id',authUser.id)",
    "refresh(false,{force:true}).catch"
  ]) {
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
  if (!socialSource.includes('NEISChatBootstrapData')) failures.push('Startup chat loading must remain delegated to the chat bootstrap module.');
  const notificationStart= socialSource.indexOf('const notificationSetupPromise=setupNotificationRealtime(uid)');
  const coreLoadAwait= socialSource.indexOf('await coreLoad()', notificationStart);
  if (notificationStart < 0 || coreLoadAwait < 0 || notificationStart > coreLoadAwait) failures.push('Notification realtime must start before the heavy core load await.');
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
  if (/from\('conversation_members'\)\.select\('\*'\)\.eq\('user_id',uid\)/.test(socialSource)) {
    failures.push('Startup chat loading must not inline direct-message bootstrap queries in 05-social.js.');
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

const socialBootstrapSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
const bootstrapStart = socialBootstrapSource.indexOf('const coreLoad=loadLiveData;');
const bootstrapEnd = bootstrapStart >= 0 ? socialBootstrapSource.indexOf('\nlet refreshBusy=', bootstrapStart) : -1;
const bootstrapSection = bootstrapStart >= 0 && bootstrapEnd > bootstrapStart
  ? socialBootstrapSource.slice(bootstrapStart, bootstrapEnd)
  : '';
for (const pattern of [
  ".from('follows').select('*')",
  ".from('circles').select('*')",
  ".from('circle_members').select('*')",
  ".from('circle_meetings').select('*')"
]) {
  if (bootstrapSection.includes(pattern)) failures.push("Bootstrap social queries must not request select('*'): " + pattern);
}

const followActionSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
const followActionStart = followActionSource.indexOf("root.querySelectorAll('[data-v6-follow]')");
const followActionEnd = followActionStart >= 0
  ? followActionSource.indexOf("root.querySelectorAll('[data-message-user]')", followActionStart)
  : -1;
const followActionSection = followActionStart >= 0 && followActionEnd > followActionStart
  ? followActionSource.slice(followActionStart, followActionEnd)
  : '';
if (!followActionSection) {
  failures.push('Follow action section could not be located.');
} else {
  if (followActionSection.includes('loadLiveData()')) failures.push('Follow/unfollow actions must remain targeted and must not call loadLiveData().');
  if (!followActionSection.includes('handleFollowRealtime')) failures.push('Follow/unfollow actions must delegate to handleFollowRealtime.');
}
const followRequestStart = followActionSource.indexOf("root.querySelectorAll('[data-follow-request]')");
const followRequestEnd = followRequestStart >= 0
  ? followActionSource.indexOf("root.querySelectorAll('[data-new-circle]')", followRequestStart)
  : -1;
const followRequestSection = followRequestStart >= 0 && followRequestEnd > followRequestStart
  ? followActionSource.slice(followRequestStart, followRequestEnd)
  : '';
if (!followRequestSection) {
  failures.push('Follow request action section could not be located.');
} else {
  if (followRequestSection.includes('loadLiveData()')) failures.push('Follow request actions must remain targeted and must not call loadLiveData().');
  if (!followRequestSection.includes('handleFollowRealtime')) failures.push('Follow request actions must delegate to handleFollowRealtime.');
}

const circleMembershipSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
const circleMembershipActionStart = circleMembershipSource.indexOf("root.querySelectorAll('[data-v6-circle-join]')");
const circleMembershipActionEnd = circleMembershipActionStart >= 0
  ? circleMembershipSource.indexOf("root.querySelectorAll('[data-share-circle]')", circleMembershipActionStart)
  : -1;
const circleMembershipActionSection = circleMembershipActionStart >= 0 && circleMembershipActionEnd > circleMembershipActionStart
  ? circleMembershipSource.slice(circleMembershipActionStart, circleMembershipActionEnd)
  : '';
if (!circleMembershipActionSection) {
  failures.push('Circle membership action section could not be located.');
} else {
  if (circleMembershipActionSection.includes('loadLiveData()')) failures.push('Circle join/leave actions must remain targeted and must not call loadLiveData().');
  if (!circleMembershipActionSection.includes('handleCircleMemberRealtime')) failures.push('Circle join/leave actions must delegate to handleCircleMemberRealtime.');
}
const circleMemberAdminStart = circleMembershipSource.indexOf("root.querySelectorAll('[data-member-role]')");
const circleMemberAdminEnd = circleMemberAdminStart >= 0
  ? circleMembershipSource.indexOf("root.querySelectorAll('[data-post-read-more]')", circleMemberAdminStart)
  : -1;
const circleMemberAdminSection = circleMemberAdminStart >= 0 && circleMemberAdminEnd > circleMemberAdminStart
  ? circleMembershipSource.slice(circleMemberAdminStart, circleMemberAdminEnd)
  : '';
if (!circleMemberAdminSection) {
  failures.push('Circle member admin action section could not be located.');
} else {
  if (circleMemberAdminSection.includes('loadLiveData()')) failures.push('Circle role/remove actions must remain targeted and must not call loadLiveData().');
  if (!circleMemberAdminSection.includes('handleCircleMemberRealtime')) failures.push('Circle role/remove actions must delegate to handleCircleMemberRealtime.');
}

const socialChatActionSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
for (const pattern of [
  ".from('messages').insert",
  ".from('circle_messages').insert",
  ".from('circle_messages').update"
]) {
  const index = socialChatActionSource.indexOf(pattern);
  if (index >= 0) {
    const section = socialChatActionSource.slice(index, index + 900);
    if (section.includes(".select('*')")) failures.push("Chat send/delete actions must not request select('*'): " + pattern);
  }
}

const socialMeetingSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
if (!socialMeetingSource.includes("const chatFields=window.NEISChatFields;")) failures.push('05-social.js must bind NEISChatFields before using chatFields.*.');
const endMeetingStart = socialMeetingSource.indexOf('async function endMeeting');
const endMeetingEnd = endMeetingStart >= 0 ? socialMeetingSource.indexOf('async function deleteCircle', endMeetingStart) : -1;
const endMeetingSection = endMeetingStart >= 0 && endMeetingEnd > endMeetingStart ? socialMeetingSource.slice(endMeetingStart,endMeetingEnd) : '';
if (!endMeetingSection) failures.push('endMeeting section could not be located.');
else {
  if (endMeetingSection.includes('loadLiveData()')) failures.push('Circle meeting end action must remain targeted and must not call loadLiveData().');
  if (!endMeetingSection.includes('handleCircleMeetingRealtime')) failures.push('Circle meeting end action must delegate to handleCircleMeetingRealtime.');
}
const scheduleMeetingStart = socialMeetingSource.indexOf('function scheduleMeeting');
const scheduleMeetingEnd = scheduleMeetingStart >= 0 ? socialMeetingSource.indexOf('\nfunction loadLiveKit', scheduleMeetingStart) : -1;
const scheduleMeetingSection = scheduleMeetingStart >= 0 && scheduleMeetingEnd > scheduleMeetingStart ? socialMeetingSource.slice(scheduleMeetingStart,scheduleMeetingEnd) : '';
if (!scheduleMeetingSection) failures.push('scheduleMeeting section could not be located.');
else {
  if (scheduleMeetingSection.includes("select('*')")) failures.push('Circle meeting creation must not request wildcard fields.');
  if (!scheduleMeetingSection.includes('handleCircleMeetingRealtime')) failures.push('Circle meeting creation must delegate to handleCircleMeetingRealtime.');
}

const commentActionSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
const adminReplyDeleteStart = commentActionSource.indexOf("root.querySelectorAll('[data-delete-reply]')");
const adminReplyDeleteEnd = adminReplyDeleteStart >= 0
  ? commentActionSource.indexOf("root.querySelectorAll('[data-member-role]')", adminReplyDeleteStart)
  : -1;
const adminReplyDeleteSection = adminReplyDeleteStart >= 0 && adminReplyDeleteEnd > adminReplyDeleteStart
  ? commentActionSource.slice(adminReplyDeleteStart, adminReplyDeleteEnd)
  : '';
if (!adminReplyDeleteSection) {
  failures.push('Admin reply delete action section could not be located.');
} else {
  if (adminReplyDeleteSection.includes('loadLiveData()')) failures.push('Admin reply delete must remain targeted and must not call loadLiveData().');
  if (!adminReplyDeleteSection.includes('handleCommentRealtime')) failures.push('Admin reply delete must delegate to handleCommentRealtime.');
}

const postEditSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
const postEditStart = postEditSource.indexOf('async function editOwnPost');
const postEditEnd = postEditStart >= 0 ? postEditSource.indexOf('\nfunction postImages', postEditStart) : -1;
const postEditSection = postEditStart >= 0 && postEditEnd > postEditStart ? postEditSource.slice(postEditStart,postEditEnd) : '';
if (!postEditSection) failures.push('Post edit section could not be located.');
else {
  if (postEditSection.includes('loadLiveData()')) failures.push('Post edit must remain targeted and must not call loadLiveData().');
  if (!postEditSection.includes('handlePostRealtime')) failures.push('Post edit must delegate to handlePostRealtime.');
  if (postEditSection.includes("select('*')")) failures.push('Post edit must not request wildcard fields.');
}


const literalScriptNewlines = (runtimeHtml.match(/<\/script>\\n/g) || []).length;
if (literalScriptNewlines) failures.push('index.html must not contain literal \\n text between script tags.');

const appCssPath = path.join(root, 'styles', 'app.css');
if (fs.existsSync(appCssPath)) {
  const appCss = fs.readFileSync(appCssPath, 'utf8');
  const driveVideoStart = appCss.indexOf('v159.52 — Google Drive mobile player viewport');
  const driveVideoSection = driveVideoStart >= 0 ? appCss.slice(driveVideoStart) : '';
  if (!driveVideoSection) failures.push('Missing Google Drive mobile video sizing contract.');
  else {
    for (const token of [
      '.post-drive-video iframe',
      'position:absolute',
      'aspect-ratio:16/9!important',
      'width:250%!important',
      'height:250%!important',
      'transform:scale(.4)',
      'transform-origin:top left'
    ]) {
      if (!driveVideoSection.includes(token)) failures.push('Google Drive video sizing contract is missing: ' + token);
    }
  }
}

const reportActionSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
const reportDeleteStart = reportActionSource.indexOf('async function deleteResolvedReport');
const reportDeleteEnd = reportDeleteStart >= 0 ? reportActionSource.indexOf('\ncomments=async function', reportDeleteStart) : -1;
const reportDeleteSection = reportDeleteStart >= 0 && reportDeleteEnd > reportDeleteStart
  ? reportActionSource.slice(reportDeleteStart, reportDeleteEnd)
  : '';
if (!reportDeleteSection) failures.push('Resolved report delete action section could not be located.');
else {
  if (reportDeleteSection.includes('loadLiveData()')) failures.push('Resolved report delete must remain targeted and must not call loadLiveData().');
  if (!reportDeleteSection.includes('handleReportRealtime')) failures.push('Resolved report delete must delegate to handleReportRealtime.');
}
const reportStatusStart = reportActionSource.indexOf("root.querySelectorAll('[data-report-status]')");
const reportStatusEnd = reportStatusStart >= 0
  ? reportActionSource.indexOf("root.querySelectorAll('[data-delete-report]')", reportStatusStart)
  : -1;
const reportStatusSection = reportStatusStart >= 0 && reportStatusEnd > reportStatusStart
  ? reportActionSource.slice(reportStatusStart, reportStatusEnd)
  : '';
if (!reportStatusSection) failures.push('Report status action section could not be located.');
else {
  if (reportStatusSection.includes('loadLiveData()')) failures.push('Report status updates must remain targeted and must not call loadLiveData().');
  if (!reportStatusSection.includes('handleReportRealtime')) failures.push('Report status updates must delegate to handleReportRealtime.');
}

const circlePostCreateSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
const circlePostCreateStart = circlePostCreateSource.indexOf("const {data:createdPost,error}=await sb.from('posts').insert");
const circlePostCreateEnd = circlePostCreateStart >= 0
  ? circlePostCreateSource.indexOf('\n  };\n}\n\nfunction suggestedPersonItem', circlePostCreateStart)
  : -1;
const circlePostCreateSection = circlePostCreateStart >= 0 && circlePostCreateEnd > circlePostCreateStart
  ? circlePostCreateSource.slice(circlePostCreateStart, circlePostCreateEnd)
  : '';
if (!circlePostCreateSection) failures.push('Circle post creation action section could not be located.');
else {
  if (circlePostCreateSection.includes('loadLiveData()')) failures.push('Circle post creation must remain targeted and must not call loadLiveData().');
  if (!circlePostCreateSection.includes('handlePostRealtime')) failures.push('Circle post creation must delegate to handlePostRealtime.');
  if (circlePostCreateSection.includes("select('*')")) failures.push('Circle post creation must not request wildcard fields.');
  if (!circlePostCreateSection.includes('select(postRealtimeFields)')) failures.push('Circle post creation must select postRealtimeFields.');
}

const circleCreateSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
const circleCreateStart = circleCreateSource.indexOf("$('#createCircleForm').onsubmit=async");
const circleCreateEnd = circleCreateStart >= 0 ? circleCreateSource.indexOf('\n\nfunction localSearchFallback', circleCreateStart) : -1;
const circleCreateSection = circleCreateStart >= 0 && circleCreateEnd > circleCreateStart
  ? circleCreateSource.slice(circleCreateStart, circleCreateEnd)
  : '';
if (!circleCreateSection) failures.push('Circle creation action section could not be located.');
else {
  if (circleCreateSection.includes('loadLiveData()')) failures.push('Circle creation must remain targeted and must not call loadLiveData().');
  if (circleCreateSection.includes("select('*')")) failures.push('Circle creation must not request wildcard fields.');
  if (!circleCreateSection.includes("select('id,owner_id,name,description,category,privacy,created_at')")) failures.push('Circle creation must select scoped Circle fields.');
  if (!circleCreateSection.includes("select('circle_id,user_id,role,status,joined_at')")) failures.push('Circle creation must load only the new owner membership.');
  if (!circleCreateSection.includes('handleCircleMemberRealtime')) failures.push('Circle creation must delegate owner membership to handleCircleMemberRealtime.');
}

const circlePollUpdateSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
const circlePollUpdateStart = circlePollUpdateSource.indexOf("const {error}=await sb.rpc('update_circle_poll_post'");
const circlePollUpdateEnd = circlePollUpdateStart >= 0
  ? circlePollUpdateSource.indexOf('\n  };\n}\n\nfunction openCirclePost', circlePollUpdateStart)
  : -1;
const circlePollUpdateSection = circlePollUpdateStart >= 0 && circlePollUpdateEnd > circlePollUpdateStart
  ? circlePollUpdateSource.slice(circlePollUpdateStart, circlePollUpdateEnd)
  : '';
if (!circlePollUpdateSection) failures.push('Circle poll update action section could not be located.');
else {
  if (circlePollUpdateSection.includes('loadLiveData()')) failures.push('Circle poll updates must remain targeted and must not call loadLiveData().');
  if (!circlePollUpdateSection.includes('select(postRealtimeFields)')) failures.push('Circle poll updates must reload only postRealtimeFields.');
  if (!circlePollUpdateSection.includes('handlePostRealtime')) failures.push('Circle poll updates must delegate post state to handlePostRealtime.');
  if (!circlePollUpdateSection.includes('loadCirclePolls')) failures.push('Circle poll updates must refresh only the Circle poll store.');
}

const opportunityCssPath = path.join(root, 'styles', 'opportunities-v22.css');
if (fs.existsSync(opportunityCssPath)) {
  const opportunityCss = fs.readFileSync(opportunityCssPath, 'utf8');
  const singleDetailStart = opportunityCss.indexOf('.opportunity-detail-gallery.single{display:flex');
  const singleDetailSection = singleDetailStart >= 0 ? opportunityCss.slice(singleDetailStart, singleDetailStart + 520) : '';
  if (!singleDetailSection) failures.push('Opportunity single-image detail contract could not be located.');
  else {
    for (const token of ['object-fit:contain','aspect-ratio:auto','max-height:min(68dvh,680px)']) {
      if (!singleDetailSection.includes(token)) failures.push('Opportunity detail image contract is missing: ' + token);
    }
  }
}

const dmReplySource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
const dmBubbleStart = dmReplySource.indexOf('function messageBubble(m,previous)');
const dmBubbleEnd = dmBubbleStart >= 0 ? dmReplySource.indexOf('\n\nwindow.openNewConversation', dmBubbleStart) : -1;
const dmBubbleSection = dmBubbleStart >= 0 && dmBubbleEnd > dmBubbleStart ? dmReplySource.slice(dmBubbleStart, dmBubbleEnd) : '';
if (!dmBubbleSection) failures.push('DM message bubble section could not be located.');
else {
  if (!dmBubbleSection.includes('data-dm-reply-jump')) failures.push('DM reply quotes must expose a jump target.');
  if (!dmBubbleSection.includes("role=\"button\"")) failures.push('DM reply quotes must remain keyboard-accessible.');
}
const dmJumpBindStart = dmReplySource.indexOf("root.querySelectorAll('[data-dm-reply-jump]')");
const dmJumpBindEnd = dmJumpBindStart >= 0 ? dmReplySource.indexOf("root.querySelectorAll('[data-cancel-circle-reply]')", dmJumpBindStart) : -1;
const dmJumpBindSection = dmJumpBindStart >= 0 && dmJumpBindEnd > dmJumpBindStart ? dmReplySource.slice(dmJumpBindStart, dmJumpBindEnd) : '';
if (!dmJumpBindSection) failures.push('DM reply jump binding could not be located.');
else {
  for (const token of ['#chatFlow > .chat-message[data-message-id=', 'scrollIntoView', 'reply-jump-highlight']) {
    if (!dmJumpBindSection.includes(token)) failures.push('DM reply jump binding is missing: ' + token);
  }
}

const notificationTabCountRuntimePath = path.join(root, 'scripts', 'social', 'notifications-v174.js');
if (fs.existsSync(notificationTabCountRuntimePath)) {
  const notificationRuntimeSource = fs.readFileSync(notificationTabCountRuntimePath, 'utf8');
  for (const token of [
    "const DEFAULT_TAB_TITLE='NEIS Circle'",
    "document.title=unread?'('+label+') '+DEFAULT_TAB_TITLE:DEFAULT_TAB_TITLE",
    "updateTabBadge"
  ]) {
    if (!notificationRuntimeSource.includes(token)) failures.push('Notification tab-title count contract is missing: ' + token);
  }
  for (const forbidden of ["canvas.toDataURL('image/png')","ctx.fillStyle='#e5484d'"]) {
    if (notificationRuntimeSource.includes(forbidden)) failures.push('Notification tab count must not redraw the favicon: ' + forbidden);
  }
}

const pwaPushSource = fs.readFileSync(path.join(root, 'scripts', 'pwa-install-v117.js'), 'utf8');
for (const token of [
  "navigator.serviceWorker.register('/neis-pwa-sw.js?v=12'",
  "rememberSubscriptionInWorker",
  "ensurePushHealth",
  "window.addEventListener('focus'",
  "window.addEventListener('pageshow'",
  "window.addEventListener('online'",
  "NEIS_PUSH_ROTATED"
]) {
  if (!pwaPushSource.includes(token)) failures.push('PWA push health contract is missing: ' + token);
}

const pwaSwPath = path.join(root, 'neis-pwa-sw.js');
if (fs.existsSync(pwaSwPath)) {
  const pwaSwSource = fs.readFileSync(pwaSwPath, 'utf8');
  for (const token of [
    'const VERSION = "neis-pwa-v10"',
    'pushsubscriptionchange',
    'refresh-web-push-subscription',
    'NEIS_PUSH_SUBSCRIPTION',
    'pending_rotation',
    'neis-push-rotation'
  ]) {
    if (!pwaSwSource.includes(token)) failures.push('PWA service worker push-rotation contract is missing: ' + token);
  }
}

const pushRefreshFunctionPath = path.join(root, 'supabase', 'functions', 'refresh-web-push-subscription', 'index.ts');
if (!fs.existsSync(pushRefreshFunctionPath)) failures.push('Missing refresh-web-push-subscription Edge Function source.');
else {
  const pushRefreshFunctionSource = fs.readFileSync(pushRefreshFunctionPath, 'utf8');
  for (const token of ['old_subscription','new_subscription','web_push_subscriptions','old_subscription_not_found']) {
    if (!pushRefreshFunctionSource.includes(token)) failures.push('Push rotation Edge Function is missing: ' + token);
  }
}

const stalePushPwaSource = fs.readFileSync(path.join(root, 'scripts', 'pwa-install-v117.js'), 'utf8');
for (const token of [
  "get_web_push_subscription_status",
  "serverStatus==='disabled'",
  "subscription.unsubscribe()",
  "pushManager.subscribe"
]) {
  if (!stalePushPwaSource.includes(token)) failures.push('Stale push renewal contract is missing: ' + token);
}

const notificationFallbackSource = fs.readFileSync(path.join(root, 'scripts', 'social', 'notifications-v174.js'), 'utf8');
for (const token of [
  'showSystemNotification',
  'document.hidden',
  'registration.showNotification',
  "document.addEventListener('pointerdown',primeNotificationSound",
  "document.addEventListener('keydown',primeNotificationSound"
]) {
  if (!notificationFallbackSource.includes(token)) failures.push('Background notification fallback contract is missing: ' + token);
}

const pushHealthMigrationPath = path.join(root, 'supabase', 'migrations', '20261005075500_web_push_subscription_health.sql');
if (!fs.existsSync(pushHealthMigrationPath)) failures.push('Missing web push subscription health migration.');
else {
  const pushHealthMigration = fs.readFileSync(pushHealthMigrationPath, 'utf8');
  for (const token of ['get_web_push_subscription_status','auth.uid()','enabled','authenticated']) {
    if (!pushHealthMigration.includes(token)) failures.push('Web push health migration is missing: ' + token);
  }
}

const pushAuthSource = fs.readFileSync(path.join(root, 'scripts', 'pwa-install-v117.js'), 'utf8');
for (const token of [
  "sb.auth.getSession()",
  "installAuthPushHook",
  "sb.auth.onAuthStateChange",
  "INITIAL_SESSION",
  "SIGNED_IN",
  "TOKEN_REFRESHED"
]) {
  if (!pushAuthSource.includes(token)) failures.push('Push auth-session registration contract is missing: ' + token);
}
const ensurePushStart = pushAuthSource.indexOf('async function ensureWebPush');
const ensurePushEnd = ensurePushStart >= 0 ? pushAuthSource.indexOf('\n  async function ensurePushHealth', ensurePushStart) : -1;
const ensurePushSection = ensurePushStart >= 0 && ensurePushEnd > ensurePushStart ? pushAuthSource.slice(ensurePushStart, ensurePushEnd) : '';
if (!ensurePushSection) failures.push('ensureWebPush section could not be located.');
else if (ensurePushSection.includes("typeof authUser!=='undefined'")) failures.push('ensureWebPush must not depend on UI authUser hydration.');

const notificationReminderSource = fs.readFileSync(path.join(root, 'scripts', 'pwa-install-v117.js'), 'utf8');
for (const token of [
  "notificationOnboardingMarkup(mode='permission')",
  "mode==='push-health'",
  "Retry notifications",
  "showNotificationOnboarding",
  "scheduleNotificationOnboarding"
]) {
  if (!notificationReminderSource.includes(token)) failures.push('Notification reminder contract is missing: ' + token);
}
for (const forbidden of [
  "NOTIFICATION_PROMPT_DISABLED_KEY",
  "data-pwa-dont-show-again",
  "neis-pwa-notification-prompt-disabled"
]) {
  if (notificationReminderSource.includes(forbidden)) failures.push('Notification reminder must not be permanently suppressible: ' + forbidden);
}

const notificationSoundSource = fs.readFileSync(path.join(root, 'scripts', 'social', 'notifications-v174.js'), 'utf8');
const notificationResetStart = notificationSoundSource.indexOf('async function reset()');
const notificationResetEnd = notificationResetStart >= 0 ? notificationSoundSource.indexOf('\n  function snapshot()', notificationResetStart) : -1;
const notificationResetSection = notificationResetStart >= 0 && notificationResetEnd > notificationResetStart
  ? notificationSoundSource.slice(notificationResetStart, notificationResetEnd)
  : '';
if (!notificationResetSection) failures.push('Notification reset section could not be located.');
else {
  if (notificationResetSection.includes('audioContext=null')) failures.push('Notification reset must preserve the unlocked AudioContext.');
  if (notificationResetSection.includes('soundUnlocked=false')) failures.push('Notification reset must preserve sound unlock state.');
}
if (!notificationSoundSource.includes('async function playSound()')) failures.push('Notification sound function is missing.');

const pushTabSyncSwSource = fs.readFileSync(path.join(root, 'neis-pwa-sw.js'), 'utf8');
for (const token of [
  'const VERSION = "neis-pwa-v10"',
  'NEIS_PUSH_NOTIFICATION',
  'self.clients.matchAll({ type: "window", includeUncontrolled: true })',
  'client.postMessage(payload)'
]) {
  if (!pushTabSyncSwSource.includes(token)) failures.push('Background push tab-sync contract is missing: ' + token);
}

const pushTabRuntimeSource = fs.readFileSync(path.join(root, 'scripts', 'social', 'notifications-v174.js'), 'utf8');
for (const token of ['function ingestPush(payload)','renderNotificationsIfVisible()','playSound()','ingestPush']) {
  if (!pushTabRuntimeSource.includes(token)) failures.push('Push ingestion runtime contract is missing: ' + token);
}

const pushClientSource = fs.readFileSync(path.join(root, 'scripts', 'pwa-install-v117.js'), 'utf8');
for (const token of [
  "navigator.serviceWorker.register('/neis-pwa-sw.js?v=12'",
  "event.data?.type==='NEIS_PUSH_NOTIFICATION'",
  "NEISNotificationRuntime?.ingestPush"
]) {
  if (!pushClientSource.includes(token)) failures.push('Push client tab-sync contract is missing: ' + token);
}

const authRestoreSource = fs.readFileSync(path.join(root, 'scripts', '03-auth-i18n.js'), 'utf8');
for (const token of [
  'function hasPersistedSupabaseSession()',
  'async function resolveInitialSession()',
  "const key='sb-'+host+'-auth-token'",
  'await resolveInitialSession()'
]) {
  if (!authRestoreSource.includes(token)) failures.push('Saved-session auth restore contract is missing: ' + token);
}

const immediateTabTitleSource = fs.readFileSync(path.join(root, 'scripts', 'social', 'notifications-v174.js'), 'utf8');
const renderNotifStart = immediateTabTitleSource.indexOf('const renderNotificationsIfVisible=()=>');
const renderNotifEnd = renderNotifStart >= 0 ? immediateTabTitleSource.indexOf('\n  };', renderNotifStart) + 5 : -1;
const renderNotifSection = renderNotifStart >= 0 && renderNotifEnd > renderNotifStart ? immediateTabTitleSource.slice(renderNotifStart, renderNotifEnd) : '';
if (!renderNotifSection || !renderNotifSection.includes('updateTabBadge()')) failures.push('Notification rendering must update the tab title directly.');
const ingestPushStart = immediateTabTitleSource.indexOf('function ingestPush(payload)');
const ingestPushEnd = ingestPushStart >= 0 ? immediateTabTitleSource.indexOf('\n  function applyRealtime', ingestPushStart) : -1;
const ingestPushSection = ingestPushStart >= 0 && ingestPushEnd > ingestPushStart ? immediateTabTitleSource.slice(ingestPushStart, ingestPushEnd) : '';
if (!ingestPushSection) failures.push('Push ingestion section could not be located.');
else if (!ingestPushSection.includes('updateTabBadge()')) failures.push('Push ingestion must update the tab title immediately.');

const targetedPollCreateSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
for (const token of [
  "data:createdPollPostId",
  ".eq('id',createdPollPostId).maybeSingle()",
  "handlePostRealtime({eventType:'INSERT',new:createdPollPost})",
  "loadCirclePolls(c.id,{force:true})",
  "NEISPatchCircleHomeRealtime"
]) {
  if (!targetedPollCreateSource.includes(token)) failures.push('Targeted Circle poll creation contract is missing: ' + token);
}
const pollCreateStart = targetedPollCreateSource.indexOf("sb.rpc('create_circle_poll_post'");
const pollCreateEnd = pollCreateStart >= 0 ? targetedPollCreateSource.indexOf("const {data:createdPost,error}", pollCreateStart) : -1;
const pollCreateSection = pollCreateStart >= 0 && pollCreateEnd > pollCreateStart ? targetedPollCreateSource.slice(pollCreateStart, pollCreateEnd) : '';
if (!pollCreateSection) failures.push('Circle poll creation section could not be located.');
else {
  const globalReloadCount = (pollCreateSection.match(/loadLiveData\(\)/g)||[]).length;
  if (globalReloadCount > 1) failures.push('Circle poll creation must use global loadLiveData only as a recovery fallback.');
}

const targetedMeetingRetrySource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
for (const token of [
  'async function refreshCircleMeetingsOnly',
  ".eq('circle_id',circleId).order('starts_at')",
  "state.dataErrors.meetings=null",
  "refreshCircleMeetingsOnly(state.activeCircleId)"
]) {
  if (!targetedMeetingRetrySource.includes(token)) failures.push('Targeted meeting retry contract is missing: ' + token);
}
const retryMeetingsIndex = targetedMeetingRetrySource.indexOf("root.querySelectorAll('[data-retry-meetings]')");
const retryMeetingsEnd = retryMeetingsIndex >= 0 ? targetedMeetingRetrySource.indexOf('\n', retryMeetingsIndex) : -1;
const retryMeetingsSection = retryMeetingsIndex >= 0 && retryMeetingsEnd > retryMeetingsIndex
  ? targetedMeetingRetrySource.slice(retryMeetingsIndex, retryMeetingsEnd)
  : '';
if (!retryMeetingsSection) failures.push('Meeting retry binding could not be located.');
else if (retryMeetingsSection.includes('loadLiveData()')) failures.push('Meeting retry must not reload all live data.');

const profileStatsSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
for (const token of [
  'profileStats:{}',
  'const profileStatsRequests=new Map()',
  'async function refreshProfileStats',
  ".eq('following_id',id).eq('status','accepted')",
  ".eq('follower_id',id).eq('status','accepted')",
  ".eq('author_id',id).is('circle_id',null)",
  "const followers=stats?stats.followers:'…'",
  "refreshProfileStats(state.activeProfileId,{force:true})"
]) {
  if (!profileStatsSource.includes(token)) failures.push('Accurate profile stats contract is missing: ' + token);
}
const profileViewStart = profileStatsSource.indexOf('function profileView(){');
const profileViewEnd = profileViewStart >= 0 ? profileStatsSource.indexOf('\n}\n\nfunction connectionsView', profileViewStart) : -1;
const profileViewSection = profileViewStart >= 0 && profileViewEnd > profileViewStart ? profileStatsSource.slice(profileViewStart, profileViewEnd) : '';
if (!profileViewSection) failures.push('Profile view section could not be located.');
else if (profileViewSection.includes("state.follows.filter(f=>same(f.following_id,p.id)")) failures.push('Profile follower counts must not come from the current-user follows cache.');

const realtimeRecoverySource = fs.readFileSync(path.join(root, 'scripts', 'social', 'realtime-v175.js'), 'utf8');
for (const token of [
  'statusListener',
  'onStatus',
  'previousStatus',
  'statusListener?.(nextStatus,previousStatus)'
]) {
  if (!realtimeRecoverySource.includes(token)) failures.push('Realtime reconnect status contract is missing: ' + token);
}

const chatCatchUpSource = fs.readFileSync(path.join(root, 'scripts', 'social', 'chat-bootstrap-v181.js'), 'utf8');
for (const token of [
  'async function catchUpDirect',
  'async function catchUpCircle',
  'mergeById',
  'catchUpDirect,',
  'catchUpCircle'
]) {
  if (!chatCatchUpSource.includes(token)) failures.push('Chat catch-up contract is missing: ' + token);
}
if (chatCatchUpSource.includes('state.liveMessages=[];\n    if(!conversationIds.length)return')) {
  failures.push('Chat reconnect catch-up must not wipe loaded DM history.');
}

const socialChatRealtimeSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
for (const token of [
  'async function recoverChatRealtimeGap()',
  'handleSocialRealtimeStatus',
  'chatBootstrapData.catchUpDirect',
  'chatBootstrapData.catchUpCircle',
  'onStatus:handleSocialRealtimeStatus',
  "messageDom.patchCircleFlow({circleId,id,event:'UPDATE'"
]) {
  if (!socialChatRealtimeSource.includes(token)) failures.push('Targeted chat realtime recovery is missing: ' + token);
}
const recoverStart = socialChatRealtimeSource.indexOf('async function recoverChatRealtimeGap()');
const recoverEnd = recoverStart >= 0 ? socialChatRealtimeSource.indexOf('\nfunction handleSocialRealtimeStatus', recoverStart) : -1;
const recoverSection = recoverStart >= 0 && recoverEnd > recoverStart ? socialChatRealtimeSource.slice(recoverStart, recoverEnd) : '';
if (!recoverSection) failures.push('Chat realtime recovery section could not be located.');
else if (recoverSection.includes('loadLiveData()')) failures.push('Chat realtime recovery must not trigger a global live-data refresh.');

const expandedCoreRealtimeSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
for (const token of [
  'function handleCircleRealtime(payload)',
  'function handleProfileBadgeRealtime(payload)',
  'function patchActiveCircleIdentity(circle)',
  "table:'circle_poll_options'",
  "table:'circle_poll_votes'",
  'queueCirclePollRealtimeRefresh(circleId)',
  'handleCircleRealtime,',
  'handleProfileBadgeRealtime,'
]) {
  if (!expandedCoreRealtimeSource.includes(token)) failures.push('Expanded core realtime contract is missing: ' + token);
}

const expandedRealtimeRegistry = fs.readFileSync(path.join(root, 'scripts', 'social', 'realtime-v175.js'), 'utf8');
for (const token of [
  "['circles','handleCircleRealtime']",
  "['profiles','handleProfileRealtime']",
  "['profile_badges','handleProfileBadgeRealtime']",
  "version:'175.4'"
]) {
  if (!expandedRealtimeRegistry.includes(token)) failures.push('Realtime registry core binding is missing: ' + token);
}

const coreRealtimeMigrationPath = path.join(root, 'supabase', 'migrations', '20261006003000_expand_core_ui_realtime.sql');
if (!fs.existsSync(coreRealtimeMigrationPath)) failures.push('Missing core UI realtime publication migration.');
else {
  const migrationSource = fs.readFileSync(coreRealtimeMigrationPath, 'utf8');
  for (const token of ['public.circles','public.profiles','public.profile_badges','supabase_realtime']) {
    if (!migrationSource.includes(token)) failures.push('Core realtime migration is missing: ' + token);
  }
}

const userScopedRealtimeSocial = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
for (const token of [
  'function handleBookmarkRealtime(payload)',
  "['bookmarks','handleBookmarkRealtime']",
  'patchVisiblePostState(postId)'
]) {
  const source = token.includes("['bookmarks'") ? fs.readFileSync(path.join(root, 'scripts', 'social', 'realtime-v175.js'), 'utf8') : userScopedRealtimeSocial;
  if (!source.includes(token)) failures.push('Bookmark realtime contract is missing: ' + token);
}

const studyRealtimeSource = fs.readFileSync(path.join(root, 'scripts', 'study-v42.js'), 'utf8');
for (const token of [
  'function renderStudyResultsOnly()',
  'async function loadResources({silent=false}={})',
  'function queueStudyRealtimeRefresh',
  'async function setupStudyRealtime()',
  "table:'study_resources'",
  "table:'study_resource_actions'",
  "filter:'user_id=eq.'+uid"
]) {
  if (!studyRealtimeSource.includes(token)) failures.push('Study realtime contract is missing: ' + token);
}

const timetableRealtimeSource = fs.readFileSync(path.join(root, 'scripts', 'timetable-v147.js'), 'utf8');
for (const token of [
  'function applyTimetableRealtime(payload)',
  'async function setupTimetableRealtime()',
  "table:'user_timetable_entries'",
  "filter:'user_id=eq.'+uid",
  'tt.rows=sortRows(tt.rows)'
]) {
  if (!timetableRealtimeSource.includes(token)) failures.push('Timetable realtime contract is missing: ' + token);
}

for (const migrationName of [
  '20261006005500_expand_user_scoped_realtime.sql',
  '20261006005700_timetable_realtime_delete_identity.sql'
]) {
  const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);
  if (!fs.existsSync(migrationPath)) failures.push('Missing user-scoped realtime migration: ' + migrationName);
}

const homeSafetySource = fs.readFileSync(path.join(root, 'scripts', '02-content-admin.js'), 'utf8');
if (!homeSafetySource.includes('Private messages may be reviewed for safety upon request.')) failures.push('Home private-message safety disclosure is missing.');
if (!homeSafetySource.includes('class="home-safety-note"')) failures.push('Home safety disclosure must use the subtle home-only class.');
const homeSafetyCss = fs.readFileSync(path.join(root, 'styles', 'app.css'), 'utf8');
for (const token of ['.home-safety-note{','font-size:8px','font-weight:300']) {
  if (!homeSafetyCss.includes(token)) failures.push('Home safety disclosure styling is missing: ' + token);
}

const dmSafetySource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
for (const token of [
  "function adminDmSafetyPanel()",
  "admin_search_dm_users",
  "admin_list_user_dm_conversations",
  "admin_create_dm_review_request",
  "admin_get_dm_review_messages",
  "data-admin-dm-safety-search",
  "data-admin-dm-review-conversation"
]) {
  if (!dmSafetySource.includes(token)) failures.push('Main-admin DM safety review UI missing: ' + token);
}
if (!dmSafetySource.includes("canOpenAdminModerationTargets()?adminDmSafetyPanel():''")) failures.push('DM safety review must remain main-admin-only in the Admin view.');

const dmSafetyMigrationPath = path.join(root, 'supabase', 'migrations', '20261007023000_main_admin_dm_safety_review.sql');
if (!fs.existsSync(dmSafetyMigrationPath)) failures.push('DM safety review migration is missing.');
else {
  const dmSafetySql = fs.readFileSync(dmSafetyMigrationPath, 'utf8');
  for (const token of [
    'admin_dm_review_requests',
    'admin_dm_audit_log',
    "lower(coalesce(u.email,''))='mreyadishere@gmail.com'",
    "p.role='admin'",
    "expires_at>now()",
    "action in ('request','view')",
    'revoke all on table public.admin_dm_review_requests from public, anon, authenticated',
    'revoke all on table public.admin_dm_audit_log from public, anon, authenticated'
  ]) {
    if (!dmSafetySql.includes(token)) failures.push('DM safety review database guard missing: ' + token);
  }
}

const accountSafetySource = fs.readFileSync(path.join(root, 'scripts', 'security-v11.js'), 'utf8');
for (const forbidden of [
  "data-delete-account",
  "async function deleteAccount()",
  "sb.rpc('delete_my_account')",
  "Delete permanently",
  "Delete your account permanently?"
]) {
  if (accountSafetySource.includes(forbidden)) failures.push('Permanent account deletion must stay disabled in the client: ' + forbidden);
}
if (!accountSafetySource.includes("data-deactivate-account")) failures.push('Account deactivation should remain available.');

const disableAccountDeletionMigration = path.join(root, 'supabase', 'migrations', '20261007124500_disable_permanent_account_deletion.sql');
if (!fs.existsSync(disableAccountDeletionMigration)) failures.push('Permanent account deletion disable migration is missing.');
else {
  const sql = fs.readFileSync(disableAccountDeletionMigration, 'utf8');
  if (!sql.includes('revoke execute on function public.delete_my_account() from public, anon, authenticated;')) {
    failures.push('delete_my_account EXECUTE must be revoked from public, anon, and authenticated.');
  }
}

const criticalStartupSource = fs.readFileSync(path.join(root, 'scripts', '02-content-admin.js'), 'utf8');
for (const token of [
  'let primaryBackgroundRefreshPromise=null',
  'function refreshPrimaryBackground()',
  "profiles!posts_author_id_fkey(id,full_name,username,avatar_url,grade,branch,campus)",
  ".eq('user_id',uid)",
  "sb.rpc('post_engagement_counts')",
  'refreshPrimaryBackground();'
]) {
  if (!criticalStartupSource.includes(token)) failures.push('Critical startup split is missing: ' + token);
}
const primaryLoadStart = criticalStartupSource.indexOf('loadLiveData=async function(){');
const primaryLoadEnd = primaryLoadStart >= 0 ? criticalStartupSource.indexOf('\nwindow.NEISPrimaryContentLoad=loadLiveData;', primaryLoadStart) : -1;
const primaryLoadSection = primaryLoadStart >= 0 && primaryLoadEnd > primaryLoadStart
  ? criticalStartupSource.slice(primaryLoadStart, primaryLoadEnd)
  : '';
if (!primaryLoadSection) failures.push('Primary live-data loader could not be located.');
else {
  if (primaryLoadSection.includes("sb.from('reactions').select('post_id,user_id,reaction')\n")) failures.push('Critical startup must not fetch the full reactions table.');
  if (primaryLoadSection.includes("sb.from('profiles').select('id,full_name,username,avatar_url,grade,branch,campus,bio,interests,role,onboarding_complete').order('full_name')")) failures.push('Critical startup must not await the full member directory.');
}

const engagementMigrationPath = path.join(root, 'supabase', 'migrations', '20261006105000_post_engagement_counts.sql');
if (!fs.existsSync(engagementMigrationPath)) failures.push('Missing compact post engagement counts migration.');
else {
  const engagementMigration = fs.readFileSync(engagementMigrationPath, 'utf8');
  for (const token of ['post_engagement_counts','returns table(post_id uuid','security invoker']) {
    if (!engagementMigration.includes(token)) failures.push('Engagement-count migration is missing: ' + token);
  }
}

const reactionDeltaSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
for (const token of [
  'post.likes=Math.max(0,Number(post.likes||0)+1)',
  'post.likes=Math.max(0,Number(post.likes||0)-1)'
]) {
  if (!reactionDeltaSource.includes(token)) failures.push('Realtime reaction delta handling is missing: ' + token);
}

const fastCommentEngagementSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
for (const token of [
  'async function refreshOpenCommentEngagement(commentId)',
  "sb.from('comment_likes').select('user_id').eq('comment_id',commentId)",
  "sb.from('comment_creator_hearts').select('creator_id').eq('comment_id',commentId)",
  'Promise.resolve(refreshOpenCommentEngagement(commentId))'
]) {
  if (!fastCommentEngagementSource.includes(token)) failures.push('Targeted comment engagement contract is missing: ' + token);
}
const commentLikeBindStart = fastCommentEngagementSource.indexOf("querySelectorAll('[data-comment-like]')");
const commentLikeBindEnd = commentLikeBindStart >= 0 ? fastCommentEngagementSource.indexOf("bindComposerKeyboard($('#replyInput')", commentLikeBindStart) : -1;
const commentLikeBindSection = commentLikeBindStart >= 0 && commentLikeBindEnd > commentLikeBindStart
  ? fastCommentEngagementSource.slice(commentLikeBindStart, commentLikeBindEnd)
  : '';
if (!commentLikeBindSection) failures.push('Comment engagement binding section could not be located.');
else if (commentLikeBindSection.includes('await comments(postId)')) failures.push('Comment likes/hearts must not reload the full discussion.');

const replyNotificationMigrationPath = path.join(root, 'supabase', 'migrations', '20261006223000_message_reply_notifications.sql');
if (!fs.existsSync(replyNotificationMigrationPath)) failures.push('Missing message reply notification migration.');
else {
  const replyNotificationMigration = fs.readFileSync(replyNotificationMigrationPath, 'utf8');
  for (const token of [
    "then 'reply'",
    "replied to your message",
    "'message',",
    "'circle_message',",
    "cm.user_id<>reply_owner"
  ]) {
    if (!replyNotificationMigration.includes(token)) failures.push('Message reply notification migration is missing: ' + token);
  }
}

const adminModerationDeepLinkSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
for (const token of [
  "const canOpenAdminModerationTargets=()=>state.isAdmin&&String(authUser?.email||'').trim().toLowerCase()===AUTHOR_LIKE_EMAIL_ADMIN",
  'async function openAdminModerationTarget(type,id)',
  'data-admin-open-content=',
  'data-admin-content-id=',
  "targetType==='circle message'",
  "targetType==='meeting'",
  "targetType==='reply'",
  "post.circle_id",
  "comments(post.id,reply.id)",
  'data-gallery-id='
]) {
  if (!adminModerationDeepLinkSource.includes(token)) failures.push('Primary-admin moderation deep-link contract is missing: ' + token);
}
const moderationBindStart = adminModerationDeepLinkSource.indexOf("querySelectorAll('[data-admin-open-content]')");
const moderationBindEnd = moderationBindStart >= 0 ? adminModerationDeepLinkSource.indexOf("querySelectorAll('[data-delete-report]')", moderationBindStart) : -1;
const moderationBindSection = moderationBindStart >= 0 && moderationBindEnd > moderationBindStart
  ? adminModerationDeepLinkSource.slice(moderationBindStart, moderationBindEnd)
  : '';
if (!moderationBindSection) failures.push('Primary-admin moderation row binding could not be located.');
else if (!moderationBindSection.includes("closest?.('button,a,input,select,textarea')")) failures.push('Moderation row navigation must not hijack action-button clicks.');

const manualContentEmailSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
for (const token of [
  'function loadAdminModerationEmailData()',
  'function loadAdminContentModerationFeed({append=false}={})',
  'function adminModerationFiltersMarkup()',
  'function sendAdminContentEmail(type,id,title)',
  "sb.rpc('admin_get_content_moderation_feed'",
  "sb.rpc('admin_preview_content_email_audience'",
  "sb.rpc('admin_email_content_to_audience'",
  "sb.rpc('admin_delete_moderation_content'",
  'data-admin-email-content=',
  'data-admin-content-type',
  'data-admin-content-period',
  'data-admin-content-sort',
  'data-admin-content-from',
  'data-admin-content-to',
  "'article comment'",
  "'study resource'",
  'All platform content appears here, including articles.'
]) {
  if (!manualContentEmailSource.includes(token)) failures.push('Admin content moderation contract is missing: ' + token);
}
for (const forbidden of [
  'function notificationBroadcastMatrix()',
  'data-notification-channel=',
  'data-notification-key=',
  'adminModerationExtras'
]) {
  if (manualContentEmailSource.includes(forbidden)) failures.push('Legacy admin moderation UI must be removed: ' + forbidden);
}
const manualContentEmailMigrationPath = path.join(root, 'supabase', 'migrations', '20261007011000_manual_content_email_broadcasts.sql');
if (!fs.existsSync(manualContentEmailMigrationPath)) failures.push('Missing manual content email broadcast migration.');
else {
  const migration = fs.readFileSync(manualContentEmailMigrationPath, 'utf8');
  for (const token of [
    'admin_content_email_broadcasts',
    'admin_preview_content_email_audience',
    'admin_email_content_to_audience',
    "lower(coalesce(u.email,''))='mreyadishere@gmail.com'",
    'site_enabled=true',
    'email_enabled=false',
    "v_type='opportunity'",
    "v_type='study resource'",
    "v_scope:='circle'",
    'notify_new_opportunity_site',
    'opportunities_notify_new_site',
    'notify_new_study_resource_site',
    'study_resources_notify_new_site'
  ]) {
    if (!migration.includes(token)) failures.push('Manual content email migration is missing: ' + token);
  }
}
const moderationFeedMigrationPath = path.join(root, 'supabase', 'migrations', '20261007150000_admin_content_moderation_feed_filters.sql');
if (!fs.existsSync(moderationFeedMigrationPath)) failures.push('Missing complete admin content moderation feed migration.');
else {
  const migration = fs.readFileSync(moderationFeedMigrationPath, 'utf8');
  for (const token of [
    'admin_get_content_moderation_feed',
    'admin_delete_moderation_content',
    "'article comment'",
    'public.article_comments',
    'public.articles',
    'public.opportunities',
    'public.study_resources',
    "lower(coalesce(u.email,''))='mreyadishere@gmail.com'",
    "p.role='admin'",
    'revoke all on function public.admin_get_content_moderation_feed',
    'revoke all on function public.admin_delete_moderation_content'
  ]) {
    if (!migration.includes(token)) failures.push('Admin moderation feed migration is missing: ' + token);
  }
}
const manualOnlyPostArticleEmailMigrationPath = path.join(root, 'supabase', 'migrations', '20261007160000_manual_only_post_article_emails.sql');
if (!fs.existsSync(manualOnlyPostArticleEmailMigrationPath)) failures.push('Missing manual-only post/article email migration.');
else {
  const migration = fs.readFileSync(manualOnlyPostArticleEmailMigrationPath, 'utf8');
  for (const token of [
    'drop trigger if exists posts_enqueue_admin_email on public.posts',
    'drop trigger if exists articles_enqueue_new_email on public.articles',
    'create or replace function public.enqueue_admin_post_email()',
    'create or replace function public.enqueue_admin_article_email()',
    'create or replace function public.enqueue_new_article_email()',
    'revoke execute on function public.enqueue_admin_post_email() from public, anon, authenticated',
    "event_key like 'admin-post:%'",
    "event_key like 'article-published:%'"
  ]) {
    if (!migration.includes(token)) failures.push('Manual-only post/article email guard is missing: ' + token);
  }
}

const notificationEmailWorker = fs.readFileSync(path.join(root, 'supabase', 'functions', 'send-notification-email', 'index.ts'), 'utf8');
for (const token of [
  'https://api.brevo.com/v3/account',
  'const batchLimit = remainingCredits === null ? 25 : Math.min(25, remainingCredits)',
  '.limit(batchLimit)',
  'brevo_daily_limit_reached'
]) {
  if (!notificationEmailWorker.includes(token)) failures.push('Email worker Brevo-capacity guard is missing: ' + token);
}
const brevoCapacityFunctionPath = path.join(root, 'supabase', 'functions', 'brevo-email-capacity', 'index.ts');
if (!fs.existsSync(brevoCapacityFunctionPath)) failures.push('Missing Brevo email capacity Edge Function.');
else {
  const capacitySource = fs.readFileSync(brevoCapacityFunctionPath, 'utf8');
  for (const token of [
    'mreyadishere@gmail.com',
    'required_recipients',
    'https://api.brevo.com/v3/account',
    'const allowed = credits === null ? true : required <= credits'
  ]) {
    if (!capacitySource.includes(token)) failures.push('Brevo capacity function guard is missing: ' + token);
  }
}
for (const token of [
  'async function checkAdminEmailCapacity(requiredRecipients)',
  "sb.functions.invoke('brevo-email-capacity'",
  'Nothing was queued.',
  'const freshCapacity=await checkAdminEmailCapacity(count)'
]) {
  if (!manualContentEmailSource.includes(token)) failures.push('Admin email capacity UI guard is missing: ' + token);
}

const pinnedCircleJumpSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
for (const token of [
  'async function jumpToPinnedCircleMessage(id)',
  "select(chatFields.circleMessage).eq('id',Number(key)).eq('circle_id',circleId).maybeSingle()",
  'const preservedPins=state.circleMessages.filter',
  "circleMessagePinActive(m)&&!fetched.some",
  'flow.innerHTML=activeMessages.length?activeMessages.map'
]) {
  if (!pinnedCircleJumpSource.includes(token)) failures.push('Pinned Circle message jump recovery is missing: ' + token);
}

const circleMessagePinsMigrationPath = path.join(root, 'supabase', 'migrations', '20261007133000_circle_chat_message_pins.sql');
if (!fs.existsSync(circleMessagePinsMigrationPath)) failures.push('Missing Circle chat message pins migration.');
else {
  const migration = fs.readFileSync(circleMessagePinsMigrationPath, 'utf8');
  for (const token of [
    'add column if not exists pinned_at timestamptz',
    'add column if not exists pinned_by uuid',
    'add column if not exists pin_expires_at timestamptz',
    'pin_circle_message',
    'unpin_circle_message',
    "cm.role in ('owner','admin')",
    "lower(coalesce(u.email,''))='mreyadishere@gmail.com'",
    'duration_minutes_input < 5 or duration_minutes_input > 43200',
    'revoke all on function public.pin_circle_message(bigint,integer) from public, anon',
    'revoke all on function public.unpin_circle_message(bigint) from public, anon'
  ]) {
    if (!migration.includes(token)) failures.push('Circle message pin database contract is missing: ' + token);
  }
}
const circlePinSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
for (const token of [
  'function canPinCircleMessage(circleId)',
  'function circleMessagePinActive(message)',
  'function circlePinnedPanelInner(circleId)',
  "sb.rpc('pin_circle_message'",
  "sb.rpc('unpin_circle_message'",
  'data-circle-pin-jump',
  'data-circle-unpin',
  'data-message-dialog-pin',
  "tr('Pin message','تثبيت الرسالة')",
  "tr('Unpin message','إلغاء تثبيت الرسالة')"
]) {
  if (!circlePinSource.includes(token)) failures.push('Circle message pin UI contract is missing: ' + token);
}
const chatFieldSource = fs.readFileSync(path.join(root, 'scripts', 'social', 'chat-fields-v182.js'), 'utf8');
for (const token of ['pinned_at','pinned_by','pin_expires_at']) {
  if (!chatFieldSource.includes(token)) failures.push('Circle message pin realtime field is missing: ' + token);
}

const brevoCapacityUiSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
for (const token of [
  "sb.auth.getSession()",
  "headers:{Authorization:`Bearer ${accessToken}`}",
  "sb.functions.invoke('brevo-email-capacity'"
]) {
  if (!brevoCapacityUiSource.includes(token)) failures.push('Brevo capacity auth handoff is missing: ' + token);
}
const brevoCapacityFunctionSource = fs.readFileSync(path.join(root, 'supabase', 'functions', 'brevo-email-capacity', 'index.ts'), 'utf8');
for (const token of [
  'SUPABASE_ANON_KEY',
  '/auth/v1/user',
  'Authorization: `Bearer ${token}`',
  'mreyadishere@gmail.com',
  'profile.role !== "admin"',
  'account_status'
]) {
  if (!brevoCapacityFunctionSource.includes(token)) failures.push('Brevo capacity in-function authorization is missing: ' + token);
}

const circleReplyNotificationMigrationPath = path.join(root, 'supabase', 'migrations', '20261007004200_fix_circle_reply_notifications_dedicated.sql');
if (!fs.existsSync(circleReplyNotificationMigrationPath)) failures.push('Missing production Circle reply notification fix migration.');
else {
  const migration = fs.readFileSync(circleReplyNotificationMigrationPath, 'utf8');
  for (const token of [
    "new.reply_to_id is not null",
    "reply_owner",
    "'reply'",
    "replied to your message",
    "'circle_message'",
    "cm.user_id<>reply_owner",
    "New messages in "
  ]) {
    if (!migration.includes(token)) failures.push('Circle reply notification fix is missing: ' + token);
  }
}
const notificationBellCss = fs.readFileSync(path.join(root, 'styles', 'app.css'), 'utf8');
for (const token of [
  '.top-actions [data-action="notifications"]>.count-badge',
  'position:absolute',
  'background:var(--coral)',
  'pointer-events:none'
]) {
  if (!notificationBellCss.includes(token)) failures.push('Notification bell badge styling is missing: ' + token);
}
const notificationBellSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
for (const token of [
  "bell.querySelector('.count-badge')",
  "badge.classList.toggle('hidden',!not)",
  "bell.setAttribute('aria-label'"
]) {
  if (!notificationBellSource.includes(token)) failures.push('Notification bell badge sync is missing: ' + token);
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
  if (!loader.includes('profiles!posts_author_id_fkey')) failures.push('Primary posts loader must hydrate post authors inline so Home does not wait for the full member directory.');
  const criticalMemberQuery = loader.indexOf("sb.from('profiles').select('id,full_name,username,avatar_url,grade,branch,campus,bio,interests,role,onboarding_complete').order('full_name')");
  const backgroundRefresh = source.indexOf('function refreshPrimaryBackground()');
  if (criticalMemberQuery >= 0 && (backgroundRefresh < 0 || criticalMemberQuery > backgroundRefresh)) failures.push('Full member directory must stay outside the critical startup path.');
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

const meetingPlannerHomeComposerSource = fs.readFileSync(path.join(root, 'scripts', '02-content-admin.js'), 'utf8');
if (!meetingPlannerHomeComposerSource.includes('<option>Meeting Planner</option>')) failures.push('Home composer must expose Meeting Planner as a fixed post type.');
const meetingPlannerCircleComposerSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
if (!meetingPlannerCircleComposerSource.includes('<option>Meeting Planner</option>')) failures.push('Circle composer must expose Meeting Planner as a fixed post type.');

const meetingPlannerSourcePath = path.join(root, 'scripts', 'meeting-planner-v1.js');
if (!fs.existsSync(meetingPlannerSourcePath)) failures.push('Meeting planner post module is missing.');
else {
  const source = fs.readFileSync(meetingPlannerSourcePath, 'utf8');
  for (const token of [
    "post_type==='meeting_availability'",
    "['postKind','cpKind'].includes(select.id)",
    "document.querySelectorAll('#postKind,#cpKind')",
    "sb.rpc('create_meeting_planner_post'",
    "sb.rpc('save_meeting_availability'",
    "sb.rpc('get_meeting_planner_results'",
    "data-meeting-availability",
    "Friday 7:00 PM–10:00 PM",
    "meeting-day-editor",
    "Meeting Planner"
  ]) {
    if (!source.includes(token)) failures.push('Meeting planner UI contract is missing: ' + token);
  }
}
const meetingPlannerMigrationPath = path.join(root, 'supabase', 'migrations', '20261007194000_meeting_planner_posts.sql');
if (!fs.existsSync(meetingPlannerMigrationPath)) failures.push('Meeting planner migration is missing.');
else {
  const sql = fs.readFileSync(meetingPlannerMigrationPath, 'utf8');
  for (const token of [
    'public.meeting_planners',
    'public.meeting_availability_ranges',
    'public.meeting_availability_responses',
    "'Meeting Planner'::text",
    'create_meeting_planner_post',
    'save_meeting_availability',
    'get_meeting_planner_results',
    'meeting_response_touch_planner',
    "revoke all on function public.create_meeting_planner_post",
    "revoke all on function public.save_meeting_availability",
    "revoke all on function public.get_meeting_planner_results"
  ]) {
    if (!sql.includes(token)) failures.push('Meeting planner database contract is missing: ' + token);
  }
}
const indexMeetingPlannerSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (!indexMeetingPlannerSource.includes('scripts/meeting-planner-v1.js')) failures.push('Meeting planner script must be loaded by index.html.');

const brevoCapacityAuthSource = fs.readFileSync(path.join(root, 'supabase', 'functions', 'brevo-email-capacity', 'index.ts'), 'utf8');
for (const token of [
  'SUPABASE_ANON_KEY',
  '/auth/v1/user',
  'Authorization: `Bearer ${token}`',
  'mreyadishere@gmail.com',
  'profile.role !== "admin"'
]) {
  if (!brevoCapacityAuthSource.includes(token)) failures.push('Brevo capacity verification auth is missing: ' + token);
}

const sharedContentSourcePath = path.join(root, 'scripts', 'content-share-v1.js');
if (!fs.existsSync(sharedContentSourcePath)) failures.push('Unified content share module is missing.');
else {
  const source = fs.readFileSync(sharedContentSourcePath, 'utf8');
  for (const token of [
    "data-content-share-tab=\"dm\"",
    "data-content-share-tab=\"circle\"",
    "start_direct_conversation",
    "sb.from('messages').insert(payload)",
    "sb.from('circle_messages').insert(payload)",
    "payload.shared_article_id=item.id",
    "payload.shared_post_id=item.id",
    "data-action=\"share\"",
    "window.NEISContentShare={open:open}"
  ]) {
    if (!source.includes(token)) failures.push('Unified content share contract is missing: ' + token);
  }
}
const sharedContentMigrationPath = path.join(root, 'supabase', 'migrations', '20261007202000_shared_posts_articles_in_chats.sql');
if (!fs.existsSync(sharedContentMigrationPath)) failures.push('Shared posts/articles chat migration is missing.');
else {
  const sql = fs.readFileSync(sharedContentMigrationPath, 'utf8');
  for (const token of [
    'shared_post_id uuid references public.posts(id) on delete set null',
    'shared_article_id bigint references public.articles(id) on delete set null',
    "['native'::text,'copy'::text,'connections'::text,'circles'::text]"
  ]) {
    if (!sql.includes(token)) failures.push('Shared content migration contract is missing: ' + token);
  }
}
const sharedContentSocialSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
for (const token of [
  'function sharedChatContentCard(m)',
  'data-shared-post=',
  'data-shared-article=',
  "root.querySelectorAll('[data-shared-post]')"
]) {
  if (!sharedContentSocialSource.includes(token)) failures.push('Shared content chat rendering is missing: ' + token);
}
const sharedContentArticleSource = fs.readFileSync(path.join(root, 'scripts', 'articles-v27.js'), 'utf8');
if (!sharedContentArticleSource.includes('window.NEISContentShare?.open')) failures.push('Article sharing must use the unified DM/Circle picker.');

const circleAdminRoleMigrationPath = path.join(root, 'supabase', 'migrations', '20261008093000_fix_circle_admin_role_persistence.sql');
if (!fs.existsSync(circleAdminRoleMigrationPath)) failures.push('Circle admin role persistence migration is missing.');
else {
  const sql = fs.readFileSync(circleAdminRoleMigrationPath, 'utf8');
  for (const token of [
    "'admin'::text",
    'drop policy if exists circle_members_manage',
    "public.circle_role(circle_id) in ('owner','admin')",
    "role in ('member','moderator','admin')"
  ]) {
    if (!sql.includes(token)) failures.push('Circle admin role persistence contract is missing: ' + token);
  }
}
const circleAdminRoleSource = fs.readFileSync(path.join(root, 'scripts', '05-social.js'), 'utf8');
for (const token of [
  'data.role!==nextRole',
  "toast(t('Role updated.'",
  ".select('circle_id,user_id,role,status,joined_at')"
]) {
  if (!circleAdminRoleSource.includes(token)) failures.push('Circle role update verification is missing: ' + token);
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
