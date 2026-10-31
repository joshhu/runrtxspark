// Browser tests against a built site. Run `npx astro preview --port 4321` first, then `npm run test:e2e`.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

mkdirSync('tmpcode', { recursive: true });

const BASE = 'http://localhost:4321/rtxspark/';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`); };
const browser = await chromium.launch();

// Browser language decides the first page.
for (const [locale, want] of [['zh-TW', 'zh-tw'], ['zh-HK', 'zh-tw'], ['zh-CN', 'zh-cn'], ['ja-JP', 'ja'], ['ko-KR', 'ko'], ['en-US', 'en'], ['fr-FR', 'en']]) {
  const ctx = await browser.newContext({ locale });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForURL(`**/rtxspark/${want}/`);
  check(`language ${locale} goes to /${want}/`, page.url().endsWith(`/rtxspark/${want}/`));
  await ctx.close();
}

// A manual choice beats the browser language.
{
  const ctx = await browser.newContext({ locale: 'zh-TW' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}zh-tw/`);
  await page.locator('details.lang summary').click();
  await page.locator('a[data-set-locale="ja"]').click();
  await page.waitForURL('**/ja/');
  await page.goto(BASE);
  await page.waitForURL('**/rtxspark/ja/');
  check('manual language choice is remembered', page.url().endsWith('/ja/'));
  await ctx.close();
}

const ctx = await browser.newContext({ locale: 'zh-TW', viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

// Search and filters.
await page.goto(`${BASE}zh-tw/`);
const visible = () => page.locator('.row:visible').count();
const total = await visible();
check('catalog lists all programs', total === 76, `${total}`);
await page.fill('#q', 'vllm');
check('search finds both vLLM builds', (await visible()) === 2, `${await visible()}`);
check('search syncs to the URL', page.url().includes('q=vllm'));
check('wafer highlights matches', (await page.locator('[data-wafer-die].is-match').count()) === 2);
await page.fill('#q', 'office');
check('alias search finds Office apps', (await visible()) === 6, `${await visible()}`);
await page.fill('#q', 'notarealprogram');
check('empty state appears', await page.locator('#empty').isVisible());
check('empty state links to report', (await page.locator('#empty-action').getAttribute('href')).includes('software=notarealprogram'));
await page.fill('#q', '');
await page.locator('input[name=status][value=broken]').check();
check('status filter works', (await visible()) === 4, `${await visible()}`);
await page.locator('input[name=status][value=broken]').uncheck();
await page.locator('.cat[data-cat=adobe]').click();
check('category filter works', (await visible()) === 8, `${await visible()}`);
await page.locator('.cat[data-cat=""]').click();
await page.goto(`${BASE}zh-tw/?q=vllm&status=native`);
check('filters restore from a URL', (await visible()) === 2 && (await page.inputValue('#q')) === 'vllm');

// Phone: results must come right after the search box while searching.
{
  const c = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const s = await c.newPage();
  await s.goto(`${BASE}en/`);
  await s.fill('#q', 'blender');
  const top = await s.locator('.row:visible').first().evaluate((el) => el.getBoundingClientRect().top);
  check('phone search shows results on the first screen', top < 780, `${Math.round(top)}px`);
  await c.close();
}

// Wafer.
await page.goto(`${BASE}zh-tw/`);
check('every program has a die', (await page.locator('[data-wafer-die]').count()) === 76);
await page.locator('[data-wafer-die="adobe-photoshop"]').focus();
await page.keyboard.press('Enter');
await page.waitForURL('**/apps/adobe-photoshop/');
check('die opens the program page', true);

// Detail pages.
await page.goto(`${BASE}zh-tw/apps/vllm-devjeonghwan/`);
check('community build is labeled', (await page.locator('.tags .tag').first().textContent()).includes('社群版'));
await page.goto(`${BASE}zh-tw/apps/adobe-illustrator/`);
check('general source is labeled honestly', (await page.locator('.tags').textContent()).includes('尚未在 RTX Spark 確認'));
check('caveats show Traditional Chinese', (await page.locator('.caveats').textContent()).includes('社群專家'));
check('versions read the same in every language', (await page.locator('.facts').textContent()).includes('28.7 beta+'));

// Report form.
await page.goto(`${BASE}zh-tw/report/`);
await page.locator('#submit').click();
check('empty submit shows errors', await page.locator('#errors').isVisible());
check('errors name the fields', (await page.locator('#errors li').count()) === 4, `${await page.locator('#errors li').count()}`);
await page.locator('.picker-button').click();
const optionCount = await page.locator('[role=option]').count();
check('picker lists on-sale machines plus other', optionCount === 9, `${optionCount}`);
const loaded = await page.$$eval('.picker-list img', (imgs) => Promise.all(imgs.map((i) => i.decode().then(() => i.naturalWidth > 0).catch(() => false))));
check('every machine option has a photo', loaded.length === 8 && loaded.every(Boolean), `${loaded.filter(Boolean).length}/${loaded.length}`);
await page.screenshot({ path: 'tmpcode/shot-picker.png' });
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
check('keyboard selects a machine', (await page.inputValue('input[name=machine]')) === 'asus-proart-p16');
check('photo appears after choosing', await page.locator('#picker-thumb img').isVisible());
check('memory options follow the machine', (await page.locator('#memory option').count()) === 5);
await page.locator('.picker-button').click();
await page.locator('#machine-other').click();
check('other machine asks for a name', await page.locator('#machineName').isVisible());
await page.locator('.picker-button').click();
await page.locator('[data-value=asus-proart-p16]').click();
check('choosing a listed machine hides the name', !(await page.locator('#machineName').isVisible()));
await page.fill('#software', 'vLLM for RTX Spark (devjeonghwan)');
await page.fill('#version', '0.1.2');
await page.locator('input[name=status][value=native]').check();
await page.fill('#notes', 'Runs ```bad');
await page.locator('#submit').click();
check('fence characters are rejected', (await page.locator('#errors').textContent()).includes('備註'));
await page.fill('#notes', 'Works with the 128GB profile.');

let navigated = null;
await page.route('https://github.com/**', (route) => { navigated = route.request().url(); route.fulfill({ status: 200, body: 'ok' }); });
await page.locator('#submit').click();
await page.waitForURL('https://github.com/**');
const issue = new URL(navigated);
const body = issue.searchParams.get('body');
const json = JSON.parse(body.match(/```json\n([\s\S]*?)\n```/)[1]);
check('falls back to a pre-filled issue on the right repo', issue.pathname === '/joshhu/runrtxspark/issues/new');
check('issue carries the report and matched app', json.appId === 'vllm-devjeonghwan' && json.machine === 'asus-proart-p16' && json.version === '0.1.2', JSON.stringify(json));
check('issue has the intake marker', body.includes('<!-- rtxspark-report:v1 -->'));

await page.goto(`${BASE}zh-tw/report/?app=blender`);
check('report link pre-fills the program', (await page.inputValue('#software')) === 'Blender');

await page.goto(`${BASE}zh-tw/machines/`);
check('machines page shows all machines', (await page.locator('.grid > li').count()) === 11);
const broken = await page.$$eval('.grid img', (imgs) => Promise.all(imgs.map((i) => { i.loading = 'eager'; return i.decode().then(() => i.naturalWidth > 0).catch(() => false); })));
check('machine photos all load', broken.every(Boolean) && broken.length === 10, `${broken.filter(Boolean).length}/${broken.length}`);

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

// Layout on every page type, every language, at phone width.
const phone = await browser.newContext({ viewport: { width: 360, height: 800 } });
const p = await phone.newPage();
for (const locale of ['en', 'zh-tw', 'zh-cn', 'ja', 'ko']) {
  for (const path of ['', 'machines/', 'report/', 'updates/', 'about/', 'apps/vllm-systempanic/', 'apps/adobe-premiere-pro/']) {
    await p.goto(`${BASE}${locale}/${path}`);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 0) check(`no sideways scroll /${locale}/${path}`, false, `${over}px`);
  }
}
check('phone layout pass finished', true);

// Screenshots for review.
const shots = [
  ['zh-tw', '', 'home-light', 1280, 'light'], ['zh-tw', '', 'home-dark', 1280, 'dark'], ['en', '', 'home-phone', 390, 'light'],
  ['zh-tw', 'apps/adobe-premiere-pro/', 'app', 1280, 'light'], ['zh-tw', 'machines/', 'machines', 1280, 'light'], ['zh-tw', 'report/', 'report', 1280, 'dark'],
];
for (const [locale, path, name, width, colorScheme] of shots) {
  const c = await browser.newContext({ viewport: { width, height: 900 }, colorScheme });
  const s = await c.newPage();
  await s.goto(`${BASE}${locale}/${path}`, { waitUntil: 'networkidle' });
  await s.waitForTimeout(1100);
  await s.screenshot({ path: `tmpcode/shot-${name}.png`, fullPage: name !== 'home-light' && name !== 'home-dark' && name !== 'home-phone' });
  await c.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
