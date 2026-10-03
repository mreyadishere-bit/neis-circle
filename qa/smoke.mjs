import { chromium } from 'playwright';

const baseURL = process.env.NEIS_SMOKE_URL || 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  serviceWorkers: 'block'
});
const page = await context.newPage();

const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.stack || error.message || String(error)));

const response = await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
if (!response || !response.ok()) {
  throw new Error(`Smoke page failed to load: ${response?.status() ?? 'no response'}`);
}

await page.waitForTimeout(3500);

const title = await page.title();
const text = await page.locator('body').innerText();
if (!/NEIS Circle/i.test(title + ' ' + text)) {
  throw new Error('NEIS Circle shell did not render.');
}

const viewCount = await page.locator('#view').count();
if (viewCount !== 1) {
  throw new Error(`Expected exactly one #view root, found ${viewCount}.`);
}

if (pageErrors.length) {
  throw new Error('Uncaught browser errors:\n' + pageErrors.join('\n\n'));
}

console.log('Browser smoke passed:', { title, url: page.url() });
await browser.close();
