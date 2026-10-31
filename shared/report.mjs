// Report contract shared by the browser form, the Cloudflare Worker and the
// GitHub intake script. Dependency-free so it runs in all three.

export const STATUSES = ['native', 'prism', 'broken'];
export const EXPERIENCES = ['smooth', 'limited', 'major'];
export const GPU_RESULTS = ['works', 'partial', 'fails', 'na'];
export const OTHER_MACHINE = 'other';

export const REPORT_MARKER = '<!-- rtxspark-report:v1 -->';

const LIMITS = {
  software: 80,
  version: 40,
  windowsBuild: 40,
  gpuDriver: 40,
  memory: 16,
  machineName: 80,
  notes: 1000,
  evidenceUrl: 300,
};

const hasControlChars = (s) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s);
const isHttpsUrl = (s) => {
  try {
    return new URL(s).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Validates and normalizes an untrusted report.
 * Unknown keys are dropped, so nothing unexpected reaches the issue or the data files.
 * @returns {{ok: true, report: object} | {ok: false, errors: string[]}}
 */
export function validateReport(input, { machineIds }) {
  const errors = [];
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['payload'] };
  }

  const report = {};

  const text = (key, { required = false } = {}) => {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) errors.push(key);
      return;
    }
    if (typeof raw !== 'string') {
      errors.push(key);
      return;
    }
    const value = raw.trim();
    if (
      (required && !value) ||
      value.length > LIMITS[key] ||
      hasControlChars(value) ||
      // A code fence would let the text escape the JSON block in the issue body.
      value.includes('```') ||
      value.includes('<!--')
    ) {
      errors.push(key);
      return;
    }
    if (value) report[key] = value;
  };

  const choice = (key, allowed, { required = false } = {}) => {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) errors.push(key);
      return;
    }
    if (!allowed.includes(raw)) {
      errors.push(key);
      return;
    }
    report[key] = raw;
  };

  choice('machine', [...machineIds, OTHER_MACHINE], { required: true });
  text('machineName', { required: input.machine === OTHER_MACHINE });
  text('memory');
  text('software', { required: true });
  text('version', { required: true });
  choice('status', STATUSES, { required: true });
  choice('experience', EXPERIENCES);
  choice('gpu', GPU_RESULTS);
  text('windowsBuild');
  text('gpuDriver');
  text('notes');

  text('evidenceUrl');
  if (report.evidenceUrl && !isHttpsUrl(report.evidenceUrl)) errors.push('evidenceUrl');

  if (typeof input.appId === 'string' && /^[a-z0-9-]{1,80}$/.test(input.appId)) {
    report.appId = input.appId;
  }

  return errors.length ? { ok: false, errors } : { ok: true, report };
}

/** Everything user-written stays inside the fence, so it cannot ping people or inject markdown. */
export function reportToIssue(report) {
  const title = `[Report] ${report.software} ${report.version}`.replace(/[@`]/g, '').slice(0, 120);
  const body = [
    REPORT_MARKER,
    'Compatibility report. The maintainer or the daily review reads the data below.',
    '',
    '```json',
    JSON.stringify(report, null, 2),
    '```',
  ].join('\n');
  return { title, body };
}

/** Pulls the JSON block back out of an issue body. Returns null when absent or malformed. */
export function parseIssueBody(body) {
  if (typeof body !== 'string' || !body.includes(REPORT_MARKER)) return null;
  const normalized = body.replace(/\r\n/g, '\n');
  const after = normalized.slice(normalized.indexOf(REPORT_MARKER));
  const match = after.match(/```json\n([\s\S]*?)\n```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}
