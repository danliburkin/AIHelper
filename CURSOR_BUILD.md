# Context Lens — Build Spec & Session Handoff
**Branch:** work on `main`
**Status:** R1–R4 complete, 140 vitest tests passing. Three known critical bugs (M0) NOT yet fixed.
**Current phase:** M-series — bug fixes, multi-tier persistence, Supabase pilot backend, verdict log, deployment.
---
## What this is
A single-page web app (plain JavaScript, Vite, no framework). The heavy reasoning happens in a
separate chatbot tab (ChatGPT, Claude, Gemini). Context Lens is the engine + editor: it decorates
the user's question with a briefing assembled from a longitudinal record, parses structured replies
into boards, and lets the user commit or reject model-proposed record changes.
**The record is the product. The model is a swappable reasoner. The shell is a commodity.**
## Direction update (rev. 3) — multi-tier pilot
The single-user local-first phase is over. 4–6 pilot testers will run real longitudinal threads.
Requirements: Google sign-in, per-user isolated data in a hosted database, multi-device access,
a per-session verdict log for the briefed-vs-plain validation measurement, and admin (Dan) read
access to all testers' data for analysis.
Three access tiers, one codebase:
| Tier | Access | Storage adapter | Auth |
|---|---|---|---|
| 1 | Hosted (GitHub Pages), signed in | remote (Supabase Postgres, JSONB snapshot per conversation) | Google OAuth via Supabase |
| 2 | Hosted, anonymous | local (localStorage, existing behavior) | none |
| 3 | Downloaded single-file build | local if available, else memory | none, auth UI hidden |
Tier 1 concurrency: last-write-wins guarded by `updated_at`; on conflict, warn and reload.
Tier 1 shows sync state: `saving… / saved / sync failed — export your record`.
Verdict log exists in tier 1 only.
**Privacy (mandatory):** on first sign-in, a consent modal states in plain language that the
administrator can read all stored conversations and records for research analysis, and that the
account and all data can be deleted on request. Acceptance timestamp stored in `profiles`.
---
## How to run
```bash
npm install
npm run dev          # → http://localhost:5173  (tier 2 locally; tier 1 if .env has Supabase vars)
npm test             # vitest
npm run build        # hosted bundle → dist/
npm run build:local  # tier-3 single-file build → dist-local/index.html (vite-plugin-singlefile)
```
`.env` (not committed): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. When absent, the app runs
tier 2/3 only and hides the auth UI.
---
## Stack
| Layer | Choice |
|---|---|
| Language | Plain JavaScript (ES modules) |
| Bundler | Vite 6 (+ vite-plugin-singlefile for tier-3 build) |
| UI | Native DOM, single `main.css` |
| Tests | Vitest |
| Backend | Supabase free tier: Postgres + Auth (Google) + RLS. `@supabase/supabase-js` client. No server code of ours. |
| Hosting | GitHub Pages via GitHub Actions |
---
## ERD (Supabase / Postgres)
