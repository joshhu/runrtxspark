// Daily, deterministic GitHub search for RTX Spark and Windows-on-Arm ports.
// It only lists candidates in one tracking issue. Adding an entry still needs
// someone to read the project, because a repo name proves nothing about status.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const QUERIES = ['"rtx spark"', 'rtx-spark', 'N1X windows arm64', 'windows arm64 cuda', 'win-arm64 cuda', 'vllm windows arm64'];
const TRACKER_TITLE = 'Daily discovery: RTX Spark candidates';
const TRACKER_LABEL = 'discovery';

/** Keeps repos pushed recently that are not already known, newest first. */
export function selectCandidates(repos, { knownUrls, seen, since }) {
  const out = new Map();
  for (const repo of repos) {
    const url = repo.html_url.toLowerCase();
    if (repo.fork || repo.archived) continue;
    if (repo.full_name.toLowerCase() === 'joshhu/runrtxspark') continue;
    if (knownUrls.has(url) || seen.has(url)) continue;
    if (repo.pushed_at < since) continue;
    out.set(url, repo);
  }
  return [...out.values()].sort((a, b) => b.pushed_at.localeCompare(a.pushed_at));
}

/** Neutralizes text from other people's repos before it enters an issue. */
export const sanitize = (text, max = 140) =>
  String(text ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[@`<>[\]()|*_~#]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim()
    .slice(0, max);

export function formatCandidates(list, date) {
  const lines = list.map(
    (r) => `- [ ] [${sanitize(r.full_name, 100)}](${r.html_url}) (${r.stargazers_count} stars, pushed ${r.pushed_at.slice(0, 10)}): ${sanitize(r.description)}`,
  );
  return `## ${date}\n\n${lines.join('\n')}\n\nDescriptions come from the repositories and are unverified.`;
}

export function knownEvidenceUrls(root = ROOT) {
  const urls = new Set();
  const dir = join(root, 'data/apps');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const app = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const { url } of app.evidence ?? []) {
      const m = url.toLowerCase().match(/^https:\/\/github\.com\/[^/]+\/[^/]+/);
      if (m) urls.add(m[0]);
    }
  }
  return urls;
}

async function gh(path, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${path}: ${response.status}`);
  return response.json();
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const now = new Date();
  const since = new Date(now - 30 * 864e5).toISOString();

  const found = [];
  for (const q of QUERIES) {
    const params = new URLSearchParams({ q: `${q} fork:false`, sort: 'updated', order: 'desc', per_page: '30' });
    const data = await gh(`/search/repositories?${params}`);
    found.push(...data.items);
    // The search API allows 30 requests a minute.
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }

  const issues = await gh(`/repos/${repo}/issues?state=open&labels=${TRACKER_LABEL}&per_page=10`);
  let tracker = issues.find((i) => i.title === TRACKER_TITLE);
  if (!tracker) {
    tracker = await gh(`/repos/${repo}/issues`, {
      method: 'POST',
      body: JSON.stringify({
        title: TRACKER_TITLE,
        labels: [TRACKER_LABEL],
        body: 'New repositories found by the daily search. The daily review checks each one and adds real ports to the catalog with a source link.',
      }),
    });
  }

  const comments = await gh(`/repos/${repo}/issues/${tracker.number}/comments?per_page=100`);
  const seen = new Set(
    [...comments.map((c) => c.body).join('\n').matchAll(/https:\/\/github\.com\/[^\s)]+/g)].map((m) => m[0].toLowerCase()),
  );

  const candidates = selectCandidates(found, { knownUrls: knownEvidenceUrls(), seen, since });
  if (!candidates.length) {
    console.log('No new candidates.');
    return;
  }
  await gh(`/repos/${repo}/issues/${tracker.number}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: formatCandidates(candidates.slice(0, 40), now.toISOString().slice(0, 10)) }),
  });
  console.log(`Posted ${Math.min(candidates.length, 40)} candidates to #${tracker.number}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
