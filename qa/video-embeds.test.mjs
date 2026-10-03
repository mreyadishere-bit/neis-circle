import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../scripts/social/video-embeds-v176.js',import.meta.url),'utf8');
const context={URL,console};
context.window=context;
vm.createContext(context);
vm.runInContext(source,context,{filename:'video-embeds-v176.js'});

const api=context.NEISVideoEmbeds;
assert.equal(api.version,'176.0');

const yt=api.parse('https://youtu.be/dQw4w9WgXcQ');
assert.equal(yt.provider,'youtube');
assert.equal(yt.id,'dQw4w9WgXcQ');
assert.equal(yt.embedUrl,'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');

const drive=api.parse('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345/view?usp=sharing');
assert.equal(drive.provider,'google-drive');
assert.equal(drive.id,'1AbCdEfGhIjKlMnOpQrStUvWxYz_12345');
assert.equal(drive.embedUrl,'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345/preview');

const driveOpen=api.parse('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz_12345');
assert.equal(driveOpen.provider,'google-drive');

assert.equal(api.parse('https://example.com/video.mp4'),null);
assert.equal(api.parse('http://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345/view'),null);
assert.equal(api.isValid('https://youtube.com/watch?v=dQw4w9WgXcQ'),true);
assert.equal(api.isValid('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345/view'),true);

console.log('Video embed parser unit test passed.');
