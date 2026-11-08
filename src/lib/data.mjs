import { LOCALE_META } from './locale.mjs';
import machinesFile from '../../data/machines.json';
import woaIndex from '../../data/index/woa.json';
import wingetIndex from '../../data/index/winget-arm64.json';
import { mergeIndex } from '../../shared/software-index.mjs';

const appModules = import.meta.glob('../../data/apps/*.json', { eager: true, import: 'default' });
const reportModules = import.meta.glob('../../data/reports/*.json', { eager: true, import: 'default' });

export const REPO_URL = 'https://github.com/joshhu/runrtxspark';
export const machines = machinesFile.machines;
export const machineById = Object.fromEntries(machines.map((m) => [m.id, m]));

export const reports = Object.values(reportModules).sort((a, b) =>
  b.reportedAt.localeCompare(a.reportedAt),
);

const reportsByApp = Object.groupBy(reports, (r) => r.appId);

export const apps = Object.values(appModules)
  .map((app) => {
    const own = reportsByApp[app.id] ?? [];
    const disagreeing = own.filter((r) => r.status !== app.status).length;
    return {
      ...app,
      reports: own,
      // One odd report is noise. Flag it when disagreement is at least half and has two voices.
      hasConflict: disagreeing >= 2 && disagreeing * 2 >= own.length,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name, 'en'));

export const appById = Object.fromEntries(apps.map((a) => [a.id, a]));

export const softwareIndex = mergeIndex({ woa: woaIndex, winget: wingetIndex, curated: apps });

// NVIDIA tested these for Linaro's catalog, so they ship with the page.
// The rest of the index is listed too, but loads after the page does.
export const nvidiaApps = softwareIndex.filter((e) => e.nvidia);
export const otherIndex = softwareIndex.filter((e) => !e.nvidia);

export const lastUpdated = [
  ...apps.flatMap((a) => [a.addedAt, a.verifiedAt]),
  ...reports.map((r) => r.approvedAt),
]
  .filter(Boolean)
  .sort()
  .at(-1);

// The programs added in the most recent update, shown first on the home page.
const latestDate = apps.map((a) => a.addedAt).filter(Boolean).sort().at(-1);
export const latestAdded = {
  date: latestDate,
  apps: apps.filter((a) => a.addedAt === latestDate),
};

const listed = [...apps, ...softwareIndex];
export const listedCount = listed.length;

export const statusCounts = {
  native: listed.filter((a) => a.status === 'native').length,
  prism: listed.filter((a) => a.status === 'prism').length,
  broken: listed.filter((a) => a.status === 'broken').length,
};

const CATEGORY_ORDER = ['productivity', 'adobe', 'creative', 'browser', 'developer', 'ai', 'communication', 'utility', 'game'];
export const usedCategories = CATEGORY_ORDER.filter((c) => listed.some((a) => a.category === c));

/** Picks the localized string, falling back to English. Data text exists in en and zh-TW. */
export function localized(text, locale) {
  if (!text) return '';
  if (typeof text === 'string') return text;
  return text[LOCALE_META[locale].content] ?? text.en ?? '';
}

export function formatDate(iso, locale) {
  if (!iso) return '';
  return new Intl.DateTimeFormat(LOCALE_META[locale].lang, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

export function machineLabel(machine) {
  return `${machine.brand} ${machine.name}`;
}
