// Accepts anonymous reports and files them as GitHub issues, so visitors need no
// GitHub account and the token never reaches the browser.
import machinesFile from '../../data/machines.json';
import { reportToIssue, validateReport } from '../../shared/report.mjs';

const MAX_BODY_BYTES = 8 * 1024;
const machineIds = machinesFile.machines.map((m) => m.id);

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim());
  if (!origin || !allowed.includes(origin)) return null;
  return { 'access-control-allow-origin': origin, vary: 'Origin' };
}

async function verifyTurnstile(token, ip, env, fetcher) {
  if (!token) return false;
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  if (ip) form.set('remoteip', ip);
  const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true;
}

export async function handleReport(request, env, { fetcher = fetch } = {}) {
  const cors = corsHeaders(request, env);

  if (request.method === 'OPTIONS') {
    if (!cors) return new Response(null, { status: 403 });
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '86400',
      },
    });
  }

  const url = new URL(request.url);
  if (url.pathname !== '/report') return json(404, { error: 'not_found' });
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, { allow: 'POST' });
  if (!cors) return json(403, { error: 'origin_not_allowed' });

  const ip = request.headers.get('cf-connecting-ip') ?? '';
  if (env.REPORT_LIMITER) {
    const { success } = await env.REPORT_LIMITER.limit({ key: ip || 'unknown' });
    if (!success) return json(429, { error: 'rate_limited' }, cors);
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json(413, { error: 'too_large' }, cors);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: 'invalid_json' }, cors);
  }

  let verified = false;
  try {
    verified = await verifyTurnstile(payload?.turnstileToken, ip, env, fetcher);
  } catch (error) {
    console.error('turnstile request failed', error);
    return json(502, { error: 'verification_unavailable' }, cors);
  }
  if (!verified) return json(403, { error: 'verification_failed' }, cors);

  const result = validateReport(payload?.report, { machineIds });
  if (!result.ok) return json(422, { error: 'invalid_report', errors: result.errors }, cors);

  const { title, body } = reportToIssue(result.report);
  const response = await fetcher(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'runrtxspark-report-worker',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({ title, body, labels: ['report', 'pending-review'] }),
  });

  if (!response.ok) {
    // Status only: the response body could echo request details into the logs.
    console.error('github issue creation failed', response.status);
    return json(502, { error: 'github_unavailable' }, cors);
  }

  const issue = await response.json();
  return json(201, { url: issue.html_url, number: issue.number }, cors);
}

export default { fetch: (request, env) => handleReport(request, env) };
