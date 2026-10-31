// Anonymous report flow against a mocked Worker. Build with PUBLIC_REPORT_ENDPOINT=https://worker.test/report,
// run `npx astro preview --port 4321`, then `node tests/e2e/anon.mjs`.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await (await browser.newContext({ locale: 'zh-TW' })).newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
let mode = 429; let sent = null;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
await page.route('https://worker.test/**', (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  sent = req.postDataJSON();
  if (mode === 429) return route.fulfill({ status: 429, headers: cors, contentType: 'application/json', body: '{"error":"rate_limited"}' });
  if (mode === 422) return route.fulfill({ status: 422, headers: cors, contentType: 'application/json', body: '{"errors":["version"]}' });
  return route.fulfill({ status: 201, headers: cors, contentType: 'application/json', body: '{"url":"https://github.com/joshhu/runrtxspark/issues/1","number":1}' });
});
await page.goto('http://localhost:4321/rtxspark/zh-tw/report/?app=blender');
console.log('anon note shown:', (await page.locator('.note').textContent()).includes('不需要帳號'));
console.log('button:', (await page.locator('#submit').textContent()).trim());
await page.locator('.picker-button').click();
await page.locator('[data-value=dell-xps-16]').click();
await page.fill('#version', '5.2');
await page.locator('input[name=status][value=native]').check();
await page.locator('#submit').click();
await page.waitForFunction(() => document.querySelector('#errors') && !document.querySelector('#errors').hidden);
console.log('429 message:', (await page.locator('#errors li').textContent()).trim());
console.log('button restored:', await page.locator('#submit').isEnabled());
mode = 422; await page.locator('#submit').click();
await page.waitForFunction(() => document.querySelector('[data-field="version"]').classList.contains('has-error'));
console.log('422 marks field: true');
mode = 201; await page.locator('#submit').click();
await page.locator('#done').waitFor({ state: 'visible' });
assert.equal(await page.locator('#report-form').isVisible(), false, 'form must hide after success');
console.log('success shown:', (await page.locator('#done h2').textContent()).trim(), '| track:', await page.locator('#track').getAttribute('href'));
console.log('payload:', JSON.stringify(sent));
console.log('page errors:', errors.length);
await browser.close();
