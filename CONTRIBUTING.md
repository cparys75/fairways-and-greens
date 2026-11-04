# Contributing to Fairways and Greens

Thanks for your interest in improving this project! It's a self-hostable web app
for running a golf league — scores, standings, handicaps, scorecards and casual
group rounds — built on Cloudflare Pages + D1.

## Ground rules

- **Never commit secrets or real data.** API keys, OAuth client secrets and VAPID
  keys live in environment variables / Cloudflare, never in the repo. Don't add a
  database dump or a real roster. The sample season in `data/season-sample.json`
  is entirely fictional — keep it that way.
- Be kind. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- By contributing, you agree your work is licensed under the project's
  [MIT License](LICENSE).

## Getting set up

```bash
npm install
npm run dev          # Vite dev server (UI only)
npm test             # vitest — the engine + API test suites
npm run typecheck    # tsc, no emit
npm run build        # production build (tsc -b && vite build)
```

For the full app (API + database) locally, and for a first-time production
deploy, follow [README.md](README.md) — it covers Cloudflare Pages, D1, Google
sign-in, email, push and the custom domain.

To see the app with data, seed the fictional sample season:

```bash
npm run seed:sql                 # writes data/seed.sql from data/season-sample.json
wrangler d1 execute <db> --local --file data/seed.sql
```

## Making a change

1. Fork, then branch from `main` (`git checkout -b my-change`).
2. Keep the change focused. One feature or fix per pull request.
3. Add or update tests. The engine (`src/engine`) is pure and well-covered —
   new scoring/handicap behavior should come with a test.
4. Run `npm test`, `npm run typecheck` and `npm run build` before pushing. CI
   runs the same on every pull request.
5. Open a PR against `main` with a clear description of what and why. Screenshots
   help for UI changes.

## Where things live

- `src/engine/` — pure scoring, handicaps, formats and schedule logic (no I/O).
- `src/app/` — the React single-page app.
- `functions/` — the Hono API on Cloudflare Pages Functions, and `functions/lib`.
- `migrations/` — D1 SQL migrations, applied in order.
- `src/brand.ts` + `functions/lib/brand.ts` — per-deployment name, domain and logo.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the bigger picture.

## Proposing a feature

Open an issue describing the problem first, especially for anything that changes
scoring, the data model or a migration — it's easier to agree on the shape before
code. Small, self-contained features are the easiest to review and merge.
