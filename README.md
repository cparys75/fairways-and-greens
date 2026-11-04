# Fairways and Greens

A web app that replaces the weekly **Week N Results.numbers** spreadsheet. Players can see standings,
scorecards, the schedule, handicaps, hotshots and stats on any phone. The admin enters hole scores
in one screen, and everything else updates automatically.

| Spreadsheet (before) | App (now) |
| --- | --- |
| Copy the Template tab to a new `WeekN` tab | Weeks come from the schedule. Pick the week and type scores. |
| Run steps 3–6 by hand (HCAP → RunningHCAP → Standings → Averages) | Nothing to run. Handicaps, standings, hotshots and averages are recalculated on every change. |
| Double-click "Virtual Score" or "Forfeit" | Tick **Absent** or choose "Team X forfeits" |
| Email or print the file | Share the link. It works on phones. |
| One copy on one Mac | Hosted on Cloudflare with a downloadable backup at any time |

## How it works

```
Browser (React)                 Cloudflare Pages Functions           Cloudflare D1 (SQLite)
 ├─ public pages ──GET /api/seasons/:id──► loads raw season data ◄──── seasons, teams, players,
 ├─ admin pages ───PUT /api/admin/... ───► validates + saves             weeks, matches, scores
 └─ src/engine  ◄── computes strokes, net, points, handicaps, standings, hotshots, averages
```

- **Only raw inputs are stored:** roster, schedule, hole scores, absences and forfeits. Every derived
  number is computed by [`src/engine`](src/engine), so nothing can get out of sync, and there is
  no "recalculate" step to forget.
- **The engine is thoroughly tested.** Unit tests in [`src/engine`](src/engine) cover scoring, handicaps, every format and the schedule, and each page is server-rendered in tests to catch crashes.
- **League rules are settings, not formulas.** Points, max handicaps, the handicap formula, the
  max-score-per-hole table, the hotshot threshold, and the course (pars and hole handicaps) can all
  be edited in **Admin → Rules & course**.

### Cost

For a league this size, it runs on Cloudflare's free tier:
- Pages: unlimited static requests
- Functions: 100k requests/day
- D1: 5 GB storage and 5M rows read/day

A season page load reads about 600 rows, so the free tier covers roughly 8,000 page views a day. The
only thing you might pay for is a custom domain (optional).

## Project layout

```
src/engine/        Scoring rules (pure TypeScript, shared by browser and API) + tests
src/app/           React UI: public pages in pages/, admin screens in admin/
functions/api/     API (Hono on Cloudflare Pages Functions)
functions/lib/     D1 queries and admin sign-in
migrations/        Database schema
tools/             Numbers importer (Python) and seed-SQL generator
data/              The 2025 season converted from the spreadsheet
docs/              Admin guide and spreadsheet → app mapping
```

## Run it locally

Requirements: Node 20+.

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

```bash
npx wrangler d1 migrations apply golf-league --local
```

```bash
npm run db:seed:local
```

```bash
npm run dev:full
```

Open http://localhost:8788. The admin password is whatever `.dev.vars` says (`change-me` by default).
With `DEV_LOGIN=true` in `.dev.vars`, the sign-in page also lets you sign in as any email (only on
localhost), so you can try player features without Google keys.

The local Workers runtime needs macOS 13.5 or later (or Linux). On older macOS, `npm test` still runs
everything, including end-to-end API tests on an in-memory database
([`functions/test`](functions/test)).

For UI work with hot reload, keep `npm run dev:full` running and also run `npm run dev`. Vite then
serves the UI on http://localhost:5173 and sends `/api` calls to the Wrangler server.

Run the tests (including the spreadsheet golden test):

```bash
npm test
```

## Deploy (one-time setup, about 15 minutes)

1. Create a free Cloudflare account, then log in from this folder:

   ```bash
   npx wrangler login
   ```

2. Create the database:

   ```bash
   npx wrangler d1 create golf-league
   ```

   Paste the `database_id` it prints into [`wrangler.toml`](wrangler.toml).

3. Create the tables and load the 2025 season:

   ```bash
   npx wrangler d1 migrations apply golf-league --remote
   ```

   ```bash
   npm run seed:sql && npx wrangler d1 execute golf-league --remote --file data/seed.sql
   ```

4. Create the site and deploy:

   ```bash
   npx wrangler pages project create golf-league --production-branch main
   ```

   ```bash
   npm run deploy
   ```

5. Set the admin password and a random session secret:

   ```bash
   npx wrangler pages secret put ADMIN_PASSWORD --project-name golf-league
   ```

   ```bash
   npx wrangler pages secret put SESSION_SECRET --project-name golf-league
   ```

   Optionally, to turn on **Find a course**, get a free API key at https://golfcourseapi.com and add it:

   ```bash
   npx wrangler pages secret put GOLF_COURSE_API_KEY --project-name golf-league
   ```

   Run `npm run deploy` once more so the secrets take effect. The site is now at
   `https://golf-league.pages.dev`. You can add a custom domain in the Cloudflare dashboard under
   Pages → golf-league → Custom domains.

### Automatic deploys from GitHub (optional)

Push this repo to GitHub, then add:
- **Secrets:** `CLOUDFLARE_API_TOKEN` (a token with the "Cloudflare Pages: Edit" and "D1: Edit"
  permissions) and `CLOUDFLARE_ACCOUNT_ID`
- **Variable:** `DEPLOY_ENABLED` = `true`

After that, every push to `main` runs the tests, applies any new migrations and deploys
([.github/workflows/deploy.yml](.github/workflows/deploy.yml)). Pull requests run the tests only.

### Player sign-in (Google or an emailed code)

Players sign in to enter scores for their own matches and to track personal rounds. Admins sign in
the same way and are given the admin role under **Admin → Accounts**. Sessions end after 8 hours
without activity. The `ADMIN_PASSWORD` stays as an emergency fallback (and is how the first admin
gets in to grant their own account admin access).

Google sign-in needs a free app registration. Replace `example.com` with your domain (the old `example-preview.pages.dev` entries can stay as well).

1. https://console.cloud.google.com → create a project → **APIs & Services → OAuth consent screen**:
   External, app name, support email. Scopes: `openid`, `email`, `profile`. Publish the app.
2. **Credentials → Create credentials → OAuth client ID** → Web application. Authorized redirect URI:
   `https://example.com/api/auth/google/callback`
3. Save the client ID and secret:
   ```bash
   npx wrangler pages secret put GOOGLE_CLIENT_ID --project-name golf-league
   npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name golf-league
   ```

The sign-in button only appears once both secrets are set, and secrets take effect on the next deploy.

**Email codes (no password).** Players who don't use Google sign in with a 6-digit code emailed each
time (passwordless). Codes are single-use, expire in 10 minutes, rate-limited, and only sent to emails
already on a roster or with an account (no enumeration). Typing the code verifies the address, so the
person auto-links to their roster player — no manual linking. This needs an email sender (free
[Resend](https://resend.com)):
1. Create a Resend account and **verify the `example.com` domain** (add the DNS records Resend gives
   you, in Cloudflare).
2. Set the secrets: `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `Fairways and Greens <noreply@example.com>`).

Until `RESEND_API_KEY` is set, only Google sign-in is offered. On localhost dev the code is returned in
the response (shown on screen) so email isn't needed. Accounts link to roster players by verified email
(Google or an email code); a different address can be linked by hand on **Accounts**.

## Leagues and admins

One site can host several leagues, each with its own seasons, rules, courses, roster and message board.
People only see the leagues they belong to.

- **Site admins** (`users.is_admin`, or anyone using the admin password) see and run every league, list every
  account, and decide who may start leagues (Admin → Accounts → "Show every account on the site").
- **League creators** are accounts a site admin has allowed to start leagues ("Starts leagues"). Starting
  one (Profile → Leagues) makes them its admin.
- **League admins** run their own leagues only: seasons, rules and course, roster, schedule, scores, the board,
  and who's in the league (Admin → League).
- **Members** are roster players linked to an account (by hand, or by verified email), plus anyone a league
  admin approved.

Each league has an invite link (Admin → League). Someone who opens it and signs in, or creates an email
account, is listed under "Asking to join" for that league's admins to approve; approving also turns on a new
email account. Sign-ups without an invite link wait for a site admin.

### Formats

Each season picks a format (Admin → New season, or Rules & course before any scores are in):

| Format | Sides | How a week is scored |
|---|---|---|
| Team match play | Teams | Partners' nets added up per hole; hole points plus a net bonus (the original league) |
| Best ball match play | Teams | The better partner's net per hole; hole points plus a net bonus |
| Individual match play | Players | Net against net per hole; hole points plus a net bonus |
| Stroke play (net) | Players | Leaderboard by net total; standings points by finish (last = 1, one more per place) |
| Stableford (net) | Players | Points per hole for the net score (table in Rules & course); season total |
| Scramble | Teams | One team card with a team handicap (percent of each player's handicap); points by finish |

In individual formats every player is their own one-player team (kept in step with the roster automatically). In
leaderboard formats there are no matchups, and a player's own card (or any team member's scramble card) counts as
soon as it's sent. Scramble cards are stored under the negative team id and don't affect players' handicaps.

## Playing with friends (personal rounds)

A personal round can include up to 7 other players. Pick them from your leagues (registered: the round
shows up in their My rounds and they can score it too), find them by email, or add guests by name.
Each guest can get a link (`/g/<token>`, good for 3 days, a new one replaces the old) that opens just
that round with no sign-in. Group rounds are stored as soon as they start (`rounds.live = 1`); every
score is sent on its own (`json_set` on one hole) so people scoring at once don't overwrite each other,
and the card refreshes every few seconds. Scores entered offline wait on the phone and are sent later.

Handicaps typed into a round are only used for that round's game. Games (src/engine/games.ts): stroke
play, match play (2, or 2 v 2 best ball), Nassau, skins (with carry-over), Stableford, wolf (4 players)
and Las Vegas (2 v 2), each with a short how-to, and settled in points or dollars per point.

## Golf courses

Each week is played on one **nine** of the season's course, picked on the Schedule screen.

The course is chosen when a season is started (**Admin → + New season**). An admin can correct
or replace it at any time under Rules & course; every result is recalculated from the new
scorecard. **Find a course** searches [GolfCourseAPI](https://golfcourseapi.com) by
name. You pick the men's tees (which supply par, yardage and hole handicaps), the red tees (which
supply red-tee hole handicaps), and the front nine, back nine or both. The 18-hole stroke indexes
are re-ranked 1–9 within each nine, which is how the league's scoring uses them. Back nines show
holes 10–18 on scorecards.

- The API key stays on the server. The browser calls `/api/courses/*` (signed-in players and
  admins only, also used for personal rounds), which forwards to
  GolfCourseAPI and caches results at the edge (1 day for searches, 7 days for course details) to
  save the free daily quota.
- Course data is copied into the season when you add it, so later changes on the provider's side
  never alter past results. Fix any hole by hand in the same screen.
- Without `GOLF_COURSE_API_KEY`, everything else works and nines can be entered by hand.
- The provider client is [`functions/lib/courses.ts`](functions/lib/courses.ts). To use a
  different data source, change `searchCourses`/`getCourse` to return the same `CourseInfo` shape.

## Changing things

- **Rules or course changes:** use Admin → Rules & course. No code is needed.
- **A new scoring rule:** add a field to `Settings` in [`src/engine/types.ts`](src/engine/types.ts),
  use it in the engine, and add a test. The admin form lists the numeric settings in
  [`src/app/admin/Settings.tsx`](src/app/admin/Settings.tsx).
- **Database changes:** add the next `migrations/000N_*.sql`. Deploys apply it automatically.
- **Backups:** Admin → Seasons & data → Download backup gives a JSON file of the whole season. Import
  it on the same page. D1 also keeps 30 days of point-in-time recovery (`wrangler d1 time-travel`).

## Calendar subscription

Each member can subscribe to their league schedule from Leagues → *Golf on your calendar*. The app serves a
personal, secret URL `/api/calendar/<token>.ics` (iCalendar): one all-day event per scheduled week, in every
league the person belongs to, with their own matchup and tee time. It works in Apple Calendar, Google Calendar
and wall-calendar displays that accept an iCal/URL feed (ARZOPA, Skylight, Cozyla, etc.). The token (`users.calendar_token`,
migration 0009) is the only secret; "Make a new link" rotates it. Events fold to 75 octets with CRLF lines so
strict readers accept them.

## Push notifications

Free Web Push with VAPID (no Firebase). A content-less push wakes the service worker, which fetches the
queued notification from `/api/push/pending` and shows it — so no payload encryption, all on Cloudflare.
Members turn it on in **Profile → Notifications** (on iPhone the app must be added to the Home Screen and
opened from there, Safari 16.4+). Events: new message-board post, schedule shift / rain-out, your match
needs a card or scores were posted, a join request (to league admins), and a daily match-day reminder.

Setup (one time):
1. Generate a VAPID key pair and copy the JSON:
   `node -e 'const {webcrypto:w}=require("crypto");(async()=>{const k=await w.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign"]);console.log(JSON.stringify(await w.subtle.exportKey("jwk",k.privateKey)))})()'`
2. In the Pages project, set env vars: `VAPID_JWK` (the JSON above, as a secret), `VAPID_SUBJECT` (e.g. `mailto:you@example.com`).
3. For match-day reminders, set `CRON_SECRET` (any random string) as both a Pages env var and a GitHub repo secret;
   `.github/workflows/reminders.yml` calls `/api/cron/reminders` each morning.

Without `VAPID_JWK` set, notifications are simply queued (visible on next app open) but no push is sent.

## Keeping an eye on it

- **Uptime:** `GET /api/health` answers 200 (`{"ok":true}`) when the site and database work, 503 when the database
  doesn't. Point a free uptime monitor (UptimeRobot, Better Stack) at it every 5 minutes.
- **Usage:** Admin → Site (site admins): accounts, sign-ins, rounds, league activity, database size, recent changes.
  Cloudflare's Metrics pages (Workers & Pages → golf-league, and D1 → golf-league) show requests, errors and reads/writes.
- **Backups:** `.github/workflows/backup.yml` exports the database every Monday as a 90-day artifact (Actions → Backup).
  Restore into an empty database with `npx wrangler d1 execute golf-league --remote --file <backup>.sql`. D1 Time Travel
  covers the last 7 days too.
- **Updates:** `.github/dependabot.yml` opens weekly pull requests for npm packages (small updates grouped) and monthly
  ones for GitHub Actions. Turn on Dependabot alerts and security updates in Settings → Security.
- **Cost:** everything runs on free tiers (Workers 100k requests/day, D1 5M reads + 100k writes/day, 5 GB). Live group
  rounds are the heaviest use (each phone refreshes every 8 s, about 450 requests an hour). Workers Paid is $5/month.

## Data and privacy

Your league's real rosters, scores and accounts live only in your **D1 database** — never in this
repository. The only season file checked in is [`data/season-sample.json`](data/season-sample.json),
which is entirely fictional and used for demos and tests. If you export a real season to JSON, keep it
out of the repo (load it through the admin **Import** page, or seed it locally without committing it).

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup and the PR flow,
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit, and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Please report security issues privately per
[SECURITY.md](SECURITY.md). Never commit secrets or real league data.

## License

[MIT](LICENSE). Run it, change it, host it — just bring your own name, logo and API keys.
