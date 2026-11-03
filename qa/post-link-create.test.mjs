import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const composer=readFileSync('scripts/03-auth-i18n.js','utf8');
const html=readFileSync('index.html','utf8');
const main=composer.slice(composer.indexOf("compose=function(kind='Discussion')"));
assert.ok(main.includes('id="postLinkFields"'), 'localized create form must show link section');
assert.ok(main.includes('id="postLinkLabel"'), 'create form must accept a button label');
assert.ok(main.includes('id="postLinkUrl"'), 'create form must accept HTTPS URL');
assert.ok(main.includes("$('#postLinkFields')?.classList.toggle('hidden',isPoll)"), 'hide link section for polls');
assert.ok(main.includes("link_button_url&&!validPostHttpsUrl(link_button_url)"), 'reject unsafe link');
assert.ok(main.includes("link_button_label,link_button_url,youtube_url}));"), 'persist both link fields');
assert.ok(main.indexOf("link_button_url&&!validPostHttpsUrl(link_button_url)")<main.indexOf("btn.classList.add('button-loading')"), 'validate before upload');
assert.ok(html.includes('scripts/03-auth-i18n.js?v=20261103-post-link-create'), 'cache bust localized composer');
console.log('POST_LINK_CREATE_REGRESSION=PASS');
