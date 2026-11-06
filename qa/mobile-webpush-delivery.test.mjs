import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sender=readFileSync('supabase/functions/send-web-push/index.ts','utf8');
const notifications=readFileSync('scripts/social/notifications-v174.js','utf8');
const pwa=readFileSync('scripts/pwa-install-v117.js','utf8');
assert.match(sender,/notificationType==="message" \|\| \(notificationType==="reply" && entityType==="message"\)/,
  'DM replies must respect Direct messages push preferences');
assert.match(sender,/notificationType==="reply" && entityType==="circle_message"/,
  'Circle replies must respect Circle messages push preferences');
assert.match(sender,/urgency:"high"/);
assert.match(sender,/const workers=4/);
assert.match(sender,/await Promise\.all\(Array\.from\(/,'bounded concurrent device deliveries');
assert.match(sender,/status===404\|\|status===410/,'expired endpoints must be disabled');
assert.match(notifications,/healthy\?30000:10000/,'foreground must reconcile missed Realtime events');
assert.match(notifications,/document\.hidden\)return;/,'background must not poll');
assert.match(pwa,/Repair background notifications/);
assert.match(pwa,/Test device notification/);
console.log('MOBILE_WEBPUSH_RELIABILITY_CHECK=PASS');
