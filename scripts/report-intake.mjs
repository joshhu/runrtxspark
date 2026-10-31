// Runs on GitHub Actions for issues. Everything in the issue is untrusted, so it is
// read from the event file and handled as data, never placed into a shell command.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIssueBody, validateReport, REPORT_MARKER } from '../shared/report.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const loadMachineIds = () =>
  JSON.parse(readFileSync(join(ROOT, 'data/machines.json'), 'utf8')).machines.map((m) => m.id);

/** Decides what a newly opened or edited issue is. Pure, so tests can cover it. */
export function triage(issue, { machineIds }) {
  if (typeof issue.body !== 'string' || !issue.body.includes(REPORT_MARKER)) {
    return { kind: 'ignore' };
  }
  const payload = parseIssueBody(issue.body);
  const result = validateReport(payload, { machineIds });
  if (!result.ok) return { kind: 'invalid', errors: result.errors };
  return { kind: 'valid', report: result.report };
}

/** Builds the stored report for an approved issue. Throws when it cannot be stored. */
export function buildStoredReport(issue, { machineIds, appIds, today, appIdOverride }) {
  const decision = triage(issue, { machineIds });
  if (decision.kind !== 'valid') {
    throw new Error(`Issue #${issue.number} is not a valid report`);
  }
  const { report } = decision;
  const appId = appIdOverride || report.appId;
  if (!appId || !appIds.includes(appId)) {
    throw new Error(`Issue #${issue.number} has no catalog entry. Add the app first, or set an app:<id> label.`);
  }
  return {
    ...report,
    appId,
    issue: issue.number,
    reportedAt: issue.created_at.slice(0, 10),
    approvedAt: today,
  };
}

const api = async (path, init = {}) => {
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${init.method ?? 'GET'} ${path}: ${response.status}`);
  return response.status === 204 ? null : response.json();
};

const comment = (number, body) =>
  api(`/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
const addLabels = (number, labels) =>
  api(`/issues/${number}/labels`, { method: 'POST', body: JSON.stringify({ labels }) });
const removeLabel = (number, label) =>
  api(`/issues/${number}/labels/${encodeURIComponent(label)}`, { method: 'DELETE' }).catch(() => null);

async function intake(issue) {
  const decision = triage(issue, { machineIds: loadMachineIds() });
  const labels = issue.labels.map((l) => l.name);
  if (decision.kind === 'ignore') return;

  if (decision.kind === 'invalid') {
    if (!labels.includes('invalid')) await addLabels(issue.number, ['report', 'invalid']);
    await removeLabel(issue.number, 'pending-review');
    await comment(
      issue.number,
      `This report could not be read. Check these fields and edit the issue: ${decision.errors.map((e) => `\`${e.replace(/[^\w-]/g, '')}\``).join(', ')}.`,
    );
    return;
  }

  await addLabels(issue.number, decision.report.appId ? ['report', 'pending-review'] : ['report', 'pending-review', 'new-app']);
  if (labels.includes('invalid')) await removeLabel(issue.number, 'invalid');
}

async function approve(issue) {
  const appLabel = issue.labels.map((l) => l.name).find((n) => n.startsWith('app:'));
  const stored = buildStoredReport(issue, {
    machineIds: loadMachineIds(),
    appIds: listAppIds(),
    today: new Date().toISOString().slice(0, 10),
    appIdOverride: appLabel?.slice(4),
  });
  const dir = join(ROOT, 'data/reports');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `issue-${issue.number}.json`);
  if (existsSync(file)) throw new Error(`${file} already exists`);
  writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`);
  console.log(`Stored report for issue #${issue.number} as app ${stored.appId}`);
}

const listAppIds = () =>
  readdirSync(join(ROOT, 'data/apps')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (mode === 'intake') await intake(event.issue);
  else if (mode === 'approve') await approve(event.issue);
  else throw new Error(`Unknown mode ${mode}`);
}
