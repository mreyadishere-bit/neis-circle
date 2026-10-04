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
  if (!socialSource.includes('NEISChatBootstrapData')) failures.push('Startup chat loading must remain delegated to the chat bootstrap module.');
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
  ? followActionSource.indexOf("root.querySelectorAll('[data-open-circle]')", followRequestStart)
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
