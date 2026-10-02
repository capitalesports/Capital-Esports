# Build phases — Esports Platform (Free Fire, BGMI, Valorant)

Execute strictly in order. Do not start a phase until the previous phase's Acceptance section passes. docs/SPEC.md is the source of truth for features and rules.

## Design reference (read before every phase)

docs/design/pages/home-desktop.png is the visual source of truth for theme, spacing, typography and component style. More page designs will be added to docs/design/pages/ over time (e.g. scrims-mobile.png); when a page has a design file, reproduce it as closely as possible; when it does not, build the page from the same components and tokens so it looks like part of the same site.

Design tokens (use exactly, in Tailwind config and CSS variables):

| Token | Value |
| --- | --- |
| Background | #0B0B0D |
| Surface / card | #14141A |
| Border | #26262E |
| Gold accent | #E8B33A (hover #F2C75C) |
| Text primary | #F5F5F5 |
| Text secondary | #A0A0A8 |
| Free Fire accent | #F28A1E |
| BGMI accent | #2FBF8F |
| Valorant accent | #E8394B |
| Success / Error | #22C55E / #EF4444 |
| Headings | Barlow Condensed (Bold, ExtraBold), Google Fonts |
| Body | Inter, Google Fonts |
| Card radius / border | 12px, 1px solid Border, gold 1px border on the active/hovered card |
| Icons | lucide-react only |

Artwork rule: wherever the design shows an image (characters, backgrounds, card art, trophy), render it through one shared `<Artwork name="..." />` component. The component loads `/docs/design/assets/<name>.png` (copied into `public/art/` at build) if the file exists, otherwise renders a placeholder box of the same size (surface #14141A, 1px border #26262E, faint gold glow). Never draw or generate game logos, game characters or partner logos; show game names as styled text; hide the partners row until real logo files exist.

Expected asset names (may arrive later; do not block on them):

| Name | Used in |
| --- | --- |
| hero-freefire, hero-bgmi, hero-valorant | Home hero character panels (transparent) |
| bg-freefire, bg-bgmi, bg-valorant | Home hero panel backgrounds |
| banner-freefire, banner-bgmi, banner-valorant | Game strip cards |
| card-match-freefire, card-match-bgmi, card-match-valorant | Match cards |
| card-tournament-freefire, card-tournament-bgmi, card-tournament-valorant | Tournament cards |
| empty-no-matches, empty-no-team, empty-no-notifications, empty-offline, empty-profile | Empty states |
| trophy-podium | Winners carousel, tournament results |
| logo, app-icon | Navbar, PWA icon, favicon |
| og-background | Share images |
| texture-dark | Page background |

## Phase 0: project setup and CLAUDE.md

You are building a production esports platform for India (Free Fire, BGMI, Valorant). Read docs/SPEC.md fully before writing any code; it is the source of truth for features and rules.

Stack (do not substitute):
- Next.js (latest stable, App Router, TypeScript strict), Tailwind CSS, shadcn/ui
- Prisma ORM with PostgreSQL (Supabase or Neon connection string in env)
- Firebase Phone Authentication on the client for OTP only; our own session (httpOnly cookie, signed JWT) after verifying the Firebase ID token server-side with firebase-admin
- Cashfree Payment Gateway + Cashfree Payouts (added in Phase 6)
- Zod for all input validation, server actions or route handlers for mutations
- Vitest for unit tests, Playwright for end-to-end flows
- Deployed on Vercel; Vercel Cron for scheduled jobs

Tasks:
1. Scaffold the app with the stack above. Set up ESLint, Prettier, Husky pre-commit (lint + typecheck). Add npm scripts: dev, build, lint, typecheck, test, test:e2e.
2. Create .env.example listing every variable we will need across all phases (DATABASE_URL, FIREBASE_* client and admin keys, SESSION_SECRET, CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV, CASHFREE_PAYOUTS_CLIENT_ID, CASHFREE_PAYOUTS_CLIENT_SECRET, NEXT_PUBLIC_SITE_URL, CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PAYMENTS_ENABLED).
3. Write CLAUDE.md at the repo root with: the stack, folder conventions (app/, components/, lib/, server/, prisma/), coding rules (server-side validation for every mutation, no secrets in client code, all times stored UTC and displayed in IST, mobile-first, dark theme default), and the command list (dev, build, lint, typecheck, test, prisma migrate, prisma studio).
4. Create the base layout matching docs/design/pages/home-desktop.png: navbar (logo, Home, Scrims, Tournament, Leaderboard, Games dropdown, search field, Login and gold Get Started buttons), footer (partners row hidden until logo files exist, Follow Us icons), dark theme, and a design token file (Tailwind config + CSS variables) using exactly the tokens in the Design reference section. Build the shared <Artwork> placeholder component and a public/art/ copy step.
5. Add an empty page for every route in the spec so navigation works end to end.

Acceptance: `npm run build` and `npm run lint` pass, all routes render, CLAUDE.md and .env.example exist, first commit made. Do not implement auth or database logic yet.

## Phase 1: auth, sessions, profile, database schema

Read docs/SPEC.md and CLAUDE.md. Implement authentication, sessions, and the complete database schema.

Database (Prisma, one migration):
- User: id, phone (unique), displayName, dateOfBirth, avatarUrl, role enum (PLAYER, MODERATOR, ADMIN), strikes int default 0, bannedUntil nullable, banReason nullable, createdAt
- GameProfile: userId, game enum (FREE_FIRE, BGMI, VALORANT), gameId (Free Fire UID / BGMI character ID / Riot ID), ign nullable, region nullable; unique on (game, gameId) and on (userId, game)
- Team: id, game, name, captainId; TeamMember: teamId, userId, status enum (INVITED, CONFIRMED)
- Match: id, game, kind enum (SCRIM, TOURNAMENT), mode enum (SOLO, DUO, SQUAD, FIVE_V_FIVE), title, startsAt (UTC), registrationClosesAt, maxSlots, entryFeePaise int, prizePaise int, status enum (UPCOMING, REGISTRATION_OPEN, REGISTRATION_CLOSED, LIVE, RESULTS_PENDING, COMPLETED, CANCELLED), roomId nullable, roomPassword nullable, streamUrl nullable, tournamentId nullable, createdById
- Registration: matchId, userId, teamId nullable, status enum (PENDING, PENDING_PAYMENT, CONFIRMED, WAITLISTED, CANCELLED, NO_SHOW), paymentId nullable, position int; unique on (matchId, userId)
- Result: matchId, teamId or userId, placement, kills, screenshotUrl, approvedById, approvedAt
- Season: id, game, startsAt, endsAt, isActive; PointsEntry: seasonId, userId, matchId, points, reason
- Tournament: id, game, weekOf, title, prizePoolPaise, rulesMarkdown, format enum (BRACKET, LOBBY_POINTS), winners JSON
- Payment, Payout: leave as minimal models with id and status, completed in Phase 6
- Ban: phone or gameId, reason, createdById; AuditLog: actorId, action, entityType, entityId, before JSON, after JSON, createdAt

Auth flow:
1. /login page: phone input (+91 default), invisible reCAPTCHA, Firebase signInWithPhoneNumber, OTP entry, 30-second resend cooldown, generic error text for wrong/expired code.
2. POST /api/auth/session: verify Firebase ID token with firebase-admin, upsert User by phone, issue signed httpOnly session cookie (7 days, rolling). Reject banned users with a clear message.
3. Middleware: protect /dashboard, /admin, and every registration action; redirect to /login with returnTo.
4. Server-side rate limit on session creation per phone and per IP.

Profile:
- /profile page with display name, date of birth, avatar upload (Supabase Storage or S3-compatible bucket, max 2 MB, image only), and one section per game to add that game's ID (validate Riot ID as Name#Tag).
- `isProfileComplete(user)` helper: name, DOB, and at least one game profile. Store nothing derived; compute it.
- Role check helpers: requireUser, requireModerator, requireAdmin, used by every server mutation.

Seed script: one admin user (phone from env), one season per game, 6 sample matches across the three games over the next 3 days.

Tests: Vitest for isProfileComplete, Riot ID validation, session cookie signing/verification, and the role helpers.

Acceptance: OTP login works with Firebase test numbers, session persists across reload, banned user cannot log in, profile saves and game IDs are unique across users, `prisma migrate dev` and `npm run build` pass, all tests green.

## Phase 2: admin panel and match management

Read docs/SPEC.md and CLAUDE.md. Build the /admin area. Only ADMIN and MODERATOR roles can access it; moderators see Matches, Results and Teams only.

Matches:
1. List with filters (game, kind, status, date range) and quick actions.
2. Create/edit form: game, kind, mode, title, start time (entered in IST, stored UTC), registration close offset (default 30 min before start), max slots, entry fee (INR, stored paise), prize, stream URL, tournament link. Validate with Zod on the server.
3. Clone action: duplicate a match to another date/time in one click; bulk clone "same match daily for the next N days".
4. Status controls: open registration, close registration, set room ID + password, mark live, move to results pending, cancel (with reason). Every transition follows the state machine in the spec; illegal transitions are rejected server-side.
5. Cancelling a match marks all registrations CANCELLED and enqueues refunds (a no-op stub until Phase 6).

Scheduled jobs (Vercel Cron, protected by CRON_SECRET, runs every 5 minutes):
- UPCOMING -> REGISTRATION_OPEN at the configured open time
- REGISTRATION_OPEN -> REGISTRATION_CLOSED at registrationClosesAt
- REGISTRATION_CLOSED -> LIVE at startsAt
- LIVE -> RESULTS_PENDING at startsAt + expected duration (20/30/60 min by game)
Make transitions idempotent.

Users:
- Search by phone, name, game ID. Detail view: profiles, registrations, strikes, points, audit trail.
- Ban/unban with reason and optional end date; banning also adds the phone and all game IDs to the Ban table.
- Reset a game profile, merge duplicate accounts (move registrations and points, then soft-delete the duplicate).

Teams: view rosters, remove a member, transfer captain.

Content: editable rules/FAQ (markdown), sponsors list (name, logo, URL, order), social links, home carousel items.

Audit log: every admin/moderator mutation writes an AuditLog row with before/after JSON. Add an /admin/audit page with filters.

Tests: Vitest for the match state machine (every legal and illegal transition), cron job idempotency, and role guards on every admin route.

Acceptance: an admin can create a scrim, clone it for 3 days, open registration, set room credentials, and cancel one; a moderator cannot reach Users or Content; cron transitions move a test match through every state; all mutations appear in the audit log; all tests green.

## Phase 3: scrims, registration, teams, waitlist, room reveal

Read docs/SPEC.md and CLAUDE.md. Build the player-facing scrims flow.

Pages:
1. /scrims: today + next 3 days, grouped by day, filter by game and mode. Card shows game badge, title, time in IST, slots filled/total, entry fee, prize, status pill, and a Register / Waitlist / Closed button. Public, no login needed to view.
2. /scrims/[id]: match detail, rules snippet, registered squads count, stream link if present, and the room credentials panel (see below).
3. /games/[game]: that game's scrims, current tournament summary, top 10 of its leaderboard.

Registration rules (enforce all on the server, inside one database transaction with a row lock on the match):
- Requires login and isProfileComplete; a profile for that specific game must exist. If not, redirect to /profile with a message naming what is missing.
- Reject if the user is banned, has an active strike block, is already registered, or the match is not REGISTRATION_OPEN.
- Solo/duo: register the user directly. Squad / 5v5: the captain picks a team of the right size for that game (4 or 5). Only CONFIRMED members count; registration is PENDING until all members confirm, then CONFIRMED. If the match fills first, the team is WAITLISTED.
- Slots full -> WAITLISTED with a position. On any cancellation, promote the first waitlisted entry and notify.
- Cancel registration allowed until registrationClosesAt.
- If entryFeePaise > 0, registration stays PENDING_PAYMENT until Phase 6 wires Cashfree; for now show "payments coming soon" and block paid matches.

Teams:
- /teams: create a team per game, invite by game ID (must be an existing profile), accept/decline invites, leave team, captain removes members. A user can be in one team per game.

Room credentials:
- Server returns roomId and roomPassword only when: the requester has a CONFIRMED registration for that match AND now >= startsAt - 15 minutes AND status is REGISTRATION_CLOSED or LIVE. Never include them in any list endpoint or page props otherwise.
- Show a countdown until reveal on the match page.

Dashboard /dashboard: my upcoming matches (with reveal panel), my history, my teams, my strikes, my points per game.

Tests: Vitest for registration rules and waitlist promotion; a concurrency test where two users race for the last slot; a test asserting room credentials are absent from every public response before the reveal window; Playwright for login -> profile -> register -> see credentials after reveal.

Acceptance: registering without a profile redirects correctly; the slot race yields one CONFIRMED and one WAITLISTED; cancelling promotes the waitlist; room credentials are absent before the reveal window and present after; a squad registers only once every member confirms; all tests green.

## Phase 4: results, points, leaderboards, seasons

Read docs/SPEC.md and CLAUDE.md. Build result submission, point calculation, and per-game leaderboards.

Result submission:
1. When a match is RESULTS_PENDING, each confirmed registrant (captain for teams) can upload one end-screen or scoreboard screenshot (max 5 MB, image only) and, for BR games, enter their placement and kills. Valorant: winning captain marks the result and optionally pastes a tracker link.
2. Moderator view /admin/results/[matchId]: all submissions side by side, editable placement/kills per team, conflict highlighting when two teams claim the same placement, Approve button.
3. Approve runs the points calculation in one transaction, writes PointsEntry rows, sets status COMPLETED, logs to AuditLog. Reopen (within the 2-hour dispute window or by admin any time) sets RESULTS_PENDING and reverses the PointsEntry rows.

Points engine (lib/points.ts, pure functions, fully unit-tested):
- Configurable table per game stored in a PointsConfig model (placement -> points, killPoints, tournamentMultiplier). Seed with: BR placement 1st 15, 2nd 12, 3rd 10, 4th 8, 5th 6, 6th 4, 7th-8th 2, 9th-12th 1, 1 point per kill; Valorant win 3, loss 0; tournament multiplier 2.
- Team matches: every CONFIRMED member of the team receives the team's points.
- No-show handling: a confirmed registrant with no result is marked NO_SHOW and gets +1 strike; 3 strikes in a season -> bannedUntil = now + 7 days for registration only (still can log in).

Seasons and leaderboard:
- One active Season per game; /leaderboard/[game] shows rank, player, team, points, matches, wins, kills, with tiebreakers per spec (BR: points, wins, kills; Valorant: points, wins, round diff). Paginate 50 per page. Cache the computed board (materialized view or a LeaderboardSnapshot table refreshed on approve).
- Season end job: mark season inactive, snapshot final standings and top 3 into SeasonResult, create the next season, keep all history browsable at /leaderboard/[game]/seasons/[id].
- Admin: start/end season, export CSV.

Disputes and reports:
- "Report" button on player profiles and result pages creates a Report row (reason, evidence URL); moderators resolve in /admin/reports.

Tests: Vitest covering the points table, ties, team propagation, reversal on reopen, strike accumulation and the season rollover job; Playwright for admin approves result -> leaderboard updates.

Acceptance: approving a seeded match updates the leaderboard immediately; reopening removes the points; a player with 3 strikes cannot register but can log in; season rollover preserves history; all tests green.

## Phase 5: tournaments, home page, winners carousel, game pages

Read docs/SPEC.md and CLAUDE.md. Build tournaments and finish the public-facing pages.

Tournaments:
1. Admin creates one tournament per game per week: title, week, prize pool, rules (markdown), format. LOBBY_POINTS (Free Fire, BGMI): N matches linked to the tournament, standings = sum of points across them. BRACKET (Valorant): single elimination, 8 or 16 teams, matches auto-generated per round, winners advance on result approval.
2. /tournament/[game]: current week's tournament with registration (reuse Phase 3 registration, kind TOURNAMENT), rules, prize pool, live standings or bracket view, stream embed. Archive at /tournament/[game]/past.
3. On completion, admin publishes winners (top 3 with team name, avatar, prize). This creates the carousel items automatically.

Home page: reproduce docs/design/pages/home-desktop.png section by section (hero with three character panels and stats, game strip, Today's Matches with game filter chips and arrows, This Week's Tournaments, Leaderboard preview with game tabs, Why Play row, Partners + Follow Us footer). Mobile: stack the same sections, horizontal scroll for card rows.
- Hero with tagline and the three game cards (each linking to /games/[game], showing today's match count).
- Winners carousel: latest tournament winners across games, game logo on each card, auto-advance every 7 seconds, pause on hover/touch, manual dots and arrows, respects prefers-reduced-motion. Data from published winners; fall back to a "first tournament this week" card when empty.
- Today's matches strip, "How it works" (3 steps), sponsors row from admin content, social links (WhatsApp Channel, Discord, Instagram, Facebook, YouTube).

Other pages: /rules (per game, from admin content), /faq, /terms, /privacy, /refund-policy, /contact (form stores to a ContactMessage table).

Design pass:
- Consistent spacing scale, one accent per game (Free Fire, BGMI, Valorant each get a brand-adjacent accent used only on their cards and pages), skeleton loaders, empty states with a call to action, 44px minimum tap targets, Lighthouse mobile performance >= 90.

Tests: Vitest for bracket generation and advancement (8 and 16 teams) and lobby-points standings; Playwright for the carousel (auto-advance, pause on hover, dots).

Acceptance: a BGMI lobby-points tournament with 3 linked matches shows correct cumulative standings; a Valorant 8-team bracket advances winners automatically; publishing winners updates the home carousel; carousel rotation and pause behave as specified; all static pages render from admin-editable content; all tests green.

## Phase 6: Cashfree payments and payouts

Read docs/SPEC.md and CLAUDE.md. Integrate Cashfree Payment Gateway for entry fees and Cashfree Payouts for prizes. Use the official Cashfree Node SDKs and their current API docs; check the docs rather than assuming endpoint shapes. Use the sandbox environment until CASHFREE_ENV=production.

Entry fee flow:
1. Complete the Payment model: id, userId, matchId, registrationId, orderId (Cashfree), amountPaise, currency INR, status enum (CREATED, PAID, FAILED, REFUND_PENDING, REFUNDED), rawWebhook JSON, createdAt, paidAt.
2. On registering for a paid match: create the Registration as PENDING_PAYMENT and a Payment as CREATED, create a Cashfree order server-side with return_url and notify_url, return the payment_session_id to the client, open Cashfree checkout (UPI, cards, wallets).
3. Webhook /api/webhooks/cashfree: verify the signature with the secret, handle PAYMENT_SUCCESS / FAILED / USER_DROPPED idempotently by orderId. On success: Payment PAID, Registration CONFIRMED (or WAITLISTED if slots filled meanwhile, then auto-refund). Never trust the return_url redirect; the page after redirect polls our own order status.
4. Expire unpaid registrations after 10 minutes (cron) and free the slot.
5. Refunds: cancelling a match or a paid waitlist promotion failure calls the Cashfree refund API; track REFUND_PENDING -> REFUNDED via webhook.

Payouts:
1. Payout model: id, userId, tournamentId or seasonId, amountPaise, method enum (UPI, BANK), beneficiaryId, transferId, status enum (PENDING, PROCESSING, SUCCESS, FAILED, REVERSED), rawResponse JSON, approvedById.
2. Player adds a payout method in /profile: UPI ID (validate format) or bank account + IFSC. Register as a Cashfree beneficiary server-side.
3. Admin ledger /admin/payouts: list of prize obligations from published tournament winners and season top 3, Approve triggers a Cashfree transfer; webhook updates status. Two-step approval for amounts above a configurable threshold.
4. Players under 18: block payout method entry and show a message explaining a guardian account is required.

Safety:
- Store amounts as integer paise only. Every money mutation is a transaction with an AuditLog row.
- Feature flag PAYMENTS_ENABLED; when false, paid matches are hidden from registration.
- Reconciliation cron nightly: compare Cashfree order/transfer statuses with our records and flag mismatches.

Tests: Vitest for webhook signature verification (valid and tampered payloads), webhook idempotency (replayed events do not double-confirm or double-pay), refund state transitions, UPI and IFSC validators, and the payment expiry job; Playwright for a sandbox payment confirming a registration.

Acceptance: sandbox payment confirms a registration only via webhook; a dropped payment expires and frees the slot; cancelling a paid match refunds every PAID registration; a sandbox payout marks SUCCESS via webhook; webhook replay does not double-confirm or double-pay; all tests green.

## Phase 7: notifications, PWA, SEO, polish

Read docs/SPEC.md and CLAUDE.md. Add notifications, PWA support, SEO and the final UX pass.

Notifications:
1. Notification model (userId, type, title, body, url, readAt) and an in-app inbox with unread badge in the navbar.
2. Events: registration confirmed, waitlist promoted, room credentials available, match starting in 30 min, results approved, dispute opened/resolved, payout status. Each event writes an in-app notification and, if the user opted in, a push notification.
3. Web Push via VAPID keys (service worker, subscription stored per device). Add an opt-in prompt in the dashboard, not on first visit.
4. Optional WhatsApp/SMS reminder hook: a NotificationChannel interface with a console implementation now, so a provider can be added later without touching call sites.

PWA:
- manifest.json (name, icons, theme color, standalone display), service worker with offline fallback page and caching of static assets only (never cache authenticated data or room credentials). Install prompt on the dashboard after the first registration.

SEO and sharing:
- Metadata for every public page; dynamic OG images (Next.js ImageResponse) for match pages, tournament pages, and a per-player "rank card" at /leaderboard/[game]/card/[userId]. Share buttons on results and leaderboard pages.
- sitemap.xml and robots.txt; noindex on dashboard and admin.

Polish:
- Loading skeletons everywhere data loads; optimistic UI for register/cancel; toasts for every mutation.
- Accessibility pass: keyboard navigation for the carousel and menus, focus states, color contrast >= 4.5:1, aria labels on icon buttons.
- Empty states with a next action, error boundaries with a retry, 404 and 500 pages in the site theme.
- Analytics: page views and a funnel for login -> profile complete -> first registration (privacy-friendly, no third-party cookies).

Tests: Vitest for every notification event mapping and the reminder job; a test asserting the service worker never caches authenticated routes or room credentials; Playwright for the in-app inbox and OG image routes.

Acceptance: a match reaching startsAt - 30 min creates notifications for every confirmed player; push works on an installed PWA in Chrome Android; Lighthouse PWA and Accessibility checks pass; OG images render for a match and a rank card; all tests green.

## Phase 8: security review, tests, deploy

Read docs/SPEC.md and CLAUDE.md. Harden and ship.

Security review (fix everything you find, list what you changed):
1. Every server action and route handler validates input with Zod and checks role/ownership; grep for any mutation without requireUser/requireModerator/requireAdmin.
2. Room credentials, phone numbers, payout details and rawWebhook JSON never appear in client-visible props, list endpoints or logs. Add a test that fetches every public endpoint and asserts these fields are absent.
3. Rate limits on: OTP session creation, registration, result upload, report creation, contact form. Return 429 with a friendly message.
4. Webhook signature verification is mandatory and covered by a test with a tampered payload.
5. Security headers (CSP allowing Firebase and Cashfree domains only, HSTS, X-Frame-Options, Referrer-Policy), CSRF protection on mutations, file uploads validated by magic bytes not extension.
6. Secrets only in env; run a secret scan over the repo history.
7. Prisma: unique constraints on phone, (game, gameId), (matchId, userId); indexes on Match(startsAt, status), Registration(matchId, status), PointsEntry(seasonId, userId).

Tests:
- Vitest: full regression of points engine, registration state machine, waitlist promotion, Riot ID and UPI validators, webhook idempotency; coverage report >= 70% on lib/ and server/.
- Playwright (against seeded DB with Firebase test numbers): login -> complete profile -> register for a scrim -> see room credentials after reveal; admin creates match -> approves result -> leaderboard updates; sandbox payment confirms registration.
- CI: GitHub Actions running lint, typecheck, unit tests, Playwright on every PR.

Deploy:
- Vercel project with preview deployments; production env vars documented in docs/DEPLOY.md; Vercel Cron entries in vercel.json for the 5-minute state job, 10-minute payment expiry, nightly reconciliation and the season-end check.
- Database: managed Postgres with daily automated backups; write and test a restore procedure in docs/DEPLOY.md.
- Sentry for server and client errors with source maps; uptime check on / and /api/health.
- Launch checklist in docs/LAUNCH.md: Firebase production keys and authorized domains, Cashfree production credentials and webhook URL, VAPID keys, admin phone seeded, first season dates set, rules/FAQ/terms filled, social links set, PAYMENTS_ENABLED decision recorded.

Acceptance: CI green, all Playwright flows pass against a preview deployment, Lighthouse mobile >= 90 on Home, Scrims and Leaderboard, no High or Critical findings from `npm audit`, docs/DEPLOY.md and docs/LAUNCH.md complete.