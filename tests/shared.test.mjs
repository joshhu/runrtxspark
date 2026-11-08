import { describe, expect, it } from 'vitest';
import { parseIssueBody, reportToIssue, validateReport } from '../shared/report.mjs';
import { pickLocale } from '../src/lib/locale.mjs';

const machineIds = ['asus-proart-p16'];
const good = {
  machine: 'asus-proart-p16',
  software: 'vLLM',
  version: '0.32.0',
  status: 'native',
};

describe('validateReport', () => {
  it('accepts a minimal report', () => {
    const r = validateReport(good, { machineIds });
    expect(r.ok).toBe(true);
    expect(r.report).toEqual(good);
  });

  it('drops unknown keys', () => {
    const r = validateReport({ ...good, isAdmin: true, __proto__: { x: 1 } }, { machineIds });
    expect(r.ok).toBe(true);
    expect(Object.keys(r.report).sort()).toEqual(['machine', 'software', 'status', 'version']);
  });

  it.each([
    ['machine', { machine: 'unknown' }],
    ['status', { status: 'works-fine' }],
    ['version', { version: '' }],
    ['software', { software: 'x'.repeat(81) }],
    ['evidenceUrl', { evidenceUrl: 'http://example.com' }],
    ['evidenceUrl', { evidenceUrl: 'javascript:alert(1)' }],
    ['notes', { notes: 'break out\n```\n@someone' }],
    ['notes', { notes: 'hide <!-- marker' }],
    ['notes', { notes: 'bell\u0007' }],
  ])('rejects bad %s', (field, patch) => {
    const r = validateReport({ ...good, ...patch }, { machineIds });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain(field);
  });

  it('requires a machine name for other machines', () => {
    const r = validateReport({ ...good, machine: 'other' }, { machineIds });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('machineName');
    const ok = validateReport({ ...good, machine: 'other', machineName: 'Mini PC' }, { machineIds });
    expect(ok.ok).toBe(true);
  });

  it.each([null, [], 'x', 3])('rejects non-object payload %j', (payload) => {
    expect(validateReport(payload, { machineIds }).ok).toBe(false);
  });
});

describe('issue round trip', () => {
  it('survives encoding and strips mentions from the title', () => {
    const report = { ...good, software: '@evil `tool`', notes: 'line one\nline "two"' };
    const { title, body } = reportToIssue(report);
    expect(title).not.toMatch(/[@`]/);
    expect(parseIssueBody(body)).toEqual(report);
    expect(parseIssueBody(body.replace(/\n/g, '\r\n'))).toEqual(report);
  });

  it('returns null for bodies that are not reports', () => {
    expect(parseIssueBody('hello')).toBeNull();
    expect(parseIssueBody('<!-- rtxspark-report:v1 -->\n```json\n{bad\n```')).toBeNull();
    expect(parseIssueBody(undefined)).toBeNull();
  });
});

describe('pickLocale', () => {
  it.each([
    [['zh-TW', 'en'], 'zh-tw'],
    [['zh-Hant-HK'], 'zh-tw'],
    [['zh-HK'], 'zh-tw'],
    [['zh'], 'zh-tw'],
    [['zh-CN'], 'zh-cn'],
    [['zh-Hans-SG'], 'zh-cn'],
    [['ja-JP'], 'ja'],
    [['ko-KR'], 'ko'],
    [['fr-FR', 'ja'], 'ja'],
    [['fr-FR'], 'en'],
    [['en-GB', 'zh-TW'], 'en'],
    [[], 'en'],
    [undefined, 'en'],
  ])('%j -> %s', (languages, expected) => {
    expect(pickLocale(languages)).toBe(expected);
  });

  it('can be serialized for the inline redirect', () => {
    const revived = new Function(`return (${pickLocale.toString()})`)();
    expect(revived(['ko'])).toBe('ko');
  });
});
