// Checks every source and homepage link in the catalog. Vendors often refuse bots,
// so only a clear "gone" (404, 410) or a connection failure counts as broken.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = join(ROOT, 'data/apps');

const urls = new Map();
const add = (url, owner) => urls.set(url, [...(urls.get(url) ?? []), owner]);
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const app = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  if (app.homepage) add(app.homepage, app.id);
  for (const { url } of app.evidence) add(url, app.id);
}
const { machines } = JSON.parse(readFileSync(join(ROOT, 'data/machines.json'), 'utf8'));
for (const m of machines) {
  if (m.url) add(m.url, m.id);
  add(m.source, m.id);
}

const GONE = new Set([404, 410]);
const queue = [...urls.keys()];
const broken = [];
const blocked = [];

async function check(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36' },
    });
    await response.body?.cancel();
    if (GONE.has(response.status)) broken.push({ url, why: response.status });
    else if (!response.ok) blocked.push({ url, why: response.status });
  } catch (error) {
    broken.push({ url, why: error.cause?.code ?? error.name });
  }
}

await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (queue.length) await check(queue.shift());
  }),
);

console.log(`Checked ${urls.size} links.`);
for (const { url, why } of blocked) console.log(`refused (${why}): ${url}`);
for (const { url, why } of broken) console.error(`BROKEN (${why}): ${url} [${urls.get(url).join(', ')}]`);
process.exit(broken.length ? 1 : 0);
