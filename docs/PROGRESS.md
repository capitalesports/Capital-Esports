# Progress log

Each phase starts with a short plan, followed by the outcome once the phase's acceptance section has been verified.

## Phase 0

### Plan

- Scaffold Next.js 16 (App Router, TS strict, Tailwind v4) + shadcn/ui (Radix base).
- Tooling: ESLint (flat config from create-next-app), Prettier, Husky pre-commit running lint + typecheck. Scripts: dev, build, lint, typecheck, test, test:e2e (+ helpers).
- `.env.example` covering every variable used across all phases.
- `CLAUDE.md` with stack, folder conventions, coding rules and commands.
- Base layout: responsive navbar (Home, Scrims, Tournament, Leaderboard, Login/Profile) with a game switcher, footer with social link placeholders, dark theme by default, design tokens file.
- A placeholder page for every route in the spec so navigation works end to end.
- Vitest + Playwright wired up with a smoke test (every route renders).
- Local Postgres (Docker, port 5440) started for later phases; no DB logic yet.

### Outcome — PASSED

Acceptance checks (all run locally):

- `npm run lint` — pass (0 warnings). `npm run typecheck` — pass. `npm run build` — pass (32 routes).
- `npm test` — 3 files, 11 tests pass (games config, nav/game switcher, admin role sections).
- `npm run test:e2e` — 19 Playwright tests pass on a Pixel 7 viewport: every public route returns 200 with an `<h1>`, unknown game slug 404s, mobile menu navigation, game switcher filter, dark theme default. Dashboard, profile, teams and all 11 `/admin/*` routes also checked with curl against `next start` (all 200).
- CLAUDE.md and .env.example exist; first commit made.

What was built:

- Next.js 16.3 + Tailwind v4 + shadcn/ui scaffold; ESLint, Prettier (+ tailwind plugin), Husky pre-commit (lint + typecheck); scripts dev/build/start/lint/typecheck/test/test:coverage/test:e2e/format.
- Design tokens in `app/tokens.css` (dark palette default, light palette, per-game accents, 44px tap token, page gutter); `lib/games.ts` (per-game config from the spec), `lib/nav.ts`, `lib/admin-nav.ts`, `lib/site.ts`.
- Layout: sticky header with nav + Login button, mobile sheet menu, game switcher on Scrims/Tournament/Leaderboard, footer with social placeholders and legal links, skip link, 404 page, admin shell with section nav.
- Placeholder pages for every route in the spec, including all admin sections.

Decisions: D0.1–D0.10 in docs/DECISIONS.md.

Skipped / stubbed: no auth or DB logic (per phase instructions). Local Postgres container created for Phase 1.

Questions for owner: product name (placeholder "ArenaX").

## Phase 1

### Plan

- Prisma 7 schema with every model from the phase (User, GameProfile, Team/TeamMember, Match, Registration (+ per-match roster rows), Result, Season, PointsEntry, Tournament, Payment/Payout stubs, Ban, AuditLog) plus a RateLimit table; one migration; `server/db.ts` singleton with the pg adapter.
- Session: HS256 JWT (jose) in an httpOnly `session` cookie, 7 days, rolling re-issue from `proxy.ts`; user reloaded from DB on every request so bans/role changes apply immediately.
- OTP: `OtpVerifier` interface → Firebase Admin `verifyIdToken` when admin creds exist, otherwise a local stub (only when `AUTH_OTP_STUB=true`, never on Vercel production). Client: Firebase `signInWithPhoneNumber` + invisible reCAPTCHA when client config exists, otherwise a stub that accepts code 123456 (mirrors Firebase test numbers).
- `POST /api/auth/session` (same-origin check, Zod, per-phone + per-IP DB rate limit, ban check), `POST /api/auth/logout`.
- `proxy.ts` protects /dashboard, /profile, /teams, /admin with `returnTo`; server-side guards (`requireUser/requireModerator/requireAdmin`) for every mutation.
- /profile: name, DOB, avatar (2 MB, image magic bytes, storage interface: Supabase Storage or local disk stub), per-game ID sections with validators (FF UID, BGMI ID + IGN, Riot ID Name#Tag + region); uniqueness across users; banned game IDs refused.
- `isProfileComplete` computed helper; seed script (admin, seasons, 6 matches).
- Tests: Vitest unit (isProfileComplete, validators, session signing, role helpers) + DB integration (session creation, bans, profile uniqueness); Playwright login → session persists → profile saves.

### Outcome — PASSED (Firebase itself verified only via the stub; see below)

Acceptance checks (all run locally):

- `prisma migrate dev` created and applied `20260927074829_init` (one migration, every Phase 1 model). `npm run db:seed` is idempotent (admin +919999900001, 3 seasons, 6 matches over the next 3 days in IST).
- `npm run lint`, `npm run typecheck`, `npm run build` — pass.
- `npm test` — 11 files / 108 tests pass (unit: validators incl. Riot ID, isProfileComplete, session signing/tamper/expiry/rolling, role helpers, image magic bytes, bans, IST helpers; integration on real Postgres: session route incl. CSRF + per-IP 429, login/ban/merged/phone-ban/per-phone rate limit, profile validation + role checks, cross-user game-ID uniqueness incl. case-insensitive Riot IDs, banned game IDs, avatar magic bytes + size, guards reading roles/bans from the DB).
- Coverage (lib/ + server/): **80.8% lines**, 79.6% statements, 79.4% branches.
- `npm run test:e2e` — 27 Playwright tests pass, including: protected routes redirect with returnTo; wrong OTP → generic error + 30 s resend cooldown; new player logs in → profile → saves name/DOB/FF UID → reload keeps the session; duplicate FF UID refused for a second user; banned user cannot log in; logout; players get 404 on /admin; seeded admin reaches /admin.

Honest limits of verification:

- "OTP login works with Firebase test numbers" was verified with the **local OTP stub**, not with Firebase, because no Firebase credentials exist in `.env`. The Firebase client (`signInWithPhoneNumber` + invisible reCAPTCHA) and server (`verifyIdToken`, revocation + auth_time checks) code paths are implemented but unexercised. Owner must add Firebase keys and test with a Firebase test phone number (see HANDOFF).
- Avatar storage verified with the local-disk stub; Supabase Storage path unexercised (no credentials).

What was built: Prisma schema + client (`server/db.ts`), session JWT + rolling cookie in `proxy.ts`, OTP verifier/client interfaces (Firebase + stub), `/api/auth/session` + `/api/auth/logout`, DB-backed rate limiter, audit-log helper, `requireUser/requireModerator/requireAdmin` guards + pure `assert*` role helpers, `/login` (phone + OTP, cooldown, generic errors), `/profile` (details, avatar, per-game IDs), header shows the logged-in user, admin layout/pages restricted to staff with per-section role checks, seed script, test infra (Vitest unit/integration projects, e2e DB + global setup).

Decisions: D1.1–D1.15.

Needs from owner (also in HANDOFF): Firebase project (Blaze plan) with Phone Auth + test numbers, web app config (`NEXT_PUBLIC_FIREBASE_*`), service account (`FIREBASE_ADMIN_*`); Supabase Storage bucket + service role key; `ADMIN_PHONE`; `SESSION_SECRET`.

Questions for owner: minimum age for accounts (currently 10+); whether non-Indian phone numbers should be allowed (currently yes, +91 default).

## Phase 2

### Plan

- `lib/match-state.ts`: the spec's state machine as data (+ documented cancel extensions), labels, time-based "due" transitions for cron.
- `lib/match-schema.ts` + `lib/money.ts`: Zod match form schema (IST input → UTC, INR → paise, mode/slots valid per game).
- Services (all Zod-validated, role-checked, audited): matches (create/edit/clone/bulk clone/transition/room credentials/cancel → registrations CANCELLED + refund queue stub), users (search, ban/unban with Ban rows for phone + game IDs, reset game profile, merge duplicates, change role), teams (remove member, transfer captain), content (rules/FAQ/legal markdown, sponsors, social links, carousel items), audit log queries.
- Cron route `/api/cron/match-status` (Bearer `CRON_SECRET`, idempotent conditional updates) + `vercel.json` entry every 5 minutes.
- Admin UI: dashboard, matches list with filters + quick actions, create/edit form (IST), detail with status controls, room credentials, clone; users search/detail; teams; content editor; audit log with filters. Moderators see Matches/Results/Teams/Reports only.
- New models (one migration): SiteContent, Sponsor, SocialLink, CarouselItem. Footer reads social links from the DB.
- Tests: state machine (every legal + illegal pair), cron idempotency + full lifecycle, role guards for every admin service/route, audit rows for every mutation; Playwright admin flow (create → clone ×3 → open → room creds → cancel) and moderator blocked from Users/Content.

### Outcome — PASSED

Acceptance checks (all run locally):

- "An admin can create a scrim, clone it for 3 days, open registration, set room credentials, and cancel one" — Playwright `e2e/admin-matches.spec.ts` drives exactly this through the UI and checks the list shows 4 copies, the cancel reason, and the audit log page.
- "A moderator cannot reach Users or Content" — Playwright: moderator's nav has no Users/Content; `/admin/users`, `/admin/content`, `/admin/audit` return 404; `/admin/matches` 200. Unit test asserts every `app/admin/**/page.tsx` calls `requireStaffPage` and every admin action calls `requireModerator/requireAdmin`.
- "Cron transitions move a test match through every state" — integration `cron.test.ts`: UPCOMING → OPEN → CLOSED → LIVE → RESULTS_PENDING at the right instants (per-game durations), catch-up of an overdue match, rerun idempotency, two overlapping runs apply each transition once, route requires `CRON_SECRET`.
- "All mutations appear in the audit log" — every service writes `AuditLog` (tests assert rows for create/update/clone/status/room credentials/cancel, ban/unban/reset/role/merge, team member removal/captain transfer, content/sponsors/carousel/social links); room credentials are redacted.
- State machine: all 49 from→to pairs tested (9 legal, 40 illegal).
- `npm run lint`, `npm run typecheck`, `npm run build` — pass. `npm test` — 18 files / 267 tests pass. `npm run test:e2e` — 29 pass.
- Coverage (lib/ + server/): **86.7% lines**, 84.4% statements, 77.6% branches.

What was built: match state machine + form schema + INR/paise helpers; services for matches (create/edit/clone/bulk clone/status/room credentials/cancel with refund queue stub), users (search, detail, ban/unban with Ban rows, reset game profile, role change, merge), teams (remove member, transfer captain), content (markdown pages, sponsors, social links, carousel), audit log queries; cron job + route + `vercel.json`; admin UI (dashboard, matches list/filters/new/edit/detail with controls, users search/detail, teams, content editor, audit log with filters + pagination); footer reads social links from the DB; `/api/health`.

Skipped / stubbed: refunds on cancel are a no-op stub (`server/services/refunds.ts`) until Phase 6. Results link on the match page points to Phase 4's screen.

Decisions: D2.1–D2.13.

Needs from owner: `CRON_SECRET` in Vercel; note Vercel **Hobby** plans only run cron jobs once a day — the 5-minute schedule needs **Pro** (or an external scheduler hitting `/api/cron/match-status` with the bearer secret).

## Phase 3

### Plan

- `lib/registration-rules.ts` (pure): who may register/cancel, CONFIRMED vs WAITLISTED, room-credential reveal window, button state for cards.
- `server/services/registration.ts`: register (solo/duo directly; squad/5v5 by captain with a chosen roster), roster confirm/decline, cancel, waitlist promotion — every mutation in one transaction holding `SELECT … FOR UPDATE` on the match row. Paid matches blocked ("payments coming soon"). Closing registration cancels squads that never fully confirmed.
- `server/services/teams.ts`: create team, invite by game ID, accept/decline, leave, captain removes members / hands over captaincy; one confirmed team per game.
- Room credentials only via `GET /api/matches/[id]/room` (no-store) for confirmed players from `startsAt − 15 min` while REGISTRATION_CLOSED/LIVE; public queries use an explicit select without credential columns.
- Pages: /scrims (today + 3 days grouped by IST day, game + mode filters), /scrims/[id] (details, rules snippet, count, stream, registration panel, reveal countdown), /games/[game], /teams, /dashboard (upcoming with reveal, roster invites, history, teams, strikes, points).
- Notification hook stub (`server/services/notify.ts`) called on confirm/promotion, implemented in Phase 7.
- Tests: rules + waitlist promotion, two users racing for the last slot, credentials absent from every public response before the window, squad confirms, Playwright login → profile → register → credentials after reveal.

### Outcome — PASSED

Acceptance checks (all run locally):

- "Registering without a profile redirects correctly" — Playwright: a new player opening a match sees "Before registering, add your display name, date of birth, Free Fire UID" and "Complete profile" lands on `/profile?returnTo=/scrims/<id>&missing=…` with the message; the server also refuses with `PROFILE_INCOMPLETE` naming the missing game ID (integration).
- "The slot race yields one CONFIRMED and one WAITLISTED" — integration: two players register concurrently for the last slot, 5 rounds, always exactly one of each and never more confirmed than `maxSlots`.
- "Cancelling promotes the waitlist" — integration for solo and squads (first by position; cancelling from the waitlist promotes nobody).
- "Room credentials are absent before the reveal window and present after" — integration covers every rule (confirmed only, ≥ start − 15 min, closed/live only, roster members, ended) and asserts public queries + the room endpoint (anonymous, confirmed, waitlisted, outsider) never contain them before the window, with `no-store`; Playwright checks the HTML of /scrims, /scrims/[id], /dashboard, /games/free-fire and the API before the window, then shows them on the match page and dashboard after the match moves into the window; anonymous API call gets 401.
- "A squad registers only once every member confirms" — integration (PENDING → CONFIRMED on the last confirm; WAITLISTED when full; decline cancels; closing registration drops incomplete squads; Valorant needs 5) and a Playwright flow: captain creates a team, invites 3 players by BGMI ID, they accept, captain registers, members confirm one by one, status flips to confirmed only after the third.
- `npm run lint`, `npm run typecheck`, `npm run build` — pass. `npm test` — 22 files / 308 tests. `npm run test:e2e` — 33 pass.
- Coverage (lib/ + server/): **86.1% lines**, 83.7% statements, 76.4% branches.

What was built: registration rules (pure), registration service (solo/duo, squad rosters, confirm/decline, cancel, waitlist promotion, close-time cleanup), room credential service + no-store API, teams service (create, invite by game ID, accept/decline, leave, remove, captaincy), public match queries without credential columns, /scrims (grouped by IST day, game + mode filters), /scrims/[id] (details, rules snippet, stream link, registration panel, room countdown panel), /teams, /dashboard (upcoming + reveal, invites needing an answer, points per game, teams, strikes, history), /games/[game] (scrims, tournament summary, top 10), markdown renderer.

Skipped / stubbed: notification delivery (Phase 7); paid matches show "Payments coming soon" and cannot be joined (Phase 6); leaderboard top 10 is a simple sum until Phase 4's cached board.

Decisions: D3.1–D3.10.

Questions for owner: are duos really "register individually and pair in the lobby" (D3.1), or should a player register with a named partner? (Spec open question "Squad-only scrims, or solo and duo lobbies too?")

## Phase 4

### Plan

- Schema (one migration): `PointsConfig` (per game: placement table, kill points, win/loss points, tournament multiplier), `LeaderboardSnapshot` (cached standings per season, refreshed on approve/reopen/rollover), `SeasonResult` (final top 3), `Report` (player/result reports + disputes).
- `lib/points.ts` (pure): placement + kill points, Valorant win/loss, tournament multiplier, team propagation to every confirmed roster player, standings with per-game tiebreakers (BR: points → wins → kills → earlier achievement; Valorant: points → wins → round difference).
- Results service: confirmed registrant/captain submits one screenshot (≤ 5 MB, magic bytes) + placement/kills (BR) or win + optional tracker link (Valorant); moderator edits rows (conflicts flagged), approves (one transaction: PointsEntry rows, NO_SHOW + strikes, 3 strikes → 7-day registration block, COMPLETED, audit, snapshot refresh); reopen within 2 h (admins any time) reverses points and no-show strikes.
- Seasons: season-end cron (daily) archives the board, stores top 3, creates the next 3-month season, resets strikes; admin start/end season + CSV export.
- Pages: /leaderboard/[game] (paginated 50, tiebreaker columns, past seasons + champions), /leaderboard/[game]/seasons/[id], result submission + results table on the match page, public player page with Report button, /admin/results list + /admin/results/[matchId], /admin/seasons, /admin/reports.
- Tests: points table, ties, team propagation, reversal on reopen, strike accumulation, season rollover; Playwright admin approves result → leaderboard updates.

### Outcome — PASSED

Acceptance checks (all run locally):

- "Approving a seeded match updates the leaderboard immediately" — Playwright `results-leaderboard.spec.ts`: on the seeded "Free Fire Solo Rush" (moved to results pending with 3 players) a player submits placement/kills + screenshot, the admin sees the screenshot, a placement conflict is highlighted and blocks approval, admin fixes it and approves; `/leaderboard/free-fire` immediately shows 21 and 13 points in order, the no-show is absent and has 1 strike, the match page shows results.
- "Reopening removes the points" — same Playwright flow reopens: leaderboard empty and the strike reverted; integration test also re-approves after edits.
- "A player with 3 strikes cannot register but can log in" — integration: three no-show approvals → strikes 3, block ≈7 days, `registerForMatch` FORBIDDEN, `loginWithVerifiedPhone` succeeds.
- "Season rollover preserves history" — integration: rollover archives, stores top 3, creates Season 2 starting at the old end for 3 months, resets strikes, old standings still browsable, idempotent on rerun.
- Points engine unit tests: every placement in the table, kills, tournament ×2, Valorant 3/0, custom tables, team propagation, ties (wins → kills → earlier achievement; Valorant wins → round diff; shared ranks), dispute window.
- `npm run lint`, `npm run typecheck`, `npm run build` — pass. `npm test` — 25 files / 358 tests. `npm run test:e2e` — 34 pass.
- Coverage (lib/ + server/): **87.0% lines**, 84.6% statements, 75.6% branches.

What was built: PointsConfig/LeaderboardSnapshot/SeasonResult/Report models (+ seeded points tables), pure points engine, results service (submit with screenshot/tracker link, moderator edit, approve, reopen), leaderboard service (snapshot refresh, paginated standings, past seasons, player standing), seasons service (rollover job, end/start, CSV export), reports service, cron `/api/cron/season-end` (daily; also prunes rate-limit rows), pages: /leaderboard/[game] (50/page, tiebreak columns, past seasons & champions), season archive page, /players/[id] with Report, match page result submission + results table + dispute/report, /admin/results + editor, /admin/seasons, /admin/reports.

Skipped / stubbed: notifications for results/disputes go through the Phase 7 hook (no-op now). No admin UI yet to edit the points table (values live in `PointsConfig`, seeded from the spec; editable via Prisma Studio) — see HANDOFF improvements.

Decisions: D4.1–D4.13.

Questions for owner: exact placement/kill values per game (open question; seeded with the phase's table); should squad kills be entered per player instead of as a team total?

## Phase 5

### Plan

- Schema: Tournament gets `startsAt`, `bracketSize`, `entryMatchId` (its sign-up list), `winnersPublishedAt`; Match gets `isEntryList`, `bracketRound`, `bracketIndex`; new `ContactMessage`.
- Tournament registration reuses Phase 3 exactly: each tournament has an **entry-list match** (kind TOURNAMENT, never played) that teams register for with the normal panel, roster confirmations and waitlist.
- LOBBY_POINTS (Free Fire, BGMI): admin adds N linked lobby matches; "Lock entries" copies the confirmed entries (with rosters) into every lobby match; standings = sum of tournament points across the linked matches (pure `lib/tournament.ts`).
- BRACKET (Valorant): "Generate bracket" seeds exactly 8 or 16 confirmed teams into round 1 (1v8, 4v5, …); when results for a bracket match are approved, the winner advances automatically and the next-round match is created once both feeders are decided.
- Publish winners: top 3 (standings or bracket), prizes, stored on the tournament and turned into a home carousel item automatically.
- Pages: /tournament/[game] (current week, registration, rules, prize pool, standings or bracket, stream embed), /tournament/[game]/past, admin /admin/tournaments (+ detail), Home (hero, game cards with today's count, winners carousel, today's strip, how it works, sponsors, socials), /rules, /faq, /terms, /privacy, /refund-policy from admin content, /contact form → ContactMessage.
- Design pass: skeleton `loading.tsx` on data routes, empty states with CTAs, 44 px targets, per-game accents; Lighthouse mobile check.
- Tests: bracket generation/advancement (8 and 16), lobby standings; integration for tournament services; Playwright carousel (auto-advance, pause on hover, dots) + tournament flows.

### Outcome — PASSED

Acceptance checks (all run locally):

- "A BGMI lobby-points tournament with 3 linked matches shows correct cumulative standings" — integration (services end to end: create → 3 squads → add 3 lobby matches → lock entries → moderator results → approve ×3 → standings Alpha 104 / Bravo 102 / Charlie 84, 36 season PointsEntry rows) and Playwright (admin creates the tournament and lobby matches and locks entries through the UI; `/tournament/bgmi` shows the same totals).
- "A Valorant 8-team bracket advances winners automatically" — integration: 7 teams → generation refused (needs exactly 8) → 8th team → round 1 seeded 1v8, 4v5, 2v7, 3v6; approving both quarterfinals of a pair creates the semifinal with the winners; semis → final → champion; publishing refused until every match is complete; podium S1/S2/S3. Playwright checks the bracket renders (Quarterfinals/Semifinals/Final) after generating it from the admin UI.
- "Publishing winners updates the home carousel" — integration (card created once, updated on republish) + Playwright (card "Alpha won E2E BGMI Weekly · 2nd: Bravo · 3rd: Charlie" on /).
- "Carousel rotation and pause behave as specified" — Playwright with a fake clock: no change at 6.5 s, advances at 7 s and again 7 s later; hover pauses (20 s without change) and resumes; dots/arrows navigate and set `aria-current`; reduced motion never auto-advances.
- "All static pages render from admin-editable content" — Playwright edits FAQ and BGMI rules in the DB and sees them on /faq and /rules; /terms, /privacy, /refund-policy render; the contact form submits and stores a message.
- Lighthouse mobile (local production build, installed Chrome): performance Home 94, /scrims 95, /leaderboard/free-fire 94, /leaderboard/bgmi 94, /tournament/bgmi 94, /games/bgmi 92, /rules 96; accessibility 100 and best-practices 100 everywhere; SEO 100 except /tournament/bgmi 90 (streamed-metadata false negative, D5.10). CLS 0 everywhere after the skeleton fix.
- `npm run lint`, `npm run typecheck`, `npm run build` — pass. `npm test` — 28 files / 379 tests. `npm run test:e2e` — 41 pass.
- Coverage (lib/ + server/): **87.5% lines**, 85.1% statements, 75.3% branches.

What was built: tournament model extensions + ContactMessage; `lib/tournament.ts` (IST week, lobby standings, seeding, advancement, podium); tournament services (create with sign-up list, edit, add lobby matches, lock entries, generate bracket, auto-advance on approval, publish winners → carousel) and queries; /admin/tournaments (+ detail: forms, sign-ups, schedule/bracket, standings); public /tournament/[game] (hero, registration panel, standings or bracket, schedule, rules, stream embed, winners, sponsors) and /past archive; Home (hero, winners carousel, game cards with today's counts, today's strip, how it works, sponsors, community links); /rules with game tabs; FAQ/terms/privacy/refund from content with starter text; /contact form (+ admin inbox); skeleton loaders; soft-404 fixes; per-game accents on game/tournament pages.

Skipped / stubbed: none within this phase's scope. Tournament prize payouts are Phase 6.

Decisions: D5.1–D5.11.

Questions for owner: who hosts Valorant custom lobbies (open question)? Is "3rd place = better semifinal loser by round difference" acceptable, or do you want a third-place match?

## Phase 6

### Plan

- Schema: complete `Payment` (orderId, registrationId, amountPaise, INR, CREATED/PAID/FAILED/REFUND_PENDING/REFUNDED, rawWebhook, paidAt, expiresAt, refund fields) and `Payout` (tournament/season, place, amount, UPI/BANK, beneficiaryId, transferId, PENDING/PROCESSING/SUCCESS/FAILED/REVERSED, rawResponse, first + second approver); new `PayoutMethod` (masked details only), `WebhookEvent` (dedupe log), `ReconciliationFlag`.
- Providers behind interfaces: `PaymentGateway` (Cashfree PG via the official `cashfree-pg` SDK) and `PayoutGateway` (Cashfree Payouts v2 REST — the official payouts SDK is unmaintained and pins a vulnerable axios), each with a local stub when credentials are missing (never in production).
- Webhook signature: base64(HMAC-SHA256(secret, timestamp + rawBody)), timing-safe compare; routes `/api/webhooks/cashfree` (PG: payment success/failed/dropped, refunds) and `/api/webhooks/cashfree-payouts`; idempotent by event key and by status transitions.
- Entry fees: registering for a paid match (PAYMENTS_ENABLED=true) → PENDING_PAYMENT holding the slot + Payment CREATED + Cashfree order → client checkout; only the webhook confirms; return page polls our own status. Expiry cron (10 min) frees unpaid slots (after re-checking the order with Cashfree). Late success with no slot → WAITLISTED + automatic refund. Cancelling a match refunds every PAID payment.
- Payouts: payout method on /profile (UPI or bank + IFSC, validated; under-18 blocked with a guardian message; registered as a Cashfree beneficiary), admin ledger `/admin/payouts` built from published tournament winners and season prizes; Approve triggers the transfer; two admins required above `PAYOUT_TWO_STEP_THRESHOLD_PAISE`; webhook updates status.
- Nightly reconciliation cron compares open payments/refunds/transfers with Cashfree and flags mismatches.
- Tests: signature valid/tampered, webhook replay idempotency (no double confirm / double pay), refund transitions, UPI/IFSC validators, expiry job, role checks; Playwright paid registration confirmed only after a (stub-sandbox) signed webhook.

### Outcome — PASSED against the local payment stubs; Cashfree sandbox itself not exercised (no credentials)

Acceptance checks (all run locally):

- "Sandbox payment confirms a registration only via webhook" — Playwright: "Register and pay ₹50" holds the slot as PENDING_PAYMENT and opens checkout; the registration stays unconfirmed until the checkout emits a **signed** webhook through the real `/api/webhooks/cashfree` handler; the return page polls our own order status and shows "confirmed"; an abandoned checkout stays unconfirmed; the order-status endpoint is private. Integration: redirect alone changes nothing; tampered payload/timestamp/signature or wrong secret → 401 and no state change.
- "A dropped payment expires and frees the slot" — integration: expiry job after 10 min cancels the registration, fails the payment, promotes the next waitlisted player into a new 10-minute payment window; re-checks Cashfree first and confirms instead if the order was actually paid.
- "Cancelling a paid match refunds every PAID registration" — integration: 2 paid + 1 unpaid → 2 REFUND_PENDING (+1 FAILED), refund webhooks → REFUNDED; late success after losing the slot → WAITLISTED + automatic refund.
- "A sandbox payout marks SUCCESS via webhook" — integration: approve → PROCESSING with a transfer id → signed `TRANSFER_SUCCESS` → SUCCESS.
- "Webhook replay does not double-confirm or double-pay" — integration: identical replays return DUPLICATE (event log), different deliveries for an already-applied order/transfer return IGNORED (state machine); exactly one `payment.paid` / `payout.success` audit row; re-approving an in-flight payout is refused.
- Also covered: two-admin approval above the threshold (same admin refused), minors blocked from payout methods, UPI/IFSC/bank validators, masked storage (full account number never stored), season prizes, nightly reconciliation (missed payments, refunds, transfers flagged and applied), role checks on every payout mutation.
- `npm run lint`, `npm run typecheck`, `npm run build` — pass. `npm test` — 32 files / 433 tests. `npm run test:e2e` — 44 pass.
- Coverage (lib/ + server/): **86.4% lines**, 83.6% statements, 73.2% branches.

What was built: Payment/Payout/PayoutMethod/WebhookEvent/ReconciliationFlag models; `PaymentGateway` (Cashfree PG via `cashfree-pg` with error analytics disabled) and `PayoutGateway` (Cashfree Payouts v2 REST) with local stubs; timing-safe webhook verification; PG + payouts webhook routes; paid registration (solo, squad on completion, waitlist promotion), checkout (Cashfree JS SDK or local test checkout), return page polling our status, refunds on cancel/self-cancel/late payment, expiry cron (10 min), reconciliation cron (nightly), payout method on /profile, admin ledger with sync from published winners, season prizes, one/two-step approval, reconciliation flags; `vercel.json` crons.

Honest limits: the Cashfree calls (create order, fetch order, refunds, beneficiary, transfer, status) are implemented against the SDK types and Cashfree's docs but were **not run against the Cashfree sandbox** — no keys in `.env`. All flows were verified with the local stubs that emit correctly signed Cashfree-shaped webhooks through the real handlers.

Decisions: D6.1–D6.10.

Needs from owner: Cashfree PG app id + secret (sandbox first), Payouts client id + secret, webhook URLs configured in both dashboards (`/api/webhooks/cashfree`, `/api/webhooks/cashfree-payouts`), Payouts IP allow-listing if enabled, legal review before setting `PAYMENTS_ENABLED=true`.

Questions for owner: refund on player self-cancel of a paid entry (currently yes, D6.5)? Team prizes paid to the captain (D6.7) or split per player?

## Phase 7

### Plan

- Schema: `Notification` (userId, type, title, body, url, readAt), `PushSubscription` (per device), `User.pushOptIn`, match flags `reminderSentAt` / `roomNoticeSentAt`, `AnalyticsEvent` (page views + funnel steps, no IPs, no cookies).
- `lib/notifications.ts` (pure): every event → in-app title/body/url. `server/services/notify.ts` writes the inbox rows and fans out to channels: Web Push (VAPID via `web-push`; console stub without keys) and a `NotificationChannel` interface for WhatsApp/SMS with a console implementation.
- Reminder job (in the 5-minute cron): at `startsAt − 30 min` notify every confirmed player once; at the reveal time notify "room credentials available" once credentials are set.
- Inbox: `/notifications` with mark-read / mark-all, unread badge (bell) in the navbar; push opt-in card on the dashboard (not on first visit); install prompt on the dashboard after the first registration.
- PWA: `app/manifest.ts`, generated icons, `public/sw.js` (push + notification click; caches only static assets; offline fallback page; never caches HTML, API or credentials).
- SEO/sharing: metadata on public pages, `sitemap.ts`, `robots.ts` (disallow admin/dashboard/api), dynamic OG images for match and tournament pages, rank card image at `/leaderboard/[game]/card/[userId]`, share buttons on results and leaderboard pages.
- Polish: error boundaries with retry, themed 404/500, optimistic register/cancel feedback, a11y checks.
- Analytics: first-party page-view beacon and funnel (login → profile complete → first registration) shown on the admin dashboard.
- Tests: event mapping for every event, reminder job, service-worker cache policy, OG routes and inbox in Playwright.

### Outcome — PASSED, except the on-device push check (not verifiable here)

Acceptance checks:

- "A match reaching startsAt − 30 min creates notifications for every confirmed player" — integration: solo player + confirmed squad captain + confirmed roster member notified (in-app + reminder channel); invited roster member, waitlisted player and a later match are not; second run sends nothing; room-credentials notice goes out once credentials are set at the reveal time and never contains the password; cancelled matches skipped.
- "Push works on an installed PWA in Chrome Android" — **not verified**: no Android device and no VAPID keys here. Implemented: VAPID push via `web-push` (sends only to opted-in players' subscriptions, prunes gone subscriptions — covered by integration tests with a mocked sender), service worker `push` + `notificationclick` handlers, dashboard opt-in. Owner must generate VAPID keys and test on a phone (HANDOFF).
- "Lighthouse PWA and Accessibility checks pass" — Lighthouse 12 no longer has a PWA category, so installability was checked by hand: manifest (standalone, start_url, 192/512/maskable icons) served, service worker registers in the production build (Playwright). Accessibility: 100 on /dashboard, /notifications, /profile (after labelling the hidden avatar input — it was 96), /teams, /admin/matches, and all public pages from Phase 5.
- "OG images render for a match and a rank card" — Playwright follows each page's `og:image` (match, tournament, player page → rank card) and checks a real PNG (signature + size); unknown player → 404.
- Service worker never caches authenticated routes or room credentials — unit test evaluates the real `public/sw.js` (policy for 11 private/API paths incl. `/api/matches/:id/room`; navigations never stored); Playwright inspects the browser's Cache Storage after visiting /dashboard and /notifications: only `/offline.html`, `/_next/static/*`, `/icons/*`.
- Inbox — Playwright: bell shows "2 unread", list, mark all read, badge cleared.
- Every notification event mapping has a unit test (10 events).
- `npm run lint`, `npm run typecheck`, `npm run build` — pass. `npm test` — 34 files / 470 tests. `npm run test:e2e` — 49 pass.
- Coverage (lib/ + server/): **86.2% lines**, 83.4% statements, 73.2% branches.

What was built: Notification/PushSubscription/AnalyticsEvent models, pure event → message mapping, notify service (inbox + push + reminder channel interface with console implementation), reminder job in the 5-minute cron, inbox page + bell badge, push opt-in and install prompt on the dashboard (after first registration), manifest + generated icons + service worker + offline page, sitemap/robots, OG images (match, tournament, rank card) + player-page OG, share buttons (results, "share my rank"), error boundaries + themed 500, optimistic register feedback, first-party page-view beacon and login → profile → first-registration funnel on the admin dashboard.

Skipped / stubbed: WhatsApp/SMS reminders use the console channel (interface ready for a provider). Push delivery is a stub until VAPID keys are set.

Decisions: D7.1–D7.8.

Needs from owner: VAPID keys (`npx web-push generate-vapid-keys`) and a phone test of push on the installed PWA.

## Phase 8

### Plan

- Security review (fix + list): static test that every server action / mutating route handler validates input and checks role/ownership (or is an explicit public/webhook/cron exception); leak test fetching every public page and endpoint and asserting room credentials, phone numbers, payout details and raw webhooks are absent; rate limits on OTP session, registration, result upload, reports, contact (429 + friendly message); security headers (nonce-based CSP allowing only Firebase/Cashfree/YouTube/Supabase, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, nosniff); CSRF (server actions' built-in Origin check, same-origin check on cookie-authenticated route handlers); uploads by magic bytes (already); secret scan of git history; Prisma uniques and indexes verified.
- `npm audit`: no High/Critical (overrides where the fix is a transitive patch).
- Sentry (`@sentry/nextjs`) for server + client errors, enabled only when a DSN is set; source maps upload when an auth token is set.
- Tests: regression suite + coverage ≥ 70% on lib/ and server/; Playwright flows incl. admin creates match → approves result → leaderboard updates.
- CI: GitHub Actions (Postgres service): lint, typecheck, Vitest with coverage, Playwright.
- Deploy docs: docs/DEPLOY.md (Vercel, env vars, crons, backups + a restore procedure actually tested locally, Sentry, uptime on / and /api/health) and docs/LAUNCH.md checklist; then docs/HANDOFF.md.

### Security review — what was checked and changed

1. **Validation + role/ownership on every mutation** — new static test (`tests/unit/security-static.test.ts`, 139 checks) asserts every exported server action calls `requireUser/requireModerator/requireAdmin` (only the public contact form is exempt, by design), every service taking `(actor, …)` calls `assert*(actor)` and `parseInput` on untrusted input, every mutating route handler is on a reviewed list (OTP session, logout, two webhooks, analytics beacon), cron routes check `CRON_SECRET`, webhooks verify signatures. No gaps found.
2. **No leaks of room credentials, phone numbers, payout details, raw webhooks** — Playwright `e2e/security.spec.ts` fetches every public page and endpoint (pages, sitemap, robots, health, room, payment status) anonymously and as an unrelated logged-in player (incl. their dashboard/inbox/teams) with a planted victim account, match credentials, masked VPA and a raw-webhook marker: nothing leaks. Logs: room credentials are redacted in audit logs; Sentry is configured to send no cookies, headers, bodies, query strings or user info (**changed**: Sentry v11 collects these by default).
3. **Rate limits** — OTP session (5/phone, 30/IP per 15 min), **registration (added: 20 per player per 10 min)**, result upload (10/h), reports (5/h), contact form (3/h/IP), analytics beacon (120/min/IP). All return 429 / `RATE_LIMITED` with a friendly message.
4. **Webhook signatures** mandatory, tampered-payload tests (PG + payouts) — already in Phase 6; static test pins them.
5. **Headers** (**added**): nonce-based CSP per request from `proxy.ts` (`script-src 'self' 'nonce-…' 'strict-dynamic'`, hosts limited to Firebase/Google auth, Cashfree, YouTube-nocookie, Supabase, Sentry; `frame-ancestors 'none'`, `object-src 'none'`), HSTS (2 years, preload), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`; `X-Powered-By` removed. Playwright asserts the headers and zero CSP violations while browsing and opening the login flow. **CSRF**: server actions use Next's Origin check; cookie-authenticated POST routes call `assertSameOrigin` (Playwright checks a cross-site POST gets 403). **Uploads**: magic bytes + size (since Phase 1).
6. **Secret scan** — gitleaks over the full history: no leaks (8 commits). `.env` never committed (only `.env.example`). CI runs gitleaks on every PR.
7. **Prisma** — unique `phone`, `(game, gameId)`, `(matchId, userId)`; indexes `Match(startsAt, status)`, `Registration(matchId, status)`, `PointsEntry(seasonId, userId)`; money only as `Int` paise; unique payment/refund/transfer/webhook keys — pinned by `tests/unit/schema-constraints.test.ts`.
8. **Dependencies** (**changed**) — `npm audit` had 4 high + 2 moderate (all transitive: `deepmerge-ts`, `mysql2` under the Prisma CLI, `uuid` under firebase-admin); fixed with npm `overrides`; now **0 vulnerabilities**; CI fails on high/critical.

### Outcome — PASSED locally; CI and preview deployment not run (no GitHub remote / Vercel project)

- `npm run lint`, `npm run typecheck`, `npm run build` — pass. `npm test` — 36 files / **615 tests**. Coverage (lib/ + server/): **86.3% lines**, 83.5% statements, 73.2% branches.
- `npm run test:e2e` — **54 pass** against a production build + seeded e2e database, including: login → complete profile → register for a scrim → room credentials after reveal; admin creates match → approves result → leaderboard updates; (stub-sandbox) payment confirms registration only via webhook.
- Lighthouse mobile (local production build): Home 92, Scrims 92, Leaderboard (BGMI) 91, (Free Fire) 91 performance; accessibility 100, best-practices 100.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- Backup restore procedure tested (pg_dump → pg_restore into a fresh database; row counts and migration status verified).
- docs/DEPLOY.md and docs/LAUNCH.md written.
- **Not done here (needs owner accounts):** "CI green" — the workflow (`.github/workflows/ci.yml`) was validated by parsing and by running the same commands locally (see below), but it has not run on GitHub because the repository has no remote. "Playwright against a preview deployment" — there is no Vercel project; e2e ran against a local production build. Real Firebase/Cashfree/VAPID/Supabase/Sentry integrations remain unverified without credentials.

Decisions: D8.1–D8.5.

CI dry run (after the Phase 8 commit): fresh `git clone` of the repository, no `.env`, a brand-new Postgres container, and exactly the workflow's commands and environment — `npm ci` (0 vulnerabilities), `prisma migrate deploy`, lint, typecheck, `test:coverage` (36 files / 615 tests, 86.3% lines), `npm audit --audit-level=high`, `test:e2e` (54 passed; locally with `E2E_CHANNEL=chrome`, CI uses bundled Chromium). All green.

---

# Run 2 — design reference (docs/design/pages/home-desktop.png)

PHASES.md gained a Design reference section (exact tokens, Barlow Condensed + Inter, shared `<Artwork>`), a redesigned Phase 0 layout and a Phase 5 home page that reproduces the design. Features from run 1 are kept; each phase is re-executed in order: design changes applied, acceptance re-verified, committed.

## Phase 0 (run 2)

### Plan

- Replace `app/tokens.css` with exactly the Design reference tokens (dark only), load Barlow Condensed (700/800) for headings and Inter for body via `next/font/google`, 12px card radius, gold active/hover card border.
- `<Artwork name>`: shows `/art/<name>.png` when `docs/design/assets/<name>.png` exists, otherwise a same-size placeholder (#14141A, 1px #26262E, faint gold glow). `scripts/sync-art.mjs` copies assets to `public/art/` and writes `lib/art-manifest.ts` (runs before dev/build/typecheck/test).
- Navbar per design: logo, Home, Scrims, Tournament, Leaderboard, Games dropdown, More dropdown, search field (→ /search), Login + gold Get Started; mobile sheet with the same items. Footer: partners row only when real sponsor logos exist, Follow Us icons.
- Brand text "ESPORTS" (from the design) replaces the placeholder name.
- Tests: Artwork/manifest unit tests; Playwright for navbar dropdowns, search, footer, all routes rendering.

### Outcome — PASSED

- Acceptance: `npm run build` and `npm run lint` pass; typecheck passes; all routes render (Playwright: every public route 200 with an `<h1>`, the new `/search`, unknown slugs 404); CLAUDE.md (design conventions added) and .env.example exist.
- Design checks (Playwright, desktop 1440 px): navbar has Home/Scrims/Tournament/Leaderboard, Games and More dropdowns (navigate to /games/bgmi and /faq), search field → /search results, Login + Get Started; body background rgb(11,11,13), text rgb(245,245,245), h1 in Barlow Condensed, body in Inter; footer hides "Our Partners" without logos and labels the Follow Us icons; missing artwork renders sized placeholders; mobile menu offers the same destinations plus search. Unit test pins all 12 token values and rejects any other colour in `app/tokens.css`.
- `npm test`: 38 files / 638 tests. Coverage (lib/ + server/): **86.4% lines**. `npm run test:e2e`: 59 passed.

Built: design tokens + fonts, `<Artwork>` + `scripts/sync-art.mjs` + `lib/artwork.ts`, navbar (logo/wordmark, dropdowns, search, Login, gold Get Started), mobile sheet, footer (partners row, Follow Us, legal row), `/search`, restyled game cards, chips and game badges.

Decisions: R0.1–R0.7. Needs from owner: artwork files in `docs/design/assets/` (all 25 expected names are still missing; placeholders shown).

## Phase 1 (run 2)

### Plan

- No page design exists for login/profile, so build them from the home design's components: centred `card-ds` login panel, profile sections as `card-ds` cards, `empty-profile` artwork on the "complete your profile" notice, shared `EmptyState` gains an optional artwork slot.
- Re-verify Phase 1 acceptance (OTP login via stub, session persists, banned user blocked, profile + unique game IDs, migrations, tests).

### Outcome — PASSED

- Acceptance re-verified: OTP login (local stub; Firebase still needs owner keys), session persists across reload, banned user cannot log in, profile saves and game IDs are unique across users (Playwright `auth-profile.spec.ts`, 8 passed, now also asserting the `empty-profile` artwork slot); `prisma migrate status` up to date; Phase 1 Vitest files 7 / 85 tests pass (validators incl. Riot ID, isProfileComplete, session signing, role helpers, auth, profile, guards). Lint, typecheck, build pass.
- Built: login in a centred card, profile sections as design cards, `empty-profile` artwork on the completion notice, `EmptyState` with an optional artwork.
- Needs from owner: unchanged (Firebase keys; `empty-profile.png`).

## Phase 2 (run 2)

### Plan

- Admin shell in the design system: brand wordmark/logo in the admin header, gold active state in the section nav, tables and panels as design cards (`card-ds`), status controls with gold primary buttons.
- Re-verify Phase 2 acceptance (create scrim, clone ×3, open registration, room credentials, cancel; moderator blocked from Users/Content; cron walks a match through every state; audit log).

### Outcome — PASSED

- Acceptance re-verified: Playwright `admin-matches.spec.ts` (create scrim → clone daily ×3 → open registration → room credentials → cancel one; all in the audit log; moderator sees no Users/Content and gets 404 on them) — 2 passed. Vitest: state machine (49 pairs), form schema, admin route guards, matches, cron lifecycle + idempotency, admin users, teams/content/audit — 7 files / 168 tests pass. Lint, typecheck, build pass.
- Built: admin header with the brand wordmark, gold active section, tables/panels as design cards (17 admin files restyled via shared classes).

## Phase 3 (run 2)

### Plan

- Rebuild `MatchCard` exactly like the design's Today's Matches card: game name (accent) + mode tag + status, clock "06:00 PM IST · Today", bold title, Prize Pool / Entry Fee, slots progress bar in the game accent with "32 / 48 Slots", gold-outlined "Join Now" (or Join Waitlist / Opens soon / Closed), `card-match-<game>` artwork on the right.
- Match detail, dashboard and teams pages as design cards; empty states use `empty-no-matches` / `empty-no-team` artwork; scrim day groups get the design's section heading style.
- Re-verify Phase 3 acceptance (profile redirect, slot race, waitlist promotion, credentials reveal window, squad confirmations).

### Outcome — PASSED

- Match card rebuilt to the design (article with game name in accent, mode tag, IST time + day label, title, Prize Pool / Entry Fee, accent slots bar with "x / y Slots", gold-outlined action with labels Join Now / Join Waitlist / Opens Soon / Coming Soon / Closed, `card-match-<game>` artwork on the right half). Scrims page uses gold chips, "Today's Matches" day headings with a gold calendar icon, 4-column grid on wide screens. Match detail hero, facts and registration panel are design cards; dashboard / teams empty states use `empty-no-matches` / `empty-no-team` artwork; every remaining site card uses `card-ds`.
- Acceptance re-run: integration suites for registration rules, slot race, waitlist promotion, room credential reveal and squad confirmation pass; Playwright `scrims-registration` (profile redirect, reveal window), `squad-registration` and the new card-anatomy test pass.
- Gate: lint, typecheck, build pass. Vitest 38 files / 639 tests. Playwright 60 / 60 pass. Coverage lib/ + server/ **86.4% lines** (lib 96.2%, server 78.9%).
- Skipped: none. Screenshot reviewed at 1440×900 against home-desktop.png's Today's Matches cards.

## Phase 4 (run 2)

### Plan

- Standings table like the design's leaderboard: `#` with a gold crown for rank 1, round avatar (photo or initials), uppercase player name, Team, Matches, Wins, Kills (or Round diff), Points last; the viewer's row highlighted.
- Game tabs are the existing gold switcher chips under the navbar; heading with a gold crown and the "(Current season)" tag; past-season champions and tournament winners use lucide rank icons instead of emoji.
- Re-verify Phase 4 acceptance (approve → leaderboard, reopen removes points, 3 strikes block registration, season rollover keeps history).

### Outcome — PASSED

- Built: `StandingsTable` in the design's leaderboard style (muted small headers, gold crown for #1 via `RankBadge`, `PlayerAvatar` with photo or initials and a gold ring, uppercase names, Points last, optional `compact` mode for the home preview), `PageHeader` gained `icon` and `tag` ("(Current season)" / "(Final standings)"), past-season champions and tournament winners use lucide `PlaceIcon` (crown / medal) instead of emoji, empty board shows the `empty-no-matches` artwork.
- Acceptance re-run: points/results/seasons suites (45 tests: points table, ties, team propagation, reversal on reopen, strikes → registration ban, season rollover history) pass; Playwright `results-leaderboard` (approve → board updates with crown on #1 and Points last, reopen removes points, no-show strike reversed), `admin-result-flow`, `tournaments-home` pass (9/9).
- Gate: lint, typecheck, build pass. Vitest 38 files / 640 tests. Playwright 60 / 60. Coverage lib/ + server/ **86.4% lines**.
- Screenshot of /leaderboard/bgmi (e2e data) reviewed against the design's leaderboard block.
- Decision: game tabs on leaderboard pages are the existing switcher chips (R4.1 in DECISIONS.md).

## Phase 5 (run 2)

### Plan

- Rebuild the home page section by section from home-desktop.png: hero (gold "India's biggest" eyebrow, ESPORTS / PLATFORM heading, tagline, real stats with gold icons, Get Started + Watch Trailer, three slanted character panels using `bg-*` + `hero-*` artwork linking to /games/[game] with today's match count), game strip, Today's Matches (chips, View All Matches, arrow-scrolled card row), This Week's Tournaments (`card-tournament-*` art, prize, format, date, Register Now), Leaderboard preview (Current season, game tabs, top 5), Why Play row; partners + Follow Us stay in the footer.
- Keep the Phase 5 extras the design doesn't show (winners carousel with `trophy-podium` art, How It Works) in a row between the leaderboard block and Why Play.
- Tournament page hero in the design card style; mobile stacks every section, card rows scroll sideways.
- Re-verify Phase 5 acceptance and the Lighthouse ≥ 90 mobile target.

### Outcome — PASSED (Lighthouse target not consistently met, see below)

- Built: `lib/home.ts` (stat formatting in Indian units, panel copy, format labels; zero stats hidden), `server/queries/home.ts` (real counts, today's matches, this week's tournament per game, top-5 previews), home components `hero`, `today-matches` (client: chips + arrows), `week-tournaments`, `leaderboard-preview` (client: WAI tabs), `how-it-works`, `why-play`; winners carousel restyled with `trophy-podium` artwork; `Artwork` gained `layer` (a missing character layer is transparent so its background layer shows); tournament page hero with `card-tournament-*` art; the inline sponsors row was dropped because the footer's "Our Partners" row already shows on every page (R5.3).
- Acceptance re-run: Playwright `tournaments-home` (BGMI lobby-points cumulative standings over 3 linked matches, Valorant 8-team bracket advancing, published winners on the home carousel, carousel auto-advance / hover pause / dots + arrows / reduced motion, static pages from admin content) pass; new `home.spec.ts` covers every design section, the chips filter, leaderboard tabs, partners row appearing once a sponsor exists (home and tournament page), and no section wider than a Pixel 7 viewport. Vitest bracket + lobby-points suites pass.
- Found and fixed while verifying: the carousel column widened past the viewport on mobile (implicit `auto` grid column → `grid-cols-1`); scroll-snap rows scrolled themselves during load, which stops Chrome's LCP tracking (NO_LCP) → matching `scroll-px-*`; the hero stats `<dl>` had invalid nesting (accessibility 93 → 100).
- Performance work: navbar Games/More menus are now a WAI disclosure (button + links) instead of Radix DropdownMenu, the unused global TooltipProvider was removed, the mobile menu sheet and the toaster load on demand, and the Sentry browser SDK loads lazily only when a DSN is set. Shell JS went from 245 KB to 203 KB gzipped.
- Lighthouse mobile (local production build, 3 runs each): Home 83–90, Scrims 85–89, Leaderboard (BGMI) 87–89, Tournament (BGMI) 84; accessibility, best practices and SEO 100. **The ≥ 90 performance target is not consistently met.** For comparison, the unchanged run-1 build (commit f699368, which scored 92–94 when first measured) scores 87–92 on this machine today, so part of the gap is measurement drift; the rest comes from the two extra Barlow Condensed font files the design requires and the denser home page. Simulated LCP is ~3.7 s although the page paints at ~0.15 s in a plain Chrome trace. Recorded under Known limitations in HANDOFF.
- Gate: lint, typecheck, build pass. Vitest 40 files / 655 tests. Playwright 65 / 65. Coverage lib/ + server/ **86.8% lines** (lib 96.3%, server 78.9%).
- Incident: a throwaway git worktree used for the Lighthouse baseline shared node_modules through a junction, and its Sentry build step emptied `node_modules/@sentry/server-runtime-injection`. Fixed with `npm ci`; nothing in the repository was affected.

## Phase 6 (run 2)

### Plan

- Payment surfaces in the design system: payment status page as a centred design card with a status icon (spinner / success / refund / failed / still waiting), the local test checkout as a gold-bordered card showing the amount in heading type, the under-18 payout notice as a gold-tinted card. Pay button already uses the gold primary button.
- Re-verify Phase 6 acceptance (webhook-only confirmation, expiry frees the slot, cancellation refunds, payout webhook, replay safety).

### Outcome — PASSED

- Built as planned (`components/match/payment-status-poller.tsx`, `app/(site)/payments/return`, `app/(site)/payments/stub/[orderId]`, `components/profile/payout-method-form.tsx`). No payment logic changed.
- Acceptance re-run: `payments.test.ts` and `payouts.test.ts` (webhook signatures valid/tampered, replay idempotency, refund transitions, expiry job, payout webhook SUCCESS) pass; Playwright `paid-registration` (stub checkout → signed webhook confirms the registration; the return page shows "Payment received. Your slot is confirmed!") passes.
- Gate: lint, typecheck, build pass. Vitest 40 files / 655 tests. Playwright 65 / 65 on two consecutive full runs. Coverage lib/ + server/ **86.8% lines**.
- Flake noted: one earlier full run had a single `toHaveAttribute` failure that did not reproduce in two later full runs or in 3× repeats of the carousel, navbar and home specs; the failing run's artifacts were overwritten before I could identify it. CI retries once (`retries: 1`).

## Phase 7 (run 2)

### Plan

- OG images (match, tournament, rank card) in the design palette with Barlow Condensed headings and the `og-background` artwork (placeholder look while missing); PWA icons, favicon and Apple icon from the `app-icon` artwork, else a gold "E" wordmark monogram (brand text, not a drawn logo).
- `empty-no-notifications` artwork on the empty inbox; `empty-offline` artwork on the offline page (cached by the service worker when delivered).
- Re-verify Phase 7 acceptance.

### Outcome — PASSED

- Built: `lib/design-tokens.ts` (hex mirror of the palette for Satori, unit-tested against `app/tokens.css`), `server/art-data.ts` (delivered artwork → data URI, unit-tested), `server/og-fonts.ts` (Barlow Condensed 700/800 WOFF bundled in `assets/fonts` with its OFL licence, plus next/og's Geist as the per-glyph fallback for ₹), `components/og/og-card.tsx` redesigned, `components/og/app-icon.tsx` shared by `/icons/[size]`, `app/icon.tsx` and `app/apple-icon.tsx` (the default Next.js `app/favicon.ico` was removed), inbox empty state artwork, offline page artwork slot, service worker `static-v2` caching `/art/*` and pre-caching the offline artwork when present (its absence never fails install). `outputFileTracingIncludes` ships the fonts and artwork with the image routes.
- Checked visually: OG card and 192px icon rendered from the production build (screenshots reviewed); fixed along the way: Satori ignores `inset` (placeholder panel was invisible) and Barlow has no ₹ glyph (the sign now renders in its own run).
- Acceptance re-run: notification/reminder suites (30-minute reminders for every confirmed player, event mappings, service worker never caches authenticated routes or room credentials, now also `/art/*` allowed) pass; Playwright `notifications-seo` (inbox, OG images for a match, a tournament and a rank card, icon + apple-touch-icon links serve PNGs, empty inbox artwork slot, manifest/sitemap/robots, noindex, service worker caches only static assets) passes. Lighthouse accessibility 100 on Home and Tournament (Lighthouse 12 has no PWA category; installability as in run 1). Push on an installed Android PWA still needs a real device and VAPID keys (Needs from owner).
- Gate: lint, typecheck, build pass. Vitest 41 files / 659 tests. Playwright 66 / 66. Coverage lib/ + server/ **86.6% lines** (lib 96.4%, server 75.2%).

## Phase 8 (run 2)

### Plan

- Security re-review of everything run 2 added: the public `/search` page, home queries, image routes (OG, icons), lazy-loaded client pieces, and the offline page / service worker change.
- Re-run the secret scan over the full history and `npm audit`; final Lighthouse on Home, Scrims and Leaderboard; CI dry run from a fresh clone against a new Postgres container after the commit.

### Outcome — PASSED except the Lighthouse ≥ 90 target (not met, see below)

- Review findings: run 2 added no server actions or mutating route handlers (the static mutation audit test still passes). `/search` returns public fields only (integration test asserts phone numbers and game IDs are absent) and is now part of the Playwright leak test, which queries it for the test victim; the home queries select counts, public match fields and leaderboard rows (name, avatar, stats). Image routes read only bundled fonts and public artwork. The offline page is static and uses no script. Nothing needed fixing.
- Secret scan: gitleaks over the full history, 19 commits, no leaks; `.env` has never been committed.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- Lighthouse mobile (local production build, 3 runs each, perf/a11y/best-practices/SEO): Home 83–87/100/100/100, Scrims 86–88/100/100/100, Leaderboard (BGMI) 80–92/100/100/100. **Performance does not consistently reach 90.** The measurement on this machine drifts: the unchanged run-1 build now scores 87–92 where it scored 92–94 before (Phase 5 run-2 notes). The remaining cost is the second heading font the design requires (Barlow Condensed 700/800 next to Inter) and the denser home page. Candidate next steps are in HANDOFF (self-host a subsetted variable Barlow, measure on a real device or PageSpeed Insights against the preview deployment).
- Gate: lint, typecheck, build pass. Vitest 41 files / 659 tests. Playwright 66 / 66. Coverage lib/ + server/ **86.6% lines**.

### CI dry run and wrap-up (run 2)

- CI dry run from a fresh `git clone` (no `.env`), a brand-new Postgres 16 container and the workflow's exact commands and environment: `npm ci` (0 vulnerabilities), `prisma migrate deploy`, lint, typecheck, `test:coverage` (41 files / 659 tests, 86.6% lines), `test:e2e`, `npm audit --audit-level=high`. The first two attempts surfaced three problems, all fixed and committed before the final attempt, which passed **66 / 66 with no flaky tests**:
  1. `server/og-fonts.ts` read files through computed paths, so Turbopack traced the whole project into the image functions (build warning) → literal paths.
  2. The run crossed IST midnight and the seed's fixed-time "today" matches moved into the past → the design-shell and home specs now create their own time-relative scrims (`e2e/support/fixtures.ts`).
  3. The reduced-motion carousel test could fail because the first render's auto-advance timer might fire before the reduced-motion state was applied → the timer re-checks `matchMedia` when it fires (this also explains the unidentified Phase 6 flake). The lobby-points spec now waits for hydration before submitting the admin form (it was flaky once on a cold server).
- Footer now shows the `logo` artwork too when delivered (it had its own text wordmark).
- docs/HANDOFF.md rewritten for run 2: the missing-artwork table (all 25 files, where each appears, suggested sizes), design/brand items under "Needs from owner", the Lighthouse shortfall and design deviations under known limitations, and updated next steps. docs/LAUNCH.md: brand line updated and an artwork item added.
- Final local run: Vitest 41 files / 659 tests (lib/ 96.4%, server/ 76.0%, overall **86.6% lines**), Playwright 66 / 66.

# Scrims page — docs/design/pages/scrims-desktop.png

### Plan

- Rebuild /scrims from the new design, reusing the design system: full-width hero ("SCRIMS", subline, "How scrims work?" card with an admin-set video link), three game strip cards that filter by game, one filter panel (IST date chips, Mode / Entry Fee / Prize Pool / Status dropdowns, search, Reset) whose state lives in the URL, "Today's Scrims" with Sort by, "Upcoming Scrims (Next 3 Days)" with a View Calendar grouped view, the design's match card (status pill, variants for today/upcoming), empty-day state linking to the next day with matches, the trust row and the design's footer. Logged-in navbar: bell with dot, avatar + name + role menu.
- Mobile: stacked sections, filters in a bottom sheet, date chips and card rows scroll sideways.
- Registration rules untouched: card status and buttons derive from `cardAction`.

### Outcome — DONE

- Built: `lib/scrims-filter.ts` (query parsing/URL building, IST 4-day window, derived status with the 80% ALMOST FULL threshold, filters, sorts, day grouping, next-day lookup), `lib/time.ts` design formatters ("06:00 PM", "28 Sep", "Mon"), `components/scrims/*` (hero, game strip, filter panel + no-JS-capable filter form, lazy mobile filter sheet, sort select, day and upcoming sections with calendar view and empty-day state), `components/match/match-card.tsx` rebuilt with `day` / `upcoming` variants and `ScrimStatusPill`, `components/layout/user-menu.tsx` + shared `useDisclosure`, bell unread dot, footer restructured (partners row → design bar → legal row), `TrustRow`, `/games` index page, content key `scrims.video` (https-only, validated on save and render). The navbar game chips no longer show on /scrims (the strip replaces them).
- Decisions: S1–S10 in docs/DECISIONS.md.
- Tests: Vitest `tests/unit/scrims-filter.test.ts` (18 tests: URL → query round trip, every filter, bucket edges, sorts and tie-breaks, ALMOST FULL threshold and status derivation, IST window across midnight, empty-day link), content validation (unit + integration, including the role check), nav switcher. Playwright `e2e/scrims-page.spec.ts` (6 tests: layout and sections; switching a date chip, filtering by game, following the empty-day link; dropdowns, search, sort and Reset in the URL; View Calendar; logged-in navbar menu and logout; mobile bottom sheet with no horizontal scroll). Updated design-shell, navigation, auth-profile and scrims-registration specs for the new card, footer, account menu and game strip.
- Checked visually at 1536×1024 (logged in) and 412×915 against scrims-desktop.png; fixed along the way: labels rendered under the amounts, footer links wrapping, and a test phone number that collided with the security spec's.
- Gate: lint, typecheck, build pass. Vitest 42 files / 680 tests, coverage lib/ + server/ **87.2% lines**. Playwright 72 / 72.
- Not done: Lighthouse was not re-measured for /scrims; all artwork is still missing, so the hero, game strip and card art show placeholders.

# UPCOMING pill (S2 revised) and performance pass

### UPCOMING pill — DONE
- Matches in UPCOMING status show a grey "UPCOMING" pill with the IST registration opening time under it ("Opens at 5:30 PM", or "Opens 29 Sep, 5:30 PM" when it opens on a later day). Paid matches while `PAYMENTS_ENABLED=false` still show no pill. `scrimPill()` in `lib/scrims-filter.ts`; 5 unit tests for the mapping, e2e check on a seeded not-yet-open match. Decision S2 revised.

### Lighthouse (mobile) — /scrims and /
Method: production build, **median of 5** Lighthouse 12 mobile runs per cell (single runs swing up to 10 points on this machine), same data (e2e database). "HTTP/1.1" = `next start` directly; "HTTP/2" = the same server behind a local Caddy TLS proxy, because production (Vercel) serves HTTP/2 and Lighthouse's simulation queues HTTP/1.1 requests over 6 connections. "Before" = commit e5eb95c (pill change only); "after" = the performance commit a1f9acf.

| Page | Protocol | Performance | Accessibility | Best Practices | SEO | LCP (sim.) | TBT |
| --- | --- | --- | --- | --- | --- | --- | --- |
| /scrims | HTTP/1.1 before | 86 | 100 | 96 | 100 | 3.96 s | 145 ms |
| /scrims | HTTP/1.1 **after** | **89** | 100 | 100 | 100 | 3.44 s | 145 ms |
| /scrims | HTTP/2 before | 87 | 100 | 96 | 100 | 3.13 s | 291 ms |
| /scrims | HTTP/2 **after** | **93** | 100 | 100 | 100 | 2.51 s | 148 ms |
| / | HTTP/1.1 before | 84 | 100 | 100 | 100 | 4.15 s | 111 ms |
| / | HTTP/1.1 **after** | **88** | 100 | 100 | 100 | 3.53 s | 102 ms |
| / | HTTP/2 before | 96 | 100 | 100 | 100 | 2.65 s | 82 ms |
| / | HTTP/2 **after** | **95** | 100 | 100 | 100 | 2.48 s | 116 ms |

- Accessibility was already at least 90 (100) on both pages. One non-scoring accessibility audit failed (the date chips' accessible name didn't contain their visible text) and is fixed. Best Practices on /scrims went 96 → 100 (a CSP issue raised by load-time prefetch requests).
- Performance: **over HTTP/2 both pages are at least 90 (93 and 95). Over plain local HTTP/1.1 they are still under 90 (89 and 88).** Home over HTTP/2 was already 96 before; its gains show on HTTP/1.1 (+4) and in LCP.
- Why HTTP/1.1 stays under 90: in Lighthouse's headless Chrome on this machine the first frame arrives at ~1.2–1.5 s although the page's main thread is idle from ~0.4 s (GPU/compositor, seen in the trace; /offline.html paints at 59 ms). Lighthouse's LCP simulation charges every script evaluated before that paint, so the whole Next.js/React runtime (~140 KB of the ~150 KB first-load JS) counts toward LCP whatever the page does. Host CPU is not the cause (benchmarkIndex 2265).
- What changed (DECISIONS P1–P7): Zod no longer shipped to /scrims (83 KB chunk), intent prefetch instead of 13+ load-time prefetches, ₹ from a local font (two latin-ext font downloads gone), Suspense boundaries to split hydration, icon sprite and a single active leaderboard table (DOM 1,225 → 1,061 on /scrims, 1,022 → 946 on /), next-themes removed, service worker and beacon deferred, cheaper placeholder glow and header.

# Client bundle audit (all routes)

### Plan
- Audit every route for server-only libraries in the client bundle and for link prefetches on first load; fix them; add CI checks so neither comes back, including a bundle-size budget that fails if any client chunk grows more than 20%.

### Outcome — DONE
- **Server-only code in the browser**: a new static audit, `scripts/check-client-imports.mjs`, follows every import from each `"use client"` file and fails on Zod, Prisma/pg, jose, firebase-admin, web-push, cashfree-pg, `server-only`, Node built-ins, or anything under `server/`, `generated/prisma/` or `prisma/`. Server-action modules count as the RPC boundary they are, and type-only imports are ignored. It found Zod reaching the browser on 4 more routes besides /scrims: `/login` and `/profile` (via `lib/validators.ts`), `/admin/content` (via `lib/content.ts`), and `/admin/matches/new` plus `/admin/matches/[id]/edit` (via `lib/match-schema.ts`). The fix moves the plain helpers into Zod-free modules that the originals re-export: `lib/input-rules.ts` (phone normalising, Riot ID parsing, safe redirects, age, Valorant regions), `lib/content-keys.ts`, and the existing `lib/match-modes.ts`. First-load JS (gzip): /login 257 → 168 KB, /profile 268 → 179 KB, /admin/content 270 → 181 KB, /admin/matches/new 265 → 175 KB. No other server-only library is reachable (66 client entries, 95 modules).
- **Prefetch on first load**: a new Playwright audit, `e2e/prefetch-budget.spec.ts`, loads 40 routes (20 public anonymous, 20 signed-in/admin, desktop viewport so the full navbar is present) and counts `next-router-prefetch` requests in the 2.5 s after load. Before: /search 8 (one per result), /scrims/[id] 8, /games/[game] 7, /tournament/[game] 5, /rules 3, /leaderboard/[game] 3, everything else 0–2. All internal links now use `IntentLink` (prefetch on hover, touch or focus), and an ESLint rule forbids importing `next/link` anywhere else; every route now fires **0** prefetches on load. A second test proves that hovering a card link still starts its prefetch.
- **Bundle budget in CI**: `scripts/check-bundle-size.mjs` (`npm run bundle:check`, run after the e2e step's production build) compares the build against `perf/bundle-baseline.json`. It fails if any client chunk, any route's first-load JS or the async JS grows more than 20% (gzip), or if a server-only library marker shows up in any client chunk. Chunks are keyed by the source modules they contain, because file names are content hashes; a clean rebuild reproduced all 49 keys. For intended growth: `npm run build && npm run bundle:baseline` in the same PR. Both checks are unit-tested (`tests/unit/bundle-size.test.ts`, `tests/unit/client-imports.test.ts`).
- CI order: lint → typecheck → client-import audit → unit/integration → e2e (including the prefetch audit) → bundle budget → npm audit.
- Gate: lint, typecheck and build pass. Vitest 44 files / 691 tests, coverage lib/ + server/ 87.3% lines. Playwright 75 / 75. Bundle check OK.
- Not covered by the prefetch audit: the admin tournament and team detail pages (the fresh e2e database has none when the audit runs). They use the same components, and the lint rule applies to them.

# Home page — home-desktop.png, section by section

### Plan
- Complete / to match home-desktop.png reusing the /scrims components and tokens: logged-out navbar (More gains "Past seasons"), hero with admin-editable stats (seeded with the design's demo values, "Use live stats" toggle), admin trailer link and taglines, three game panels (sideways scroll on phones), the /scrims game-strip card, Today's Matches with chips and a "see tomorrow's scrims" empty state, This Week's Tournaments cards with an "Announcing soon" state, "Last Week's Winners" (published podiums only), leaderboard preview with crown/medal ranks, Why Play, footer.
- Seed one tournament and one team in the e2e database so the prefetch audit covers their admin detail pages. No registration rules or other server logic changed.

### Outcome — DONE
- **Admin → Content → Home page** (new form, admin-only, validated, audited): stat texts (12 characters max, empty hides the stat), "Use live stats" toggle (default off), "Watch Trailer" link (https or empty, which hides the button), and the three hero taglines ("Part one · part two"). Stored as SiteContent rows; `prisma/seed.ts` inserts the defaults 50K+ / 1K+ / ₹10L+ and the design's taglines without overwriting existing values. With live stats on, the existing real-count query is used (no new calculation was needed); zero values are hidden.
- **Hero**: the taglines and trailer come from the settings; the three game panels keep today's match count; on phones the panels are a sideways-scrolling row of cards and on desktop they keep the slanted edges (`.hero-panel` in globals.css).
- **Game strip**: the /scrims card, extracted to `components/game/game-strip-card.tsx` (optional arrow), with "Daily Scrims & Tournaments" / "Competitive 5v5 Matches".
- **Today's Matches**: empty state "No matches today — see tomorrow's scrims" (names the game when a chip is active) linking to `/scrims?date=tomorrow`; /scrims now accepts `date=today|tomorrow`.
- **This Week's Tournaments**: game badge, "Weekly Championship", prize pool, team size and date, card art, outlined "Register Now" to /tournament/[game] (see H4); games without a tournament this week show "Announcing soon" and no button.
- **Last Week's Winners**: newest published podium per game in the tournament-card style (champion, runner-up and third with prizes, link to full results), auto-advance every 7 s, pause on hover/touch/focus, dots and arrows, no auto-advance with reduced motion. Hidden until a tournament has published winners. The timer logic is in `lib/carousel.ts`. The carousel isn't wrapped in `<Suspense>`, so its timer starts when the page hydrates.
- **Leaderboard**: crown for 1st and medals for 2nd/3rd (all leaderboard tables), tabs switch in place.
- **More → Past seasons** opens a new "Past seasons" section on /leaderboard (all games).
- Removed from home: "How It Works" (not in the brief's section list; component deleted) and the admin carousel items (the Content page says so; kept in admin for a later cleanup).
- **Bundle budget fix**: the first real code change after the budget went in exposed a false positive. When several chunks serve the same modules, pairing them by position isn't stable across builds. Such chunks are now budgeted as one group; verified against a clean build of the previous commit, with 0 unmatched keys. The one genuine failure, the home client group at 4.0 → 5.3 KB (+34%, from the winners cards and empty state; `/` first-load JS 167.7 → 169.1 KB), is intended, so the baseline was re-recorded in this change.
- **E2E seed**: `e2e/support/seed-extras.ts` adds a confirmed Free Fire team and last week's Free Fire tournament with published winners; the prefetch audit now covers `/admin/tournaments/[id]` and `/admin/teams/[id]` (0 prefetches on both).
- **Tests**: Vitest for the stats text and toggle rules, taglines, settings rows and the carousel timer (fake timers); integration tests for the settings service (validation, roles, audit) and the winners query (latest per game, no user IDs). Playwright `home.spec.ts`: navbar and More → Past seasons, hero with the seeded demo stats, "Watch Trailer" hidden while unset and shown once set, game strip links, chip filtering, the tomorrow link, tournament card links and "Announcing soon", Last Week's Winners, a leaderboard tab switch with no navigation, Why Play, the partners row, and the mobile layout. The carousel tests now use published podiums.
- Checked visually at 1536×1024 and 412×915.
- Gate: lint, typecheck, client-import audit, build, bundle budget pass. Vitest 45 files / 708 tests, coverage lib/ + server/ 87.5% lines. Playwright 78 / 78.
- Open for the owner: the demo stats are claims shown to visitors; replace them with true numbers or switch on live stats before launch (added to docs/LAUNCH.md).

# Artwork — design assets wired

### Plan
- Build the 25 PNGs added to `docs/design/assets/` into `public/art/` with the existing sync step, optimised (WebP + PNG fallback, responsive widths, nothing over 300 KB on a phone); check every `<Artwork>` on /, /scrims, /games/[game] and /tournament/[game] renders the real file; transparent art without a box; hero characters placed like home-desktop.png; card art on the right 40% of match and tournament cards; bundle/perf check.

### Outcome — DONE (mobile Lighthouse performance below 90 on HTTP/1.1, see below)
- **Missing assets: none.** All 25 expected names are present. `trophy-podium.png` is delivered but has no slot on these pages at the moment (the winners carousel uses the tournament card art); it is listed in `lib/artwork.ts` and ready to place.
- **Build step** (`scripts/sync-art.mjs`, runs on install/dev/build/typecheck/test; `sharp` added as a dev dependency): per asset, WebP at 256/384/512/640/768/960/1280/1920 px wide (up to the source width; q76 for photos, q70 + alpha q80 for transparent art) and an optimised PNG fallback at most 1280 px wide (palette PNG for transparent art). 166 WebP + 25 PNG; the first build takes ~1 min, after that a cache (`public/art/.cache.json`, keyed by file size + mtime + pipeline version) makes it ~0.1 s. `lib/art-manifest.ts` now records each asset's size and widths.
- **Rendering**: `<Artwork>` outputs `<picture>` with a WebP `srcset` + `sizes` and the PNG `<img>` as fallback, with intrinsic width/height (no layout shift); CSS backgrounds (site texture, offline page) use `image-set()`. Callers pass `sizes` matching the slot and position the subject with `object-*` in `className`. `lowPriority` loads decorative art above the fold right away but after the LCP image.
- **Sizes**: the largest WebP a phone can pick (≤ 1280 w) is 213 KB (hero-valorant-960); a Moto G–class phone loads 4–137 KB per image (home total ~330 KB, /scrims ~130 KB). The PNG fallbacks of the photographic art are 0.2–1.5 MB, but only browsers without WebP (none current) ever load them; the e2e test checks phones never request a PNG.
- **Asset-specific handling**: `logo.png` is a gold "E" on an opaque black square — trimmed at build and drawn with `mix-blend-lighten` so no box shows on the dark UI, followed by the "ESPORTS" text wordmark (navbar and footer). `app-icon.png` has opaque white corners — the icon renderer clips it to a rounded square. Banners have their scene on the right, so they are anchored right inside the card's left half.
- **Placement**: hero characters use `object-cover` pinned to the top (head never cut, legs run off the panel's bottom edge, as in home-desktop.png); the /scrims banner character got headroom. Match cards (/scrims, home, game pages), tournament cards, the winners carousel and the match/tournament page heroes put the art on the right 40% (anchored right, a surface gradient on its left edge) and cap the text column at 60%. The Valorant red badge on a tournament card failed contrast at 18 px (4.47:1) and is now 20 px bold (large text).
- **Verification** (`e2e/artwork.spec.ts`, 4 tests): on /, /scrims, /games/free-fire, /tournament/bgmi and /leaderboard/valorant no placeholder remains, every image loads and is served as WebP, transparent art (hero-*, empty-*, trophy-podium) has no background or border box; desktop placement of the heroes and of card art (38–42% width, flush right, text ends within 62%); on a phone no image is over 300 KB and no PNG is requested. Unit tests for `artworkSources` / `artworkWebpFor`.
- **Bundle check**: OK, JavaScript unchanged (largest first-load JS /scrims/[id] 200.9 KB).
- **Lighthouse (mobile)**, production build, same method as above:

| Page | Protocol | Runs | Performance | Accessibility | Best Practices | SEO | LCP (sim.) | TBT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| / | HTTP/1.1 | 3 | 83 (was 88 with placeholders) | 100 | 100 | 100 | 4.51 s | 74 ms |
| / | HTTP/2 | 5 | 88 (was 95) | 100 | 100 | 100 | 3.37 s | 131 ms |
| /scrims | HTTP/1.1 | 3 | 84 (was 89) | 100 | 100 | 100 | 4.34 s | 100 ms |
| /scrims | HTTP/2 | 5 | **91** (was 93) | 100 | 100 | 100 | 3.05 s | 142 ms |

- Why performance dropped: the LCP element is now an image (home: the Free Fire panel background, 37 KB; /scrims: the banner character) instead of text. The image is not the slow part — it is requested first with `fetchpriority=high` and finishes before the first paint (LCP breakdown: load delay 0–114 ms, load time 0–59 ms, **render delay 81–87%**). As measured in the Lighthouse section above, this machine's headless Chrome paints its first frame late and Lighthouse's simulation charges the whole JS runtime to an image LCP. Tried: smaller widths for phones (512/768), lower alpha quality, and `fetchpriority=low` for the hero characters (+2–3 points). Measure on the preview deployment with PageSpeed Insights before optimising further.
- Gate: lint, typecheck, client-import audit, build, bundle budget pass. Vitest 45 files / 710 tests, coverage lib/ + server/ 87.6% lines. Playwright 82 / 82.
