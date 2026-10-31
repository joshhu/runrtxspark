import { describe, expect, it, vi } from 'vitest';
import { handleReport } from '../worker/src/index.mjs';
import { parseIssueBody } from '../shared/report.mjs';

const env = {
  ALLOWED_ORIGINS: 'https://josh.hu',
  GITHUB_REPO: 'joshhu/runrtxspark',
  GITHUB_TOKEN: 'test-token',
  TURNSTILE_SECRET: 'test-secret',
};

const validReport = {
  machine: 'asus-proart-p16',
  software: 'vLLM',
  version: '0.32.0',
  status: 'native',
};

const post = (body, headers = {}) =>
  new Request('https://worker.example/report', {
    method: 'POST',
    headers: { origin: 'https://josh.hu', 'cf-connecting-ip': '203.0.113.9', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

function fakeFetch({ turnstile = true, github = 201 } = {}) {
  return vi.fn(async (url, init) => {
    if (String(url).includes('turnstile')) {
      return new Response(JSON.stringify({ success: turnstile }));
    }
    return new Response(
      JSON.stringify({ html_url: 'https://github.com/joshhu/runrtxspark/issues/7', number: 7, sent: init.body }),
      { status: github },
    );
  });
}

describe('handleReport', () => {
  it('files a valid report as a labeled issue', async () => {
    const fetcher = fakeFetch();
    const res = await handleReport(post({ report: validReport, turnstileToken: 'ok' }), env, { fetcher });
    expect(res.status).toBe(201);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://josh.hu');
    expect(await res.json()).toEqual({ url: 'https://github.com/joshhu/runrtxspark/issues/7', number: 7 });

    const [, init] = fetcher.mock.calls[1];
    const sent = JSON.parse(init.body);
    expect(sent.labels).toEqual(['report', 'pending-review']);
    expect(parseIssueBody(sent.body)).toEqual(validReport);
    expect(init.headers.authorization).toBe('Bearer test-token');
  });

  it('rejects other origins before doing any work', async () => {
    const fetcher = fakeFetch();
    const res = await handleReport(post({ report: validReport, turnstileToken: 'ok' }, { origin: 'https://evil.example' }), env, { fetcher });
    expect(res.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires a passing human check', async () => {
    const fetcher = fakeFetch({ turnstile: false });
    const res = await handleReport(post({ report: validReport, turnstileToken: 'bad' }), env, { fetcher });
    expect(res.status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not call Turnstile when the token is missing', async () => {
    const fetcher = fakeFetch();
    const res = await handleReport(post({ report: validReport }), env, { fetcher });
    expect(res.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns field errors for an invalid report', async () => {
    const res = await handleReport(post({ report: { ...validReport, status: 'nope' }, turnstileToken: 'ok' }), env, { fetcher: fakeFetch() });
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toContain('status');
  });

  it('rejects malformed and oversized bodies', async () => {
    expect((await handleReport(post('{oops'), env, { fetcher: fakeFetch() })).status).toBe(400);
    expect((await handleReport(post('x'.repeat(9000)), env, { fetcher: fakeFetch() })).status).toBe(413);
  });

  it('enforces the rate limit', async () => {
    const limited = { ...env, REPORT_LIMITER: { limit: async () => ({ success: false }) } };
    const fetcher = fakeFetch();
    const res = await handleReport(post({ report: validReport, turnstileToken: 'ok' }), limited, { fetcher });
    expect(res.status).toBe(429);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports a GitHub failure and does not claim success', async () => {
    const res = await handleReport(post({ report: validReport, turnstileToken: 'ok' }), env, { fetcher: fakeFetch({ github: 500 }) });
    expect(res.status).toBe(502);
  });

  it('answers preflight only for allowed origins', async () => {
    const ok = new Request('https://worker.example/report', { method: 'OPTIONS', headers: { origin: 'https://josh.hu' } });
    expect((await handleReport(ok, env)).status).toBe(204);
    const bad = new Request('https://worker.example/report', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect((await handleReport(bad, env)).status).toBe(403);
  });
});
