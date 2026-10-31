# Runs on RTX Spark

A community compatibility catalog for NVIDIA RTX Spark laptops (Windows on Arm). It answers one question: will this program run, and how?

**Live site: <https://josh.hu/rtxspark/>**

Every program gets one of three results:

| Result | Meaning |
|---|---|
| Native | A Windows Arm64 build exists and runs directly on the chip. |
| Runs under Prism | Only an x64 or x86 build exists, and it runs through Microsoft Prism emulation. |
| Fails under Prism | The x64 or x86 build does not start or is unusable under Prism. |

Each entry links to its sources and states whether they tested RTX Spark itself or Windows on Arm in general.

## Features

- Search and filter by result and category, with shareable URLs.
- Five languages (English, 繁體中文, 简体中文, 日本語, 한국어). The first visit follows the browser's language, and a manual choice is remembered.
- A report form with a machine picker that shows product photos, the software, version, result, and optional GPU, Windows build, and driver details.
- Per-machine community results on each software page.
- Daily maintenance: new Arm64 releases and community ports (such as RTX Spark builds of vLLM) are found and added with a source link.
- Open data as JSON at [`/api/apps.json`](https://josh.hu/rtxspark/api/apps.json), [`/api/machines.json`](https://josh.hu/rtxspark/api/machines.json), and [`/api/reports.json`](https://josh.hu/rtxspark/api/reports.json).

## How it fits together

```
Visitor form ──> Cloudflare Worker ──> GitHub issue (pending-review)
      └────────> pre-filled GitHub issue ──┘        │
                                                    ▼ approved label
GitHub search + daily review ──> data/*.json <── publish workflow
                                     │
                                     ▼ validate, test, build
                     joshhu.github.io/rtxspark/ = josh.hu/rtxspark/
```

The repository is the database, so every change has a public history. There is no server to run apart from the small Worker that accepts anonymous reports. Without the Worker, the form falls back to a pre-filled GitHub issue.

| Path | Purpose |
|---|---|
| `data/apps/*.json` | One file per program. Each needs at least one source. |
| `data/machines.json` | RTX Spark machines and their sale status. |
| `data/reports/*.json` | Accepted community reports. |
| `shared/report.mjs` | Report rules shared by the form, the Worker, and the intake script. |
| `scripts/validate-data.mjs` | Blocks deployment when data breaks the rules. |
| `worker/` | Cloudflare Worker for anonymous reports. |
| `docs/maintenance.md` | The daily review runbook. |
| `docs/design.md` | Design decisions and why they were made. |

## Develop

Requires Node 22 or newer.

```bash
npm install
npm run dev        # http://localhost:4321/rtxspark/
npm test           # unit tests
npm run test:e2e   # browser tests, with `npx astro preview --port 4321` running
npm run links      # check every source link
npm run validate   # check everything under data/
npm run build      # validate, then build to dist/
```

## Deploy

A push to `main` validates, tests, builds, and publishes `dist/` into the `rtxspark/` folder of [`joshhu.github.io`](https://github.com/joshhu/joshhu.github.io), which GitHub Pages serves at `josh.hu/rtxspark/`. It uses the `SITE_DEPLOY_KEY` secret, a deploy key with write access to that one repository.

### Anonymous reports

These are live through a Cloudflare Worker on the free plan. To set them up again from scratch:

```bash
cd worker
npx wrangler login
npx wrangler deploy
# A fine-grained GitHub token limited to this repo with Issues: read and write
npx wrangler secret put GITHUB_TOKEN
# From a Cloudflare Turnstile widget created for josh.hu
npx wrangler secret put TURNSTILE_SECRET
```

Then point the site at it and redeploy:

```bash
gh variable set PUBLIC_REPORT_ENDPOINT --body "https://runrtxspark-report.<your-subdomain>.workers.dev/report"
gh variable set PUBLIC_TURNSTILE_SITEKEY --body "<turnstile site key>"
gh workflow run deploy.yml
```

## Contribute

Tested something? [Report it on the site](https://josh.hu/rtxspark/). To correct an entry, open an issue or a pull request that edits its file under `data/apps/`, and include a source link.

## License

Code: [MIT](LICENSE). Catalog data: [CC BY 4.0](DATA_LICENSE.md). Product names, trademarks, and product images belong to their owners and are not covered by these licenses.

This is an independent community project, not affiliated with or endorsed by NVIDIA, Microsoft, or any manufacturer listed.
