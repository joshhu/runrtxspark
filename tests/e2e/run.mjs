// Browser tests against a built site. Run `npx astro preview --port 4321` first, then `npm run test:e2e`.
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

mkdirSync('tmpcode', { recursive: true });

const BASE = 'http://localhost:4321/rtxspark/';
const OWN = readdirSync('data/apps').filter((f) => f.endsWith('.json')).length;
const ownNames = new Set(readdirSync('data/apps').filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(`data/apps/${f}`, 'utf8')).name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')));
const NV = JSON.parse(readFileSync('data/index/woa.json', 'utf8'))
  .filter((e) => e.nvidia && !ownNames.has(e.name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))).length;
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

// The language menu sits in the page header and floats over the content.
for (const width of [360, 1280]) {
  const ctx = await browser.newContext({ locale: 'zh-TW', viewport: { width, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}zh-tw/`);
  const menu = page.locator('details.lang');
  check(`${width}px: one language menu, in the header`, (await menu.count()) === 1 && (await page.locator('.site-header details.lang').count()) === 1);
  const headerBefore = await page.locator('.site-header').boundingBox();
  await menu.locator('summary').click();
  const list = await menu.locator('ul').boundingBox();
  const headerOpen = await page.locator('.site-header').boundingBox();
  check(`${width}px: opening the menu does not move the page`, headerOpen.height === headerBefore.height);
  check(`${width}px: the open menu fits the screen`, list.x >= 0 && list.x + list.width <= width, `${list.x}..${list.x + list.width}`);
  await page.keyboard.press('Escape');
  check(`${width}px: Escape closes the menu`, !(await menu.evaluate((d) => d.open)));
  await menu.locator('summary').click();
  await page.locator('main').click({ position: { x: 5, y: 5 } });
  check(`${width}px: clicking elsewhere closes the menu`, !(await menu.evaluate((d) => d.open)));
  await menu.locator('summary').click();
  await page.waitForTimeout(100);
  await page.screenshot({ path: `tmpcode/shot-lang-${width}.png` });
  await ctx.close();
}

// The site name and the report button stay on one line in every language, down to phone width.
for (const width of [360, 479, 480, 859, 860]) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await ctx.newPage();
  for (const locale of ['en', 'zh-tw', 'zh-cn', 'ja', 'ko']) {
    await page.goto(`${BASE}${locale}/`);
    const name = await page.locator('.wordmark').boundingBox();
    const button = await page.locator('.report-link').boundingBox();
    const language = await page.locator('details.lang summary').boundingBox();
    const sameLine = button.y < name.y + name.height && name.y < button.y + button.height;
    const onScreen = language.x + language.width <= width && button.x + button.width <= width;
    if (!sameLine || !onScreen) check(`header at ${width}px /${locale}/`, false, `sameLine=${sameLine} onScreen=${onScreen}`);
  }
  await ctx.close();
}
check('header layout pass finished', true);

const ctx = await browser.newContext({ locale: 'zh-TW', viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

// Search and filters.
await page.goto(`${BASE}zh-tw/`);
const visible = () => page.locator('#list .row:visible').count();
const nvRows = () => page.locator('#nv-rows .row:visible').count();
const ownVisible = () => page.locator('#list .row[data-id]:visible').count();
const countText = async () => Number((await page.locator('#count').textContent()).replace(/\D/g, ''));
check('first page shows 50 programs', (await visible()) === 50, `${await visible()}`);
check('first page starts with this site\'s entries', (await nvRows()) === 0);
const listed = await countText();
check('count covers this site\'s and NVIDIA\'s entries', listed > OWN + NV * 0.9 && listed <= OWN + NV, `${listed}, own ${OWN}, NVIDIA ${NV}`);
const lastPage = Math.ceil(listed / 50);
check('pager offers the last page', (await page.locator(`#pager-nums [data-page="${lastPage}"]`).count()) === 1);
await page.locator('#pager-next').click();
check('next page moves on', page.url().includes('page=2') && (await page.locator('#pager-nums [aria-current="page"]').textContent()) === '2');
check('page two mixes the rest of this site\'s entries with NVIDIA\'s', (await visible()) === 50 && (await nvRows()) === 100 - OWN, `${await nvRows()}`);
await page.locator(`#pager-nums [data-page="${lastPage}"]`).click();
check('last page holds the remainder', (await visible()) === listed - (lastPage - 1) * 50, `${await visible()}`);
check('previous is enabled on the last page and next is not', !(await page.locator('#pager-prev').isDisabled()) && (await page.locator('#pager-next').isDisabled()));
await page.reload();
check('the page number survives a reload', (await page.locator('#pager-nums [aria-current="page"]').textContent()) === String(lastPage));
await page.fill('#q', '1password');
check('a new search goes back to page one', !page.url().includes('page='));
check('search finds an NVIDIA-verified program', (await nvRows()) === 1, `${await nvRows()}`);
check('pager hides when one page is enough', !(await page.locator('#pager').isVisible()));
check('NVIDIA rows link to Works on WoA', (await page.locator('#nv-rows .row-link').getAttribute('href')).startsWith('https://worksonwoa.com/'));
check('NVIDIA rows carry their tag', (await page.locator('#nv-rows .row .tag').count()) === 1);
await page.fill('#q', '');
await page.locator('.cats .cat[data-cat="browser"]').click();
const nvCats = await page.locator('#nv-rows .row').evaluateAll((a) => [...new Set(a.map((x) => x.dataset.cat))]);
check('category filter applies to NVIDIA rows', nvCats.length === 1 && nvCats[0] === 'browser', nvCats.join());
await page.locator('.cats .cat[data-cat=""]').click();
await page.locator('input[name="status"][value="broken"]').check();
const shownStatus = await page.locator('#list .row:visible').evaluateAll((a) => [...new Set(a.map((x) => x.dataset.status))]);
check('status filter applies to every row', shownStatus.length === 1 && shownStatus[0] === 'broken', shownStatus.join());
await page.locator('input[name="status"][value="broken"]').uncheck();
await page.fill('#q', 'vllm');
check('search finds both vLLM builds', (await visible()) === 2, `${await visible()}`);
check('search syncs to the URL', page.url().includes('q=vllm'));
check('wafer highlights matches', (await page.locator('[data-wafer-die].is-match').count()) === 2);
await page.fill('#q', 'office');
check('alias search finds Office apps', (await ownVisible()) === 6, `${await ownVisible()}`);
await page.fill('#q', 'notarealprogram');
await page.locator('#empty').waitFor();
check('empty state appears', await page.locator('#empty').isVisible());
check('empty state links to report', (await page.locator('#empty-action').getAttribute('href')).includes('software=notarealprogram'));
// The broad index loads only when needed, and shows programs the catalog does not list.
{
  const c = await browser.newContext({ locale: 'zh-TW' });
  const pg = await c.newPage();
  const asked = [];
  pg.on('request', (r) => { if (r.url().includes('software-index')) asked.push(r.url()); });
  await pg.goto(`${BASE}zh-tw/`, { waitUntil: 'networkidle' });
  check('index is not downloaded on page load', asked.length === 0);
  await pg.fill('#q', 'tailscale');
  check('Tailscale is a catalog entry', (await pg.locator('#list .row:visible').count()) === 1);
  await pg.locator('#more-title').filter({ hasText: /\d/ }).waitFor();
  const dupes = await pg.locator('#more-rows .row-link').evaluateAll((a) => a.filter((x) => x.textContent.trim().toLowerCase() === 'tailscale').length);
  check('a catalog entry is not repeated from the index', dupes === 0, String(dupes));
  await pg.fill('#q', '1password');
  await pg.locator('#more-title').filter({ hasText: /\d/ }).waitFor();
  const nvDupes = await pg.locator('#more-rows .row-link').evaluateAll((a) => a.filter((x) => x.textContent.trim().toLowerCase() === '1password').length);
  check('an NVIDIA-verified program is not repeated from the index', nvDupes === 0, String(nvDupes));
  await pg.fill('#q', 'winscp');
  await pg.locator('#more-rows .row-link').first().waitFor();
  check('search finds a program only in the index', (await pg.locator('#more-rows .row-link').first().textContent()).toLowerCase().includes('winscp'));
  check('index rows link to https sources', (await pg.locator('#more-rows .row-link').first().getAttribute('href')).startsWith('https://'));
  check('index rows show one result', (await pg.locator('#more-rows .row').first().locator('.result > .status').count()) === 1);
  check('catalog empty state stays hidden when the index has results', !(await pg.locator('#empty').isVisible()));
  await pg.fill('#q', '');
  await pg.locator('#more-browse').click();
  await pg.locator('#more-rows .row').first().waitFor();
  check('browse shows one page of the index', (await pg.locator('#more-rows .row').count()) === 50, String(await pg.locator('#more-rows .row').count()));
  check('browsing leaves the category filter alone', (await pg.locator('.cats .cat[aria-pressed=true]').getAttribute('data-cat')) === '');
  await pg.locator('#more-next').click();
  check('show more adds rows', (await pg.locator('#more-rows .row').count()) === 150, String(await pg.locator('#more-rows .row').count()));
  await pg.locator('input[name=status][value=broken]').check();
  const statuses = await pg.locator('#more-rows .result > .status').evaluateAll((a) => [...new Set(a.map((x) => x.dataset.status))]);
  check('status filter applies to the index', statuses.length === 1 && statuses[0] === 'broken', statuses.join());
  await pg.locator('input[name=status][value=broken]').uncheck();
  await pg.fill('#q', 'wire');
  await pg.locator('#more-rows .row').first().waitFor();
  await pg.setViewportSize({ width: 1280, height: 900 });
  await pg.locator('#more').scrollIntoViewIfNeeded();
  await pg.screenshot({ path: 'tmpcode/shot-index-desktop.png' });
  await pg.setViewportSize({ width: 360, height: 800 });
  await pg.locator('#more').scrollIntoViewIfNeeded();
  await pg.screenshot({ path: 'tmpcode/shot-index-phone.png' });
  check('index rows do not scroll sideways on a phone', await pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await c.close();
}
await page.fill('#q', '');
await page.locator('input[name=status][value=broken]').check();
check('status filter works', (await ownVisible()) === 4, `${await ownVisible()}`);
await page.locator('input[name=status][value=broken]').uncheck();
await page.locator('.cat[data-cat=adobe]').click();
check('category filter works', (await ownVisible()) === 8, `${await ownVisible()}`);
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
check('every program has a die', (await page.locator('[data-wafer-die]').count()) === OWN);
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
