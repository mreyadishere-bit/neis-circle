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

const serviceWorker = path.join(root, 'neis-pwa-sw.js');
if (!fs.existsSync(serviceWorker)) failures.push('neis-pwa-sw.js is missing');

const socialPath = path.join(root, 'scripts', '05-social.js');
if (fs.existsSync(socialPath)) {
  const socialSource = fs.readFileSync(socialPath, 'utf8');
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

const contentAdminPath = path.join(root, 'scripts', '02-content-admin.js');
if (fs.existsSync(contentAdminPath)) {
  const contentAdminSource = fs.readFileSync(contentAdminPath, 'utf8');
  if (/table:'posts'\},async\(\)=>\{await loadLiveData\(\);render\(\)\}/.test(contentAdminSource)) {
    failures.push('02-content-admin.js must not keep the legacy full-refresh posts realtime listener.');
  }
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
