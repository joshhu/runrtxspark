# Design notes

Written 2026-10-31. Records what was decided and why, so later changes can respect the reasons.

## Purpose

People who own or are thinking of buying an RTX Spark laptop need to know whether their software runs. The reference sites are [isapplesiliconready.com](https://isapplesiliconready.com/for/browser), [windowsonarm.org](https://windowsonarm.org/), and [onarm.net](https://www.onarm.net/chips/nvidia-rtx-spark).

## What this site does differently

The reference sites record one status per app with no device context, and two of them show entries last updated years ago.

- **Device context on every report**: machine, memory, app version, Windows build, driver.
- **Launch and GPU acceleration are separate.** A program can start under Prism while its GPU features fail, so reports have a GPU field and entries have caveats.
- **Honest scope.** An entry says whether its source tested RTX Spark or Windows on Arm in general. Most early data is general, and pretending otherwise would be the worst failure this site could have.
- **Sources are mandatory.** `validate-data.mjs` rejects any entry without one, and that blocks deployment.
- **Open data** with a stated license and a JSON API.

## Decisions

**The repository is the database.** Static Astro output plus JSON files. Hosting is free, there is no database to secure or back up, and git history is the audit trail. The trade-off is that a change needs a rebuild, which takes about a minute and suits daily updates.

**Hosting path.** `josh.hu` is the `joshhu.github.io` user site. A project site would need a repo named `rtxspark`, which is taken by a private talk-preparation repo. So this repo follows the folder-name convention (`runrtxspark`) and publishes into a `rtxspark/` folder of the user site. The deploy touches only that folder. Because that site is built by Jekyll, which drops folders starting with `_`, Astro's asset folder is renamed from `_astro` to `assets`.

**Reports become GitHub issues.** It is public, moderated with labels, and needs no new infrastructure. Anonymous visitors go through a Cloudflare Worker, chosen for the free tier and because a secret-holding endpoint is the only server this design needs. Turnstile and a rate limit handle abuse. Without the Worker, the form opens a pre-filled issue, so reporting works from day one.

**User text is contained.** Report text only ever appears inside a fenced JSON block in the issue, so it cannot mention people or inject markdown, and the validator rejects anything that could break out of the fence. Astro escapes it again on the page. Workflows read issue data from the event file and never interpolate it into a shell.

**Community reports do not overwrite sourced results.** One wrong report must not flip a verdict for everybody. When at least two reports disagree and they are at least half of the total, the software page shows a warning, and the daily review re-researches the entry.

**Daily work has two layers.** A GitHub Action searches GitHub every day with no AI involved, and lists candidates in one tracking issue. A scheduled Claude agent then follows `docs/maintenance.md`: it reviews reports, reads candidates, searches the web, and commits data. If the agent ever stops, candidates keep accumulating and nothing breaks. The agent treats everything it reads as untrusted, and may edit only `data/` and `public/machines/`.

**Agent commits go straight to `main`, gated by validation.** Requiring a human click every day would defeat the purpose. Validation and tests still block a bad deploy, and any commit can be reverted.

**Language.** Pre-rendered pages per locale, for search engines and speed. The root path picks a locale from `navigator.languages`, and a manual choice in `localStorage` overrides that. Bare `zh` maps to Traditional Chinese. Entry text exists in English and Traditional Chinese: Simplified pages show Traditional text, and Japanese and Korean pages show English.

**Machine photos.** Official product images, reduced to small local thumbnails, each with its source recorded and credited. Every image gets checked by eye, because the first automated pick for the Surface was a Windows logo, and several carried marketing badges. The form lists only machines on sale. Anyone else can choose "another RTX Spark machine".

## Visual direction

The memorable element is a **wafer map**: every program is one die on a silicon wafer, colored by result, with native at the center and failures at the rim. It borrows the yield map chip engineers use, it is real data and not decoration, and each die is a link. The rest stays quiet: cool silicon grays, Bricolage Grotesque for headlines, IBM Plex Sans for text, a plain ruled table. Status is carried by shape as well as color. NVIDIA's green on black was deliberately avoided, since the site is independent and shouldn't look official.
