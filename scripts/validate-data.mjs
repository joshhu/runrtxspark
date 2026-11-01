// Gatekeeper for everything under data/. The daily job and CI both run it, and a
// failure blocks deployment, so a bad automated edit cannot reach the live site.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPERIENCES, GPU_RESULTS, STATUSES, OTHER_MACHINE } from '../shared/report.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const CATEGORIES = ['productivity', 'adobe', 'creative', 'browser', 'developer', 'ai', 'utility', 'game', 'communication'];
const SCOPES = ['rtx-spark', 'windows-on-arm'];
const MATURITIES = ['stable', 'beta', 'preview', 'community'];
const CONFIDENCE = ['high', 'medium', 'low'];
const EVIDENCE_TYPES = ['vendor', 'release', 'review', 'community', 'aggregator'];
const AVAILABILITY = ['on-sale', 'preorder', 'announced'];
const FORM_FACTORS = ['laptop', 'convertible', 'desktop'];

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isSlug = (v) => typeof v === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v);
const isText = (v, max = 200) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isHttps = (v) => {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};
const isLocalized = (v, max) => v && typeof v === 'object' && isText(v.en, max) && (v['zh-TW'] === undefined || isText(v['zh-TW'], max));

export function validateMachine(m, today) {
  const e = [];
  if (!isSlug(m.id)) e.push('id must be a slug');
  if (m.id === OTHER_MACHINE) e.push('id "other" is reserved');
  if (!isText(m.brand, 40)) e.push('brand');
  if (!isText(m.name, 80)) e.push('name');
  if (!AVAILABILITY.includes(m.availability)) e.push('availability');
  if (!FORM_FACTORS.includes(m.form)) e.push('form');
  if (m.url !== undefined && !isHttps(m.url)) e.push('url must be https');
  if (m.image !== undefined && !/^[a-z0-9-]+\.webp$/.test(m.image)) e.push('image must be a local .webp');
  if (m.image && !m.imageSource) e.push('image needs imageSource');
  if (m.imageSource !== undefined && !isHttps(m.imageSource)) e.push('imageSource must be https');
  if (m.memory !== undefined && !(Array.isArray(m.memory) && m.memory.every((x) => isText(x, 16)))) e.push('memory');
  if (m.priceUsd !== undefined && !(Number.isInteger(m.priceUsd) && m.priceUsd > 0)) e.push('priceUsd');
  if (!isDate(m.verifiedAt) || m.verifiedAt > today) e.push('verifiedAt');
  if (!isHttps(m.source)) e.push('source must be https');
  return e;
}

export function validateApp(a, today) {
  const e = [];
  if (!isSlug(a.id)) e.push('id must be a slug');
  if (!isText(a.name, 80)) e.push('name');
  if (!isText(a.vendor, 80)) e.push('vendor');
  if (!CATEGORIES.includes(a.category)) e.push(`category "${a.category}"`);
  if (!STATUSES.includes(a.status)) e.push(`status "${a.status}"`);
  if (!SCOPES.includes(a.scope)) e.push('scope');
  if (!MATURITIES.includes(a.maturity)) e.push('maturity');
  if (!CONFIDENCE.includes(a.confidence)) e.push('confidence');
  if (a.version !== undefined && !isText(a.version, 60)) e.push('version');
  if (a.homepage !== undefined && !isHttps(a.homepage)) e.push('homepage must be https');
  if (a.aliases !== undefined && !(Array.isArray(a.aliases) && a.aliases.every((x) => isText(x, 60)))) e.push('aliases');
  if (a.summary !== undefined && !isLocalized(a.summary, 500)) e.push('summary needs en, at most 500 chars');
  if (a.caveats !== undefined && !(Array.isArray(a.caveats) && a.caveats.every((c) => isLocalized(c, 400)))) e.push('caveats');
  if (!isDate(a.addedAt) || a.addedAt > today) e.push('addedAt');
  if (!isDate(a.verifiedAt) || a.verifiedAt > today) e.push('verifiedAt');

  // The core promise of the site: no published result without a checkable source.
  if (!Array.isArray(a.evidence) || a.evidence.length === 0) {
    e.push('evidence must have at least one source');
  } else {
    a.evidence.forEach((src, i) => {
      if (!isHttps(src.url)) e.push(`evidence[${i}].url must be https`);
      if (!isText(src.title, 160)) e.push(`evidence[${i}].title`);
      if (!EVIDENCE_TYPES.includes(src.type)) e.push(`evidence[${i}].type`);
      if (!isDate(src.checked) || src.checked > today) e.push(`evidence[${i}].checked`);
    });
  }
  // A catalog entry alone cannot claim something was confirmed on RTX Spark.
  if (a.scope === 'rtx-spark' && Array.isArray(a.evidence) && a.evidence.every((s) => s.type === 'aggregator')) {
    e.push('rtx-spark scope needs a source better than an aggregator');
  }
  if (a.status === 'broken' && a.confidence === 'high' && a.scope !== 'rtx-spark') {
    e.push('a high-confidence failure must be confirmed on RTX Spark');
  }
  return e;
}

export function validateStoredReport(r, { machineIds, appIds, today }) {
  const e = [];
  if (!appIds.has(r.appId)) e.push(`unknown appId "${r.appId}"`);
  if (!STATUSES.includes(r.status)) e.push('status');
  if (r.machine !== OTHER_MACHINE && !machineIds.has(r.machine)) e.push(`unknown machine "${r.machine}"`);
  if (r.machine === OTHER_MACHINE && !isText(r.machineName, 80)) e.push('machineName');
  if (!isText(r.version, 40)) e.push('version');
  if (r.experience !== undefined && !EXPERIENCES.includes(r.experience)) e.push('experience');
  if (r.gpu !== undefined && !GPU_RESULTS.includes(r.gpu)) e.push('gpu');
  if (r.notes !== undefined && !isText(r.notes, 1000)) e.push('notes');
  if (r.evidenceUrl !== undefined && !isHttps(r.evidenceUrl)) e.push('evidenceUrl');
  if (!isDate(r.reportedAt) || r.reportedAt > today) e.push('reportedAt');
  if (!isDate(r.approvedAt) || r.approvedAt > today) e.push('approvedAt');
  if (!Number.isInteger(r.issue)) e.push('issue');
  return e;
}

const readJsonDir = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: join(dir, f), name: f.replace(/\.json$/, ''), data: JSON.parse(readFileSync(join(dir, f), 'utf8')) }));

// Catalog dates are Taiwan calendar dates. The daily run starts at 07:05 in Taiwan, when
// UTC is still on the previous day, so a UTC check would reject its dates as future ones.
export const taipeiToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(now);

export function validateAll(root = ROOT, today = taipeiToday()) {
  const problems = [];
  const report = (where, list) => list.forEach((msg) => problems.push(`${where}: ${msg}`));

  const { machines } = JSON.parse(readFileSync(join(root, 'data/machines.json'), 'utf8'));
  const machineIds = new Set();
  for (const m of machines) {
    report(`machine ${m.id}`, validateMachine(m, today));
    if (machineIds.has(m.id)) problems.push(`machine ${m.id}: duplicate id`);
    machineIds.add(m.id);
    if (m.image && !existsSync(join(root, 'public/machines', m.image))) {
      problems.push(`machine ${m.id}: missing public/machines/${m.image}`);
    }
  }

  const appIds = new Set();
  const names = new Map();
  for (const { name, data } of readJsonDir(join(root, 'data/apps'))) {
    report(`app ${name}`, validateApp(data, today));
    if (data.id !== name) problems.push(`app ${name}: id must match file name`);
    appIds.add(data.id);
    const key = String(data.name).toLowerCase();
    if (names.has(key)) problems.push(`app ${name}: same name as ${names.get(key)}`);
    names.set(key, name);
  }

  for (const { name, data } of readJsonDir(join(root, 'data/reports'))) {
    report(`report ${name}`, validateStoredReport(data, { machineIds, appIds, today }));
  }

  return { problems, counts: { machines: machines.length, apps: appIds.size } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { problems, counts } = validateAll();
  if (problems.length) {
    console.error(`Data validation failed with ${problems.length} problem(s):`);
    problems.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
  }
  console.log(`Data OK: ${counts.apps} apps, ${counts.machines} machines.`);
}
