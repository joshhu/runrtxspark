// Daily, deterministic refresh of data/index/ from Linaro's catalog and winget.
// Linaro gives breadth, and winget catches new Arm64 releases that Linaro has not listed yet.
// Run with --no-post to refresh the files without writing to the tracking issue,
// and SINCE_DAYS=30 to look further back through winget.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  curatedWithNewArm64, hasOwnArm64Build, mergeIndex, newlyNative, normalizeWoa,
  parseWingetTitle, wingetDir, yamlField,
} from '../shared/software-index.mjs';
import { findOrCreateTracker, gh, sanitize } from './discover-github.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INDEX_DIR = join(ROOT, 'data/index');
const WOA_URL = 'https://raw.githubusercontent.com/Linaro/works-on-woa/staging/src/data/content/projects.json';
const WINGET_RAW = 'https://raw.githubusercontent.com/microsoft/winget-pkgs/master';
const WINGET_TREE = 'https://github.com/microsoft/winget-pkgs/tree/master';
const MAX_ISSUE_LINES = 60;

const readList = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []);
// One entry per line keeps daily commits readable.
const writeList = (file, list) => writeFileSync(file, `[\n${list.map((e) => JSON.stringify(e)).join(',\n')}\n]\n`);

async function fetchText(url) {
  const response = await fetch(url);
  return response.ok ? response.text() : undefined;
}

async function eachLimited(items, limit, work) {
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

/** Refuses a broken download instead of emptying the index. */
export function checkWoaSize(fresh, previousCount) {
  const floor = Math.max(1000, previousCount * 0.8);
  if (fresh.length < floor) throw new Error(`Linaro catalog shrank to ${fresh.length} entries (expected at least ${floor}). Keeping the old copy.`);
}

async function readWingetPackage({ id, version, date }) {
  const dir = wingetDir(id, version);
  const installers = await fetchText(`${WINGET_RAW}/${dir}/${id}.installer.yaml`);
  if (!installers || !hasOwnArm64Build(installers)) return undefined;
  const manifest = await fetchText(`${WINGET_RAW}/${dir}/${id}.yaml`);
  const locale = yamlField(manifest, 'DefaultLocale') ?? 'en-US';
  const details = await fetchText(`${WINGET_RAW}/${dir}/${id}.locale.${locale}.yaml`);
  return {
    id,
    name: yamlField(details, 'PackageName') ?? id.split('.').pop(),
    publisher: yamlField(details, 'Publisher'),
    status: 'native',
    version,
    date,
    url: `${WINGET_TREE}/${dir}`,
  };
}

async function recentWingetUpdates(sinceDays) {
  const since = new Date(Date.now() - sinceDays * 864e5).toISOString();
  const latest = new Map();
  for (let page = 1; page <= sinceDays * 15; page += 1) {
    const commits = await gh(`/repos/microsoft/winget-pkgs/commits?since=${since}&per_page=100&page=${page}`);
    for (const c of commits) {
      const parsed = parseWingetTitle(c.commit.message.split('\n')[0]);
      // Commits arrive newest first, so the first one seen for a package is its latest.
      if (parsed && !latest.has(parsed.id)) latest.set(parsed.id, { ...parsed, date: c.commit.committer.date.slice(0, 10) });
    }
    if (commits.length < 100) break;
  }
  return [...latest.values()];
}

function formatChanges({ fresh, flagged, date }) {
  const parts = [`## Arm64 changes ${date}`];
  if (flagged.length) {
    parts.push('Listed here as not native, but winget now has an Arm64 build. Read the vendor page and update the entry:');
    parts.push(flagged.map(({ app, winget }) => `- [ ] ${sanitize(app.name, 80)} (\`${app.id}\`): ${winget.url}`).join('\n'));
  }
  if (fresh.length) {
    parts.push(`Newly native in the index (${fresh.length}). Promote the widely used ones to catalog entries:`);
    parts.push(fresh.slice(0, MAX_ISSUE_LINES).map((e) => `- [ ] [${sanitize(e.name, 80)}](${e.url}) ${sanitize(e.version, 30)}`).join('\n'));
  }
  parts.push('Names come from other catalogs and are unverified.');
  return parts.join('\n\n');
}

async function main() {
  mkdirSync(INDEX_DIR, { recursive: true });
  const curated = readdirSync(join(ROOT, 'data/apps'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(ROOT, 'data/apps', f), 'utf8')));
  const woaFile = join(INDEX_DIR, 'woa.json');
  const wingetFile = join(INDEX_DIR, 'winget-arm64.json');
  const oldWoa = readList(woaFile);
  const oldWinget = readList(wingetFile);
  const before = mergeIndex({ woa: oldWoa, winget: oldWinget, curated: [] });

  const response = await fetch(WOA_URL);
  if (!response.ok) throw new Error(`Linaro catalog: HTTP ${response.status}`);
  const woa = normalizeWoa(await response.json());
  checkWoaSize(woa, oldWoa.length);

  const updates = await recentWingetUpdates(Number(process.env.SINCE_DAYS ?? 2));
  const found = [];
  await eachLimited(updates, 12, async (update) => {
    const pkg = await readWingetPackage(update);
    if (pkg) found.push(pkg);
  });
  const winget = [...new Map([...oldWinget, ...found].map((w) => [w.id, w])).values()]
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));

  writeList(woaFile, woa);
  writeList(wingetFile, winget);

  const after = mergeIndex({ woa, winget, curated: [] });
  const fresh = oldWoa.length ? newlyNative(before, after) : [];
  const flagged = curatedWithNewArm64(curated, found);
  console.log(`Index: ${woa.length} from Linaro, ${winget.length} Arm64 packages from winget (${found.length} of ${updates.length} recent updates), ${fresh.length} newly native, ${flagged.length} flagged.`);

  if (process.argv.includes('--no-post') || (!fresh.length && !flagged.length)) return;
  const tracker = await findOrCreateTracker(process.env.GITHUB_REPOSITORY);
  await gh(`/repos/${process.env.GITHUB_REPOSITORY}/issues/${tracker.number}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: formatChanges({ fresh, flagged, date: new Date().toISOString().slice(0, 10) }) }),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
