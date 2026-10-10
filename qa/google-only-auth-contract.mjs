// Guard the ORIGINAL NEIS Circle Google-only UI during infrastructure migration.
// Does not change app code or enable alternative sign-in mechanisms.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const identity = readFileSync('scripts/identity-v15.js', 'utf8');
const native = readFileSync('scripts/mobile-push-v50.js', 'utf8');
const files = ['scripts/identity-v15.js', 'scripts/mobile-push-v50.js'];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  assert.doesNotMatch(src, /signInWithOtp|signInWithPassword|auth\.signUp\s*\(/i,
    'Do not add email OTP/password login to '+file+'; the original app is Google-only.');
}
assert.match(identity, /data-auth-google/, 'Original Google login button must remain.');
assert.match(identity, /Continue with Google/, 'Preserve original Google login label.');
assert.match(identity, /googleSignIn\s*\(\s*\)/, 'Preserve Google sign-in handler.');
assert.match(identity, /neis-auth-stay-signed-in/, 'Preserve original stay-signed-in preference.');
assert.match(identity, /function\s+phoneGate\s*\(/, 'Preserve phone gate after Google login.');
assert.match(native, /provider\s*:\s*['"]google['"]/, 'Preserve native Google OAuth provider.');
console.log('GOOGLE_ONLY_ORIGINAL_AUTH_CONTRACT=PASS');
console.log('APPLICATION_SOURCE_MODIFIED=NO');
