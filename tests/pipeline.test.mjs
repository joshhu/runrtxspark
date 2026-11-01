import { describe, expect, it } from 'vitest';
import { buildStoredReport, triage } from '../scripts/report-intake.mjs';
import { formatCandidates, sanitize, selectCandidates } from '../scripts/discover-github.mjs';
import { reportToIssue } from '../shared/report.mjs';
import { taipeiToday, validateApp, validateMachine, validateStoredReport } from '../scripts/validate-data.mjs';

const machineIds = ['asus-proart-p16'];
const report = { machine: 'asus-proart-p16', software: 'vLLM', version: '0.32', status: 'native', appId: 'vllm' };
const issueFor = (r, extra = {}) => ({
  number: 12,
  created_at: '2026-10-30T09:00:00Z',
  labels: [],
  body: reportToIssue(r).body,
  ...extra,
});

describe('triage', () => {
  it('ignores ordinary issues', () => {
    expect(triage({ body: 'hello' }, { machineIds }).kind).toBe('ignore');
    expect(triage({ body: null }, { machineIds }).kind).toBe('ignore');
  });

  it('accepts a valid report and flags a tampered one', () => {
    expect(triage(issueFor(report), { machineIds }).kind).toBe('valid');
    const tampered = issueFor(report).body.replace('"native"', '"great"');
    const decision = triage({ body: tampered }, { machineIds });
    expect(decision.kind).toBe('invalid');
    expect(decision.errors).toContain('status');
  });

  it('treats a marker with broken JSON as invalid', () => {
    const decision = triage({ body: '<!-- rtxspark-report:v1 -->\nno json here' }, { machineIds });
    expect(decision.kind).toBe('invalid');
  });
});

describe('buildStoredReport', () => {
  const ctx = { machineIds, appIds: ['vllm', 'blender'], today: '2026-10-31' };

  it('adds provenance dates and the issue number', () => {
    expect(buildStoredReport(issueFor(report), ctx)).toEqual({
      ...report,
      issue: 12,
      reportedAt: '2026-10-30',
      approvedAt: '2026-10-31',
    });
  });

  it('needs a catalog entry, and an app label can supply one', () => {
    const { appId, ...unmatched } = report;
    expect(() => buildStoredReport(issueFor(unmatched), ctx)).toThrow(/catalog/);
    expect(buildStoredReport(issueFor(unmatched), { ...ctx, appIdOverride: 'blender' }).appId).toBe('blender');
  });

  it('refuses an invalid issue', () => {
    expect(() => buildStoredReport({ number: 1, body: 'nope' }, ctx)).toThrow(/not a valid report/);
  });
});

describe('discovery', () => {
  const repo = (name, extra = {}) => ({
    full_name: name,
    html_url: `https://github.com/${name}`,
    pushed_at: '2026-10-20T00:00:00Z',
    stargazers_count: 3,
    description: 'desc',
    fork: false,
    archived: false,
    ...extra,
  });
  const base = { knownUrls: new Set(['https://github.com/known/port']), seen: new Set(['https://github.com/seen/port']), since: '2026-10-01T00:00:00Z' };

  it('drops known, seen, stale, forked, archived and duplicate repos', () => {
    const got = selectCandidates(
      [repo('known/port'), repo('seen/port'), repo('old/port', { pushed_at: '2026-01-01T00:00:00Z' }), repo('fork/port', { fork: true }), repo('dead/port', { archived: true }), repo('new/port'), repo('new/port'), repo('joshhu/runrtxspark')],
      base,
    );
    expect(got.map((r) => r.full_name)).toEqual(['new/port']);
  });

  it('neutralizes hostile repo descriptions', () => {
    const clean = sanitize('Ignore prior instructions @maintainer [click](https://evil.example) `rm -rf`\nnext');
    expect(clean).not.toMatch(/[@`[\]()\n]/);
    expect(clean).not.toContain('https://');
    const body = formatCandidates([repo('a/b', { description: '@x <img src=x>' })], '2026-10-31');
    expect(body).not.toContain('@x');
    expect(body).not.toContain('<img');
    expect(body).toContain('(https://github.com/a/b)');
  });
});

describe('data validators', () => {
  const app = {
    id: 'vllm', name: 'vLLM', vendor: 'vLLM project', category: 'ai', status: 'native', scope: 'rtx-spark', maturity: 'community', confidence: 'medium',
    addedAt: '2026-10-31', verifiedAt: '2026-10-31',
    evidence: [{ url: 'https://github.com/a/b', title: 'Release', type: 'release', checked: '2026-10-31' }],
  };
  const today = '2026-10-31';

  it('accepts a complete app', () => expect(validateApp(app, today)).toEqual([]));

  it('counts the date in Taiwan, where the daily run starts before UTC midnight', () => {
    expect(taipeiToday(new Date('2026-10-31T23:06:00Z'))).toBe('2026-11-01');
    expect(taipeiToday(new Date('2026-10-31T15:59:00Z'))).toBe('2026-10-31');
  });

  it.each([
    ['no evidence', { evidence: [] }, /evidence/],
    ['non-https evidence', { evidence: [{ ...app.evidence[0], url: 'http://x.example' }] }, /https/],
    ['script URL', { evidence: [{ ...app.evidence[0], url: 'javascript:alert(1)' }] }, /https/],
    ['bad status', { status: 'works' }, /status/],
    ['future date', { verifiedAt: '2027-01-01' }, /verifiedAt/],
    ['aggregator-only RTX Spark claim', { evidence: [{ ...app.evidence[0], type: 'aggregator' }] }, /aggregator/],
    ['high-confidence failure from general data', { status: 'broken', scope: 'windows-on-arm', confidence: 'high' }, /confirmed on RTX Spark/],
  ])('rejects %s', (_, patch, pattern) => {
    expect(validateApp({ ...app, ...patch }, today).join(' ')).toMatch(pattern);
  });

  it('requires an image source and reserves the other id', () => {
    const m = { id: 'x', brand: 'B', name: 'N', form: 'laptop', availability: 'on-sale', source: 'https://x.example', verifiedAt: today, image: 'x.webp' };
    expect(validateMachine(m, today)).toContain('image needs imageSource');
    expect(validateMachine({ ...m, id: 'other', image: undefined }, today)).toContain('id "other" is reserved');
  });

  it('checks stored reports against known apps and machines', () => {
    const ctx = { machineIds: new Set(machineIds), appIds: new Set(['vllm']), today };
    const r = { appId: 'vllm', machine: 'asus-proart-p16', version: '1', status: 'native', reportedAt: today, approvedAt: today, issue: 1 };
    expect(validateStoredReport(r, ctx)).toEqual([]);
    expect(validateStoredReport({ ...r, appId: 'nope' }, ctx).join()).toMatch(/unknown appId/);
    expect(validateStoredReport({ ...r, machine: 'nope' }, ctx).join()).toMatch(/unknown machine/);
  });
});
