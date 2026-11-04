# Architecture

A small, single-deployment web app with no servers to run: a React single-page
app and a Hono API, both served by **Cloudflare Pages**, with **Cloudflare D1**
(SQLite) for storage. There is no separate backend host and no paid
infrastructure in the common case.

```
Browser (PWA)
   │  fetch /api/*
   ▼
Cloudflare Pages
   ├── static assets  ← Vite build of src/app  (React SPA)
   └── Functions      ← functions/  (Hono API)  ──►  D1 (SQLite)
```

## Layout

| Path | What it is |
| --- | --- |
| `src/engine/` | **Pure** golf logic: scoring, handicaps, formats, schedule, GPS, gambling games. No I/O, no framework — just functions over plain data. This is the heart of the app and the most thoroughly tested part. |
| `src/app/` | The React SPA: pages, admin screens, shared components, the season/auth context. |
| `functions/api/[[route]].ts` | The Hono API (one catch-all Pages Function). Auth, leagues, seasons, scores, rounds, calendar, push, admin. |
| `functions/lib/` | Server helpers: `db` (D1 load/save), `accounts`, `leagues`, `oauth`, `email`, `push`, `notify`, `calendar`, `rounds`, `courses`, `brand`. |
| `functions/_middleware.ts` | Runs on every request (e.g. the US-only country check). |
| `migrations/` | D1 schema migrations, applied in order (`wrangler d1 migrations apply`). |
| `src/brand.ts`, `functions/lib/brand.ts` | Per-deployment name, domain and logo. |
| `tools/` | One-off scripts (seed SQL generator, spreadsheet importer). |

## Key ideas

- **The engine stores only raw inputs.** Hole scores, rosters and settings are
  stored; everything derived — net scores, points, standings, handicaps,
  hotshots, averages — is recomputed by `computeSeason()` on each load. That
  keeps the database simple and makes the rules easy to test and change.
- **D1 holds the data; the repo holds none.** Rosters, scores and accounts live
  only in your database. The code ships with a fictional `data/season-sample.json`
  for demos.
- **Secrets live in the environment**, never in the repo (see `.dev.vars.example`
  and the README).
- **PWA**: `public/manifest.webmanifest` + `public/sw.js` make it installable and
  handle content-less Web Push (the service worker fetches notification text
  from `/api/push/pending`).
- **Auth**: Google OAuth and/or passwordless email codes; a shared admin-password
  fallback for first setup. Sessions are signed cookies.

## Testing

`npm test` runs [vitest](https://vitest.dev):

- `src/engine/*.test.ts` — scoring, formats, handicaps, schedule (pure unit tests).
- `src/app/formats.test.tsx` — server-renders each page for every format to catch crashes.
- `functions/test/*.test.ts` — the API against a Node SQLite shim that applies the real migrations.

CI (`.github/workflows/ci.yml`) runs the suite on every pull request.
