# Handoff

Esports platform for Free Fire, BGMI and Valorant (docs/SPEC.md), built in phases 0–8 (docs/PHASES.md) and then rebuilt in a second run to match the fixed design in `docs/design/pages/home-desktop.png`. Every phase passed its acceptance checks locally. What could not be verified without your accounts is listed under "Needs from owner" and "Known limitations". Per-phase details are in docs/PROGRESS.md (run 2 starts at "# Run 2 — design reference"), every judgement call is in docs/DECISIONS.md, and conventions for future work are in CLAUDE.md.

**State at handoff:** 24 commits. `npm audit`: 0 vulnerabilities. gitleaks over the full history: no leaks. 659 Vitest tests (86.6% line coverage on `lib/` + `server/`), 66 Playwright tests, green in a fresh-clone CI dry run. Lighthouse mobile, local production build: accessibility, best practices and SEO are 100 on Home, Scrims and Leaderboard. **Performance is 80–92, below the 90 target on most runs** (see §5).

---

## 1. Run it locally

Prerequisites: Node 22 (≥ 20.19), Docker, Git.

```bash
# 1. Postgres (dev + test + e2e databases)
docker run -d --name esports-postgres -e POSTGRES_USER=esports -e POSTGRES_PASSWORD=esports_local \
  -e POSTGRES_DB=esports -p 5440:5432 --restart unless-stopped postgres:16-alpine
docker exec esports-postgres psql -U esports -d esports -c "CREATE DATABASE esports_test;" -c "CREATE DATABASE esports_e2e;"

# 2. Config
cp .env.example .env
#   set SESSION_SECRET (openssl rand -base64 48), CRON_SECRET (any random string),
#   ADMIN_PHONE=+91XXXXXXXXXX, and AUTH_OTP_STUB=true for local login without Firebase

# 3. Install, migrate, seed, run
npm install            # also runs prisma generate and copies design artwork
npm run db:deploy      # apply migrations
npm run db:seed        # admin (ADMIN_PHONE), a season per game, points tables, 6 sample matches
npm run dev            # http://localhost:3100
```

Log in at `/login` with the admin phone and code **123456** (the local OTP stub, shown on the login page). The admin panel is at `/admin`.

Without Cashfree/Supabase/VAPID keys the app uses local stand-ins: uploads go to `.uploads/`, paid entries open a local **Test checkout** page that sends a correctly signed webhook, and push notifications do nothing. Set `PAYMENTS_ENABLED=true` to try paid entry locally.

| Task | Command |
| --- | --- |
| Lint / typecheck | `npm run lint` / `npm run typecheck` |
| Unit + integration tests | `npm test` (coverage: `npm run test:coverage`); uses `TEST_DATABASE_URL` |
| E2E | `npm run test:e2e` builds and serves on :3101 against `E2E_DATABASE_URL`. If Playwright's browser download is blocked, set `E2E_CHANNEL=chrome` to use the installed Chrome. |
| New migration | `npm run db:migrate -- --name <name>` (see CLAUDE.md if it refuses to run non-interactively) |
| DB browser | `npm run db:studio` |
| Trigger crons locally | `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3100/api/cron/match-status` (also `payment-expiry`, `reconcile`, `season-end`) |
| Refresh artwork | `npm run sync-art` (also runs automatically before dev, build, typecheck and test) |

## 2. Deploy

The full guide is **docs/DEPLOY.md** and the launch checklist is **docs/LAUNCH.md**. In short:

1. Create a managed Postgres (Supabase or Neon), then run `npx prisma migrate deploy` and `npm run db:seed` against it with `ADMIN_PHONE` set.
2. Import the repo into Vercel and set the environment variables from DEPLOY.md §2 for Production and Preview (use separate databases and sandbox keys for Preview).
3. `vercel.json` already declares the four crons. The 5- and 10-minute ones need a **Vercel Pro** plan, or an external scheduler calling the URLs with `Authorization: Bearer $CRON_SECRET`.
4. Configure webhooks, uptime checks, Sentry and backups (DEPLOY.md §4–7).
5. Push the repo to GitHub so `.github/workflows/ci.yml` runs on every PR (lint, typecheck, tests with coverage, Playwright, `npm audit`, gitleaks).

---

## 3. Needs from owner: every item, with exact steps

### 3.1 Hosting and database (required)
1. **GitHub repository**: create an empty repo, then run `git remote add origin <url> && git push -u origin main`. CI starts automatically.
2. **Postgres**: in Supabase, go to New project → *Settings → Database*. Copy the **Transaction pooler** URL (port 6543, add `?pgbouncer=true`) as `DATABASE_URL` in Vercel, and keep the **direct** URL for running migrations from your machine. (On Neon, use the `-pooler` host for the app.) Turn on daily backups / PITR.
3. **Vercel**: *Add New → Project → Import* the repo. Set the env vars (DEPLOY.md §2). Upgrade to **Pro** for 5-minute crons.
4. **Secrets**: `SESSION_SECRET` = output of `openssl rand -base64 48`; `CRON_SECRET` = another random string. Use different values for Preview and Production.
5. **First admin**: set `ADMIN_PHONE=+91<your number>` and run `DATABASE_URL=<direct url> npm run db:seed` once. Appoint moderators later in Admin → Users → Role.

### 3.2 Firebase phone login (required; only the local stub has been tested)
1. Go to console.firebase.google.com → *Add project*.
2. Upgrade to **Blaze** (pay as you go) and add a **budget alert** (*Usage and billing → Details & settings → Create budget*). Phone Auth needs Blaze.
3. *Build → Authentication → Sign-in method → Phone → Enable*.
4. *Authentication → Settings → Authorized domains*: add your production domain and your Vercel preview domain.
5. *Phone numbers for testing*: add a few test numbers and codes for staff testing (no SMS is sent and abuse blocks don't apply).
6. *Project settings → General → Your apps → Add web app*: copy `apiKey`, `authDomain`, `projectId` and `appId` into `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID` and `NEXT_PUBLIC_FIREBASE_APP_ID`.
7. *Project settings → Service accounts → Generate new private key*: set `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL` and `FIREBASE_ADMIN_PRIVATE_KEY` (paste the key with the `\n` sequences exactly as they appear in the JSON).
8. Make sure `AUTH_OTP_STUB` is unset in Vercel. To test, log in on the Preview deployment with a Firebase test number, then with a real phone.

### 3.3 File storage (required for avatars and result screenshots)
1. In Supabase, go to *Storage → New bucket*, name it `uploads` and make it **Public**.
2. *Settings → API*: set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (server-only) in Vercel.
3. To test, upload an avatar on /profile of the Preview deployment.

### 3.4 Cashfree (only when you enable paid entry or prize payouts; not tested against Cashfree)
1. Get legal advice on real-money gaming in the states you serve (docs/SPEC.md "Money"). Record the decision, and keep `PAYMENTS_ENABLED=false` until then.
2. In merchant.cashfree.com → *Developers → API Keys*: use sandbox `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY` with `CASHFREE_ENV=sandbox` on Preview, and production keys with `CASHFREE_ENV=production` on Production.
3. *Developers → Webhooks* (Payment Gateway): add `https://<domain>/api/webhooks/cashfree` for payment and refund events.
4. In the Payouts dashboard → *Developers → API Keys*: set `CASHFREE_PAYOUTS_CLIENT_ID` / `CASHFREE_PAYOUTS_CLIENT_SECRET`. Under *Webhooks (v2)*, add `https://<domain>/api/webhooks/cashfree-payouts`. If Cashfree requires IP allow-listing for Payouts API calls, note that Vercel's outbound IPs are not fixed: use Vercel's Secure Compute or allow-list per Cashfree's guidance.
5. Optional: `PAYOUT_TWO_STEP_THRESHOLD_PAISE` (default ₹5,000).
6. On Preview (sandbox): pay an entry fee with Cashfree's test card/UPI and check that the registration turns Confirmed only after the webhook. Then cancel the match and check the refund, and add a UPI payout method and approve a small prize payout.

### 3.5 Push notifications
1. Run `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT=mailto:<your email>`.
2. On an Android phone in Chrome: open the site, register for a match, install the app from the dashboard card and tap "Enable notifications". Then trigger a notification (for example, confirm a registration from another account) and check that it arrives. This was **not** verified here (no device).

### 3.6 Monitoring
1. In sentry.io, create a Next.js project and set `NEXT_PUBLIC_SENTRY_DSN`. For readable stack traces, also set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT`. The browser SDK loads only when the DSN is set.
2. Add an uptime monitor on `https://<domain>/` and `https://<domain>/api/health` (a 503 means the database is down).

### 3.7 Design assets and brand
- **Artwork**: all files are delivered (§4); `trophy-podium.png` has no slot yet.
- **Partner logos**: the design's "Our Partners" row stays hidden until real logos exist. Add each partner in Admin → Content → Sponsors (name, logo URL, link). The row then appears in the footer on every page.
- **Brand name**: the site uses the placeholder **"Esports"** (`SITE_NAME` in `lib/site.ts`, decision R0.3). Change it there; the navbar wordmark, OG cards and the icon monogram follow automatically. The navbar shows `logo.png` followed by the name as text; `app-icon.png` is the PWA icon.
- **Scrims video**: paste a YouTube (or any https) link in Admin → Content → "Scrims page — How scrims work video link"; the "Watch Video" button on /scrims appears once it is set.
- **Social links**: set them in Admin → Content. "Watch Trailer" on the home hero appears once a YouTube link is set; the Follow Us icons become links.
- **Copy to confirm**: the hero keeps the design's "India's biggest" headline, which is a claim you should be able to stand behind. Two other lines were toned down to match what the platform does (R5.4).

### 3.8 Content and product decisions
- Write the rules and FAQ, and replace the terms/privacy/refund text with lawyer-reviewed copy (Admin → Content).
- Confirm or change the points table (seeded from the phase spec and stored in `PointsConfig`; edit via Prisma Studio until an admin editor exists).
- Answer the open questions in docs/SPEC.md and the per-phase questions in docs/PROGRESS.md, especially: the duo registration model (D3.1), team prizes paid to the captain (D6.7), refunds on self-cancel (D6.5), a third-place match in brackets (D5.4), and payouts for minors.

---

## 4. Artwork (`docs/design/assets/`)

**All 25 files are delivered and wired** (none missing). `scripts/sync-art.mjs` builds each `docs/design/assets/<name>.png` into responsive WebP variants plus a PNG fallback in `public/art/` and regenerates `lib/art-manifest.ts` (commit that file). To replace a file, overwrite the PNG and rebuild (`npm run dev` or `npm run build`); no code change is needed. A name that is removed falls back to the same-size placeholder.

| File | Where it appears |
| --- | --- |
| `hero-freefire.png`, `hero-bgmi.png`, `hero-valorant.png` | Home hero character panels (over the matching `bg-*`, pinned to the top, legs cut by the panel edge); `hero-freefire` also on the left of the /scrims banner and `hero-valorant` in its "How scrims work?" card |
| `bg-freefire.png`, `bg-bgmi.png`, `bg-valorant.png` | Behind each hero character |
| `banner-freefire.png`, `banner-bgmi.png`, `banner-valorant.png` | Game strip cards (home, /scrims game filter, /games, /leaderboard, /tournament) |
| `card-match-freefire.png`, `card-match-bgmi.png`, `card-match-valorant.png` | Right 40% of every match card and the match page hero |
| `card-tournament-freefire.png`, `card-tournament-bgmi.png`, `card-tournament-valorant.png` | Right 40% of This Week's Tournaments / Last Week's Winners cards and the tournament page hero |
| `empty-no-matches.png`, `empty-no-team.png`, `empty-no-notifications.png`, `empty-profile.png` | Empty states |
| `empty-offline.png` | Offline page (cached by the service worker) |
| `trophy-podium.png` | Delivered, not placed yet (no slot on the current pages) |
| `logo.png` | Navbar and footer mark (trimmed at build, blended into the dark UI) followed by the text wordmark |
| `app-icon.png` | PWA icons, favicon, Apple touch icon (clipped to a rounded square) |
| `og-background.png` | Background of every social share image |
| `texture-dark.png` | Full-page background texture |

Game logos, characters and partner logos were never drawn or generated. Game names are styled text, and the partners row stays hidden until real logos are added.

---

## 5. Known limitations

- **Lighthouse mobile performance is below 90 on most runs**: Home 83–87, Scrims 86–88, Leaderboard 80–92 (accessibility, best practices and SEO are 100). The unchanged pre-redesign build now scores 87–92 on the same machine (it scored 92–94 when first measured), so part of the gap is measurement drift. The rest comes from the second heading font the design requires (Barlow Condensed 700 + 800 next to Inter) and the denser home page. Several optimisations already went in; see Phase 5 (run 2) in PROGRESS.md. With the real artwork (LCP is now an image), the latest medians are Home 83 / Scrims 84 over local HTTP/1.1 and 88 / 91 over HTTP/2 ("Artwork — design assets wired" in PROGRESS.md). Measure with PageSpeed Insights against the preview deployment before optimising further.
- **Third-party integrations are implemented but unverified against the real services**: Firebase Phone Auth, Supabase Storage, Cashfree PG / Refunds / Payouts, Web Push delivery and Sentry. Each has a local stub that was used for all tests; the real code paths follow the SDK types and Cashfree's docs.
- **CI has never run on GitHub** (there is no remote) and there is **no preview deployment**. An identical local dry run from a fresh clone passed (66/66 Playwright, 659 Vitest).
- **Design deviations, all recorded in DECISIONS.md**: social icons are generic lucide icons with labels (lucide has no brand icons, R0.5); hero stats show real numbers and hide zeros (R5.1); the winners carousel and "How It Works", which the design doesn't show, sit between the leaderboard block and "Why Play" (R5.2); leaderboard tabs are the shared game chips under the navbar on leaderboard pages (R4.1); dark theme only (R0.1).
- **Social images** use Barlow Condensed for all text. The ₹ sign falls back to Geist because Barlow has no rupee glyph (R7.1).
- **Lighthouse PWA** category no longer exists in Lighthouse 12; installability was checked by hand (manifest, icons, service worker registration).
- **Duo matches** register players individually; partners pair up in the lobby (D3.1).
- **Paid squads**: the captain pays after all members confirm, within 10 minutes (D6.6).
- **Valorant brackets**: single elimination with exactly 8 or 16 teams, no byes, no third-place match; next-round times default to +90 minutes (the admin can edit them).
- **WhatsApp/SMS reminders** only log to the console (the `NotificationChannel` interface is ready for a provider).
- **Rate limits** are Postgres-backed fixed windows: fine for launch traffic, but not a DDoS shield (use Vercel's firewall for that).
- **Points table** has no admin UI yet (use Prisma Studio or SQL).
- **Tournament match registrations** are copied from the sign-up list; a roster change after "Lock entries" needs an admin to edit registrations.
- **Soft 404s** are avoided on detail pages. List pages with skeletons would return 200 for errors thrown after streaming starts (they cannot 404).
- Lighthouse SEO can flag `meta-description` on pages using `generateMetadata`, because Next 16 streams metadata into `<body>`; crawlers still receive it (D5.10).

## 6. Next five improvements (recommended order)

1. **Wire and verify the real providers on a Preview deployment**: Firebase test numbers, the Supabase bucket, Cashfree sandbox (payment → webhook → refund, beneficiary → transfer → webhook) and VAPID push on Android. Then add a small Playwright suite that runs against the preview URL in CI after each deploy.
2. **Bring mobile performance consistently above 90**: measure with PageSpeed Insights on the preview URL. Then self-host a subsetted Barlow Condensed (a single variable file instead of two weights), keep the three hidden leaderboard tables out of the initial HTML (render the active tab only and fetch others on demand), and set a JS budget check in CI.
3. **Admin editor for the points table and season prizes** (placement table, kill points and multipliers per game, with an audit log), plus a "results import" helper that pre-fills placements from multiple uploaded screenshots.
4. **WhatsApp reminders via a provider** (WhatsApp Cloud API or MSG91 with DLT templates) behind the existing `NotificationChannel`, with per-player opt-in in notification settings.
5. **Bracket and anti-cheat tooling**: byes for entry counts that aren't powers of two, a third-place match, and per-round scheduling in the admin UI; plus a moderator queue for suspicious results (same device/IP clusters, repeated disputes) and CSV export of payouts for accounting.
