// The broad software index: thousands of programs from other catalogs, shown apart from
// the entries this site has read a source for. Used by the daily sync, the site, and tests.

const httpsOnly = (url) => {
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
};

const text = (value, max = 120) => {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : undefined;
};

const dropEmpty = (entry) => Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined && v !== false));

const woaStatus = ({ compatibility, emulationType }) => {
  if (compatibility === 'no') return 'broken';
  if (compatibility !== 'yes') return undefined;
  return { native: 'native', emulation: 'prism' }[emulationType];
};

export const WOA_REPO = 'https://github.com/Linaro/works-on-woa';

// Link to Linaro's own page for the program, because that is what states the result.
const woaPage = ({ slug, type }) =>
  /^[\w-]+$/.test(slug ?? '') ? `https://worksonwoa.com/en/${type === 'game' ? 'games' : 'applications'}/${slug}/` : WOA_REPO;

/** Converts Linaro's projects.json. Entries with no clear result are left out. */
export function normalizeWoa(projects) {
  const out = [];
  for (const p of projects) {
    const status = woaStatus(p);
    const name = text(p.name);
    if (!status || !name) continue;
    out.push(dropEmpty({
      name,
      publisher: text(p.publisher),
      status,
      version: text(p.versionFrom, 40),
      checked: /^\d{4}-\d{2}-\d{2}/.test(p.lastUpdated ?? '') ? p.lastUpdated.slice(0, 10) : undefined,
      url: woaPage(p),
      nvidia: (p.validation ?? []).includes('nvidia'),
      game: p.type === 'game',
    }));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** Reads "New version: Tailscale.Tailscale version 1.104.4 (#123)" and its variants. */
export function parseWingetTitle(title) {
  const m = String(title).match(/^(?:New version|New package|Update): ([A-Za-z0-9][\w.+-]*\.[\w.+-]+) (?:version |to )(\S+)/);
  return m ? { id: m[1], version: m[2] } : undefined;
}

export const wingetDir = (id, version) =>
  `manifests/${id[0].toLowerCase()}/${id.replaceAll('.', '/')}/${version}`;

/**
 * True when a winget manifest ships a build only for Arm64. A file listed for both Arm64
 * and x64 could be a plain x64 installer, so it does not count on its own.
 */
export function hasOwnArm64Build(yaml) {
  const urls = { arm64: new Set(), x64: new Set() };
  let arch;
  for (const line of String(yaml).split(/\r?\n/)) {
    const a = line.match(/^\s*-?\s*Architecture:\s*["']?(\w+)/);
    if (a) arch = a[1].toLowerCase();
    const u = line.match(/^\s*-?\s*InstallerUrl:\s*["']?([^"'\s]+)/);
    if (u && urls[arch]) urls[arch].add(u[1]);
  }
  return [...urls.arm64].some((url) => !urls.x64.has(url));
}

export const yamlField = (yaml, field) => {
  const m = String(yaml).match(new RegExp(`^${field}:\\s*(.+?)\\s*$`, 'm'));
  return m ? m[1].replace(/^["']|["']$/g, '') : undefined;
};

export const sameProgram = (name) => String(name).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

const curatedNames = (curated) =>
  new Set(curated.flatMap((app) => [app.name, ...(app.aliases ?? [])]).map(sameProgram));

/**
 * Combines the catalogs. A winget Arm64 build overrides an older emulated result, because
 * a native build is what "native" means here and Linaro can lag behind a release.
 * Programs this site already covers are left out so that they appear only once.
 */
export function mergeIndex({ woa, winget, curated }) {
  const byName = new Map(woa.map((entry) => [sameProgram(entry.name), entry]));
  for (const w of winget) {
    const key = sameProgram(w.name);
    const known = byName.get(key);
    if (known?.status === 'native') continue;
    byName.set(key, dropEmpty({
      name: known?.name ?? w.name,
      publisher: known?.publisher ?? w.publisher,
      status: 'native',
      version: w.version,
      checked: w.date,
      url: w.url,
      game: known?.game,
    }));
  }
  const skip = curatedNames(curated);
  return [...byName.entries()]
    .filter(([key]) => !skip.has(key))
    .map(([, entry]) => entry)
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** Entries this site still lists as not native although winget now has an Arm64 build. */
export function curatedWithNewArm64(curated, winget) {
  const arm64 = new Map(winget.map((w) => [sameProgram(w.name), w]));
  return curated
    .filter((app) => app.status !== 'native' && arm64.has(sameProgram(app.name)))
    .map((app) => ({ app, winget: arm64.get(sameProgram(app.name)) }));
}

/** Native entries that were not native in the previous index. */
export function newlyNative(before, after) {
  const was = new Set(before.filter((e) => e.status === 'native').map((e) => sameProgram(e.name)));
  return after.filter((e) => e.status === 'native' && !was.has(sameProgram(e.name)));
}

const STATUSES = ['native', 'prism', 'broken'];

export function validateIndexEntry(entry) {
  const errors = [];
  if (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 120) errors.push('name');
  if (!STATUSES.includes(entry.status)) errors.push('status');
  if (!httpsOnly(entry.url)) errors.push('url');
  return errors;
}
