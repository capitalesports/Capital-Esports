# Decisions

Spec ambiguities and convention choices, with the simplest option consistent with docs/SPEC.md. Newest at the bottom of each phase.

## Phase 0

| # | Decision | Why |
| --- | --- | --- |
| D0.1 | Brand name placeholder **"ArenaX"** in `lib/site.ts`. | Spec has no product name; one constant to change. |
| D0.2 | Next.js 16.3 (latest stable). Middleware is `proxy.ts` in this version. | Phase 0 says "latest stable". |
| D0.3 | Prisma 7.10 (latest stable `prev` tag; npm `latest` points at an 8.0 RC). Uses the `prisma-client` generator + `@prisma/adapter-pg`. | Avoid release candidates in production. |
| D0.4 | shadcn/ui with the Radix base. The generated `cn` helper was switched from the brand-new `cn` npm package to the standard `clsx` + `tailwind-merge`. | "Prefer boring, well-known libraries." |
| D0.5 | Button/input/select/tabs default heights raised to 44px (`h-11`); `sm` is 36px and only used in dense admin tables. | 44px minimum tap targets (Phase 5 design pass). |
| D0.6 | Dark theme is the default via `next-themes` (class strategy, system preference ignored); a light palette exists for a later toggle. | "Dark theme default". |
| D0.7 | Game switcher: `/scrims?game=<slug>` (with an "All games" option), `/tournament/<slug>` and `/leaderboard/<slug>` (index pages show game cards). Slugs: `free-fire`, `bgmi`, `valorant`. | Scrims filter by game per spec; tournaments and leaderboards are inherently per game. |
| D0.8 | Local dev/test Postgres runs in Docker (`esports-postgres`, port 5440). Dev server uses port 3100, e2e 3101 (3000 is taken on the dev machine). | No external credentials required to develop or test. |
| D0.9 | Playwright runs one "mobile-chrome" project (Pixel 7 viewport). `E2E_CHANNEL=chrome` makes it use the locally installed Chrome because the bundled browser download is blocked on this machine; CI installs the bundled Chromium. | Mobile-first; unblock local e2e. |
| D0.10 | Social links render as "coming soon" chips until an admin sets URLs (Phase 2 content). | Footer placeholders per Phase 0. |

## Phase 1

| # | Decision | Why |
| --- | --- | --- |
| D1.1 | Account bans use `bannedAt` + optional `bannedUntil` (null = permanent) + `banReason`. Strike blocks (Phase 4) use a separate `registrationBlockedUntil` column so the player can still log in. | Phase 1 needs "banned user cannot log in" while Phase 4 needs "blocked for registration only"; one column cannot mean both. |
| D1.2 | Valorant `gameId` is stored lower-cased (`name#tag`) for the unique key; the display form goes in `ign`. | Riot IDs are case-insensitive; keeps the spec's `@@unique([game, gameId])` exact. |
| D1.3 | Game ID formats: Free Fire UID 6–12 digits; BGMI Character ID 6–15 digits + IGN 2–20 chars; Riot ID name 3–16 letters/numbers/spaces, tag 3–5 letters/numbers; Valorant regions AP/EU/NA/KR/LATAM/BR. | Simplest checks matching the official formats. |
| D1.4 | Phone numbers normalised to E.164, country code defaults to +91; Indian numbers must be 10 digits starting 6–9. | "+91 default". |
| D1.5 | Date of birth required with age 10–100. | Spec requires DOB; blocks obvious garbage without deciding the minors policy (open question). |
| D1.6 | Session = HS256 JWT in httpOnly `session` cookie (SameSite=Lax, Secure on https), 7 days, re-issued by `proxy.ts` once older than 24 h (rolling). The user row is reloaded on every request, so bans/role changes/merges apply immediately. | Phase 1 auth flow. |
| D1.7 | Rate limits on session creation: 5 per phone and 30 per IP per 15 minutes, stored in Postgres (`RateLimit` table). OTP send limits and the resend cooldown are enforced by Firebase server-side plus a 30 s client cooldown. | Firebase sends the SMS, so our server only sees the verified token. Postgres works across serverless instances without extra infrastructure. |
| D1.8 | OTP stub: when Firebase admin credentials are absent **and** `AUTH_OTP_STUB=true`, the server accepts `stub:<phone>` tokens; the client stub accepts code 123456. Refused when `VERCEL_ENV=production`. | Lets dev, Vitest and Playwright run without Firebase, keeping the real Firebase code path in place. |
| D1.9 | Firebase ID tokens are verified with `checkRevoked=true` and must have `auth_time` within 10 minutes. | Limits token replay. |
| D1.10 | Storage: Supabase Storage via its REST API when `SUPABASE_URL` + service key are set; otherwise local disk under `.uploads/` served by `/api/files/*` (refused on production). Uploads are validated by magic bytes (PNG/JPEG/WebP/GIF). | Spec allows Supabase or S3-compatible; REST avoids another SDK. |
| D1.11 | Images are downscaled in the browser before upload (avatar 512 px, screenshots 1600 px); the server still enforces 2 MB / 5 MB. | Vercel caps function request bodies at 4.5 MB. |
| D1.12 | First season starts at 00:00 IST on the seed day and lasts 3 months (all games same dates). | Open question "season start date"; admins can end/start seasons in Phase 4. |
| D1.13 | Team registrations get per-match roster rows (`RegistrationMember`, unique per match+user) so "all members confirm" and team point propagation are exact, and a player can't appear twice in one match. | Spec: "all members confirm before the slot counts". |
| D1.14 | The package is ESM (`"type": "module"`). | Prisma 7's generated client is ESM-only; Playwright/tsx need it to import it. |
| D1.15 | Admin role checks run in the admin layout (any staff) **and** in every admin page (`requireStaffPage(path)`), because layouts don't re-render on client-side navigation. Players get a 404 for /admin. | Moderators must not reach Users/Content even via client navigation. |

## Phase 2

| # | Decision | Why |
| --- | --- | --- |
| D2.1 | Cancel is allowed from UPCOMING, REGISTRATION_OPEN and REGISTRATION_CLOSED (spec lists only REGISTRATION_OPEN). Never from LIVE or later. | Admins must be able to cancel before opening or just after closing (e.g. host/lobby problems); refunds still apply. |
| D2.2 | The generic status buttons cover open/close/live/results-pending; COMPLETED only via result approval (Phase 4); CANCELLED only via the cancel action (reason required). | Keeps points posting and refunds tied to their own flows. |
| D2.3 | Lobby capacity for slot validation: Free Fire 48 players, BGMI 100, Valorant exactly 2 teams. Slots = capacity ÷ players per slot (solo 1, duo 2, squad 4, 5v5 5). | Spec gives no numbers; these are the standard custom-room sizes. |
| D2.4 | Cron opens registration whenever `registrationOpensAt` has passed; an overdue match walks forward one audited step per transition in a single run. Matches with no open time wait for an admin. | Simplest idempotent behaviour; nothing is stranded if cron is down. |
| D2.5 | Cron transitions use conditional updates (`WHERE status = from`), so overlapping runs apply each step exactly once. Audit rows from cron have `actorId = null` and action `match.status.auto`. | "Make transitions idempotent." |
| D2.6 | Clones keep the source's offsets (open time, close offset), copy fee/prize/stream/tournament, never copy room credentials, and start as UPCOMING. Bulk clone: 1–14 days. | Daily scrims repeat; credentials are per lobby. |
| D2.7 | Room credentials and passwords are never written to the audit log (`[set]` / `[redacted]`). | Spec: credentials never distributed outside the reveal flow. |
| D2.8 | Ban: sets the user's ban fields and adds `Ban` rows for the phone and every game ID with the same expiry. Unban lifts the user's current phone/game-ID bans. Admins cannot ban themselves or change their own role. | "Banning also adds the phone and all game IDs to the Ban table." |
| D2.9 | Merge moves registrations, roster entries, points, team memberships (+ captaincy) and game IDs the primary lacks; colliding rows stay with the soft-deleted duplicate; strikes are added. | Spec: move registrations and points, then soft-delete. |
| D2.10 | Admin role changes (Player/Moderator/Admin) are available on the user page. | Roles live in the DB; admins need a way to appoint moderators. |
| D2.11 | Content keys: rules per game + general rules, FAQ, terms, privacy, refund policy (markdown). Sponsors take a logo URL (https or an uploaded `/api/files/...` path). | Simplest admin-editable content. |
| D2.12 | Moderators also get the Reports section (Phase 4 disputes). | Spec: moderators handle disputes. |
| D2.13 | `/api/health` checks the DB (200/503); Playwright waits on it instead of `/`. | Needed for uptime checks (Phase 8) and for e2e startup ordering. |

## Phase 3

| # | Decision | Why |
| --- | --- | --- |
| D3.1 | Duo matches use individual registration (one slot per player, pairs form in the lobby); `maxSlots` for solo/duo counts players. Squad/5v5 register as a team via the captain. | Phase 3 text: "Solo/duo: register the user directly." |
| D3.2 | Every registration mutation runs in one transaction that first takes `SELECT … FOR UPDATE` on the match row. | Required; makes the last-slot race deterministic. |
| D3.3 | Slots are held by CONFIRMED and (Phase 6) PENDING_PAYMENT registrations. Squads in PENDING (waiting for member confirmations) do not hold a slot; the squad is placed (CONFIRMED or WAITLISTED) when the last member confirms. Waitlist order = `position`, assigned at registration (solo) or at completion (squad). | Spec: "Only CONFIRMED members count … If the match fills first, the team is WAITLISTED." |
| D3.4 | Captain picks exactly the squad size (4 BR, 5 Valorant) from confirmed team members, captain included; each member gets a per-match roster row (captain auto-confirmed). A decline cancels the squad registration (captain can re-register with someone else). Closing registration cancels squads still PENDING. | Simplest reading of "all members confirm before the slot counts". |
| D3.5 | A player can appear in only one registration per match (own registration or roster). | Anti-multi-entry. |
| D3.6 | Cancelling is allowed until `registrationClosesAt`; cancelling a slot-holding registration promotes the waitlist immediately. Only the registrant/captain cancels; members decline invitations instead. | Spec. |
| D3.7 | Room credentials are served only by `GET /api/matches/[id]/room` (`private, no-store`) and fetched by the client when the countdown reaches `startsAt − 15 min`; pages never embed them. Public queries use `publicMatchSelect`, which omits the credential columns. | "Never include them in any list endpoint or page props otherwise." |
| D3.8 | Teams: one confirmed team per game per player; max members = squad size + 3 subs (including pending invites); names unique per game (2–24 chars); invite by the invitee's in-game ID (case-insensitive for Riot IDs); a captain with teammates must hand over captaincy before leaving; a lone captain leaving deletes the team. | Phase 3 teams list; simplest consistent rules. |
| D3.9 | /scrims hides cancelled matches and shows scrims (kind SCRIM) from 00:00 IST today to the end of day +3. | "Today + next 3 days". |
| D3.10 | Notifications on confirmation/promotion/invites go through `server/services/notify.ts`, a no-op until Phase 7. | Call sites exist now; Phase 7 adds delivery. |

## Phase 4

| # | Decision | Why |
| --- | --- | --- |
| D4.1 | BR "wins" = 1st-place finishes. Valorant results store placement 1/2 for winner/loser. | Needed for the "most wins" tiebreaker. |
| D4.2 | "Earlier achievement" tiebreaker = the player whose most recent scoring entry is older (reached the total first). Players still tied share a rank. | Simplest measurable reading of the spec. |
| D4.3 | Squads: the captain submits one result for the team; kills entered are the team total. Every confirmed roster member receives the team's points, kills and win. | "Team matches: every CONFIRMED member of the team receives the team's points." |
| D4.4 | Approval is blocked while two entries claim the same placement (BR) or when not exactly one Valorant side is marked winner. Entries without a result at approval become NO_SHOW. | Conflict highlighting + no-show rule. |
| D4.5 | No-shows strike every player of the registration (solo player or the whole confirmed squad). At 3 strikes `registrationBlockedUntil = approval time + 7 days` (login unaffected). Reopening reverses the match's strikes and clears the block if strikes drop below 3. | Phase 4 strike rule + reversal on reopen. |
| D4.6 | Reopen deletes the match's PointsEntry rows (the audit log keeps the before/after), results must be approved again. Moderators may reopen within 2 h of approval; admins any time. | "Reopen … reverses the PointsEntry rows." |
| D4.7 | Leaderboard cache = `LeaderboardSnapshot` table rebuilt for the season inside the approve/reopen/rollover transaction. | Phase 4 allows a snapshot table; no materialized-view refresh plumbing needed. |
| D4.8 | Season-end cron runs daily at 00:05 IST; the next season starts exactly when the previous ends and lasts 3 calendar months; the name increments ("Season 2"). Strikes reset for everyone when the scheduled rollover runs (not when an admin ends one game's season manually). | "3 strikes in a season"; seasons reset for all games on the same day. |
| D4.9 | Admin "end season" archives (inactive + champions) without auto-creating the next; "start season" requires no active season for that game. | Explicit admin controls per spec. |
| D4.10 | CSV export quotes every cell and prefixes cells starting with `= + - @` with `'`. | Prevent spreadsheet formula injection. |
| D4.11 | Public player profile page `/players/[id]` (name, avatar, in-game names, season points/rank, teams) carries the Report button; phone and DOB are never shown. | Spec: "Report button on every player profile". |
| D4.12 | Report types: PLAYER, RESULT, DISPUTE. Disputes only within 2 h of approval and only by players of that match. Rate limits: 5 reports/hour/user, 10 result uploads/hour/user. | Spec dispute window; Phase 8 rate-limit list. |
| D4.13 | Tournament matches currently score ×2 with the normal table for both BR and Valorant; Valorant bracket placement points arrive with brackets in Phase 5. | Phase ordering. |

## Phase 5

| # | Decision | Why |
| --- | --- | --- |
| D5.1 | Every tournament owns a **sign-up list**: a `Match` with `isEntryList = true` (kind TOURNAMENT) that teams register for with the unchanged Phase 3 flow (roster confirmations, waitlist). It never goes live: cron and manual status controls stop it at REGISTRATION_CLOSED; it is excluded from results, dashboards and home/scrim lists. | "Registration (reuse Phase 3 registration, kind TOURNAMENT)" with no duplicated registration logic. |
| D5.2 | Format follows the game: Free Fire/BGMI → LOBBY_POINTS (squads, max squads ≤ lobby capacity); Valorant → BRACKET (8 or 16 teams). `weekOf` = Monday of the IST week of the start; one tournament per game per week. | Spec. |
| D5.3 | LOBBY_POINTS: admin adds N lobby matches (spaced by X minutes), then "Lock entries" closes sign-ups and copies every confirmed entry (with its roster) into each lobby match, moving them to REGISTRATION_CLOSED (room reveal + cron as usual). Idempotent. Standings = Σ (placement points + kills) × tournament multiplier over approved results; ties by wins, kills, best placement. | "N matches linked to the tournament, standings = sum of points across them." |
| D5.4 | BRACKET: "Generate bracket" requires exactly `bracketSize` confirmed teams and seeds by sign-up order with standard seeding (1v8, 4v5, 2v7, 3v6). When a bracket match's results are approved and its sibling is also decided, the next-round match is created with both winners (90 min after the later feeder; admin can edit) inside the approval transaction. Re-approval before the next match starts refreshes its entrants. No third-place match: 3rd = semifinal loser with the better round difference. Each bracket win scores 3 × 2 season points. | "Winners advance on result approval"; simplest bracket placement points. |
| D5.5 | Publishing winners stores `[{place, name, avatarUrl, prizePaise, userIds}]` on the tournament (the Phase 6 payout ledger reads it) and creates/updates one carousel card per tournament ("X won T", subtitle with 2nd/3rd, game badge, link to the archive). | "Creates the carousel items automatically." |
| D5.6 | Carousel: 7 s auto-advance (timer resets on every slide change); paused while hovered, touched or focused; dots (44 px targets) + arrows + arrow keys; no auto-advance under `prefers-reduced-motion`; slides ordered by admin order, then newest. Empty → "first tournament this week" card. | Spec. |
| D5.7 | Static pages render admin content with starter text (`lib/default-content.ts`) until edited; legal pages are explicitly marked as placeholders that need legal review. | "All static pages render from admin-editable content." |
| D5.8 | Contact form stores `ContactMessage` (name, contact, message), is public, has a honeypot and a 3/hour/IP rate limit; admins see and close messages under Admin → Content. | Spec + Phase 8 rate-limit list. |
| D5.9 | Skeleton `loading.tsx` only on list pages (scrims list, current leaderboard, tournament, game pages, dashboard, admin), not on detail pages that can 404 — once a skeleton streams, the status is committed as 200. Unknown game slugs are 404'd in `proxy.ts`. `main` has `min-h-[85vh]` so the footer never jumps into view when content replaces a skeleton (CLS 0). | Correct 404 statuses + Lighthouse CLS. |
| D5.10 | Next 16 streams `generateMetadata` output into `<body>` for JS-capable clients; Lighthouse's `meta-description` audit only checks `<head>` and reports a false negative on those pages. Googlebot and HTML-only bots get the tags. Default kept (faster TTFB). | Next.js docs "Streaming metadata". |
| D5.11 | YouTube stream URLs are embedded via `youtube-nocookie.com`; other URLs show a link. | Privacy-friendlier embed; CSP allow-list in Phase 8. |

## Phase 6

| # | Decision | Why |
| --- | --- | --- |
| D6.1 | Payouts use Cashfree's v2 REST API directly (`fetch`, api-version 2024-01-01, endpoints/headers taken from Cashfree's own payouts SDK source and v2 docs). The official `cashfree-payout` package is unmaintained (last release 2024) and pins `axios@1.5.1` (known CVEs). PG uses the official `cashfree-pg` SDK with its error analytics (reporting to Cashfree's Sentry) switched off. | Official APIs, no vulnerable dependency, no third-party error reporting of our data. |
| D6.2 | Webhook signatures verified with our own timing-safe HMAC (same algorithm as the SDK: base64 HMAC-SHA256 of timestamp + raw body). No timestamp freshness window: replays are harmless because processing is idempotent (event log + forward-only state machines). | SDK comparison is not constant-time; Cashfree retries with the original payload. |
| D6.3 | A paid registration becomes PENDING_PAYMENT and **holds the slot** for 10 minutes (payment expiry). If the match is full, the player joins the waitlist without paying; a promoted waitlisted player gets a fresh 10-minute payment window. | "A dropped payment expires and frees the slot"; nobody pays for a waitlist spot. |
| D6.4 | A success webhook for a registration that lost its slot (expired or match cancelled) → WAITLISTED (if the match still runs) and an automatic refund. | Phase 6 rule. |
| D6.5 | Player self-cancel before registration closes: unpaid attempt → FAILED; paid entry → refunded. No refunds for no-shows. | Friendly and consistent with the refund page; spec silent on self-cancel. |
| D6.6 | Paid squads: after the last member confirms, the captain pays within 10 minutes. | Single payer per entry, reuses the same window. |
| D6.7 | Team prizes are paid to the team captain (`payeeUserId` in published winners); season prizes go to the archived champion at that place, amount entered by the admin after manual verification. | Simplest payee rule; spec requires manual verification of season top 3. |
| D6.8 | Payout methods: only masked details are stored (UPI `ra****@okaxis`, bank last 4 + IFSC); full details go only to Cashfree as a beneficiary. A new beneficiary id is registered on each change. Players under 18 cannot add a method and see the guardian message. | Minimise sensitive data; spec minors rule. |
| D6.8b | Two-step approval: payouts **above** `PAYOUT_TWO_STEP_THRESHOLD_PAISE` (default ₹5,000) need two different admins; the second approval sends the transfer. FAILED payouts can be approved again with a new transfer id. On a 5xx from Cashfree the payout stays PROCESSING (never blindly retried) and reconciliation checks it. | Spec + Cashfree guidance ("do not initiate another transaction on 5XX"). |
| D6.9 | Without Cashfree keys (and never on the Vercel production deployment) the app uses stub gateways and a local "Test checkout" page that sends a correctly signed webhook through the real handler. | Develop and test the full flow without credentials. |
| D6.10 | Crons: payment expiry every 10 minutes, reconciliation daily at 03:00 IST. | Phase 6 + 8. |

## Phase 7

| # | Decision | Why |
| --- | --- | --- |
| D7.1 | In-app notifications are always on; push is opt-in per player (`pushOptIn`) and per device (`PushSubscription`). Push goes out for confirmations, promotions, roster invites, room ready, 30-min reminder, results, dispute outcome and payouts; staff-only "dispute opened" is inbox-only. | Spec: "if the user opted in, a push notification". |
| D7.2 | The 30-minute reminder and the "room ID ready" notice run inside the existing 5-minute cron and are deduplicated with `reminderSentAt` / `roomNoticeSentAt` set by a conditional update before sending. Room notices never include the credentials. | One cron, exactly-once sends, credentials stay behind the reveal endpoint. |
| D7.3 | WhatsApp/SMS go through a `NotificationChannel` interface (console implementation) used only for match reminders. | Spec: provider can be added without touching call sites. |
| D7.4 | Service worker caches **only** `/_next/static/*`, `/icons/*` and `/offline.html` (same-origin GET, no query string). Navigations are network-only with the offline page as fallback; API responses, uploads and all HTML are never cached. It registers only in production builds. | "Never cache authenticated data or room credentials." |
| D7.5 | Push opt-in and install cards appear on the dashboard only once the player has at least one registration. | "Opt-in prompt in the dashboard, not on first visit"; install prompt "after the first registration". |
| D7.6 | Rank card = PNG route `/leaderboard/[game]/card/[userId]`; player pages use it as their OG image (`?game=` picks the game); "Share my rank" shares the player page. Match and tournament pages use `opengraph-image.tsx`. | Spec rank card path; rich previews when shared on WhatsApp. |
| D7.7 | Analytics are first-party: a beacon stores only path + time for page views (IP used transiently for rate limiting, no cookies, admin/API paths not tracked); funnel steps LOGIN → PROFILE_COMPLETE → FIRST_REGISTRATION are recorded once per user and shown on the admin dashboard (last 7 days). | "Privacy-friendly, no third-party cookies." |
| D7.8 | "Optimistic UI" for register shows the expected state immediately (useOptimistic) while the server call runs; every mutation toasts through `useAction`. | Polish requirement. |

## Phase 8

| # | Decision | Why |
| --- | --- | --- |
| D8.1 | CSP uses a per-request nonce + `'strict-dynamic'` for scripts (set in `proxy.ts`, passed to next-themes); styles allow `'unsafe-inline'` because inline style attributes are used (carousel transforms, toasts) and style injection is low-risk compared with scripts. | Phase 8: CSP allowing Firebase and Cashfree only; Next.js nonce guidance. |
| D8.2 | Vulnerable transitive packages are pinned with npm `overrides` (`deepmerge-ts ^8.0.2`, `mysql2 ^3.24.4`, `uuid ^11.1.1`) instead of downgrading Prisma to 6 as `npm audit fix --force` suggests. Prisma generate/validate/migrate verified after the override. | No High/Critical without a major downgrade. |
| D8.2b | Sentry uses `@sentry/nextjs` v11 with `dataCollection` locked down (no cookies, headers, bodies, query strings, user info) and only initialises when a DSN is set; source maps upload only with an auth token. | Avoid shipping session cookies/PII to a third party. |
| D8.3 | Registration rate limit: 20 attempts per player per 10 minutes. | Phase 8 rate-limit list. |
| D8.4 | E2E login helper clears session rate-limit counters before logging in (the suite logs the same admin in many times); rate limiting itself is covered by integration tests. | Deterministic e2e without weakening production limits. |
| D8.5 | CI (GitHub Actions) mirrors the local gate: Postgres service with three databases, migrate deploy, lint, typecheck, Vitest with coverage, Playwright (bundled Chromium), `npm audit --audit-level=high`, and a gitleaks job over full history. | Phase 8 CI requirement. |

## Run 2 — design reference

| # | Decision | Why |
| --- | --- | --- |
| R0.1 | The UI is dark-only: the Design reference defines one palette, so the light theme was removed (`next-themes` forced to dark). | "Use only the design tokens." |
| R0.2 | shadcn semantic variables are mapped onto the 12 design tokens (e.g. `--muted`/`--accent` = surface, `--primary` = gold with background-coloured text). A unit test fails if `app/tokens.css` contains any other colour. | One palette, enforced. |
| R0.3 | Brand name changed from the placeholder "ArenaX" to **"Esports"**, the wordmark in the design. Without a `logo` asset the navbar shows the wordmark as styled text (gold first letter). | Design shows "ESPORTS". |
| R0.4 | Artwork files are copied at install/dev/build/typecheck/test time and listed in a committed, generated `lib/art-manifest.ts`, so `<Artwork>` knows at build time which files exist (no runtime filesystem checks on Vercel). `public/art/` is gitignored. | Dropping a PNG needs no code change, only a rebuild. |
| R0.5 | lucide-react ships no brand icons, so "Follow Us" uses generic lucide icons (camera = Instagram, monitor-play = YouTube, messages = Discord, thumbs-up = Facebook, message = WhatsApp) with accessible names; platforms without a URL show a muted "coming soon" icon. | "Icons: lucide-react only"; never draw logos. |
| R0.6 | Navbar search goes to a new public `/search` page (players by display/in-game name, teams, matches; never phones or game IDs). "More" holds Rules, FAQ and Contact; legal links stay in the footer's bottom row. | Design shows a search field and a More menu without defining their content. |
| R0.7 | Partners row = active sponsors from Admin → Content (their logos are real files uploaded by the admin); hidden when there are none. | "Hide the partners row until real logo files exist." |

### R4.1 Leaderboard game tabs and rank markers
The design's Free Fire / BGMI / Valorant tabs on the leaderboard are the shared game switcher chips (already under the navbar on leaderboard pages), so there is one control, not two. Rank 1 gets a gold lucide crown; other ranks are plain numbers (the design's #3 glyph is ambiguous, so no invented medal). Podium places elsewhere use lucide Crown/Medal, never emoji.

### R5.1 Hero stats are real numbers
"Active Players" = users with a profile who are not merged/deleted, "Tournaments" = tournaments created, "Total Prize Pool" = tournament prize pools plus prizes of standalone non-cancelled scrims (tournament-linked matches are not counted twice). Shown in Indian units (K+, L+, Cr+). A stat that is zero is hidden instead of showing "0"; the design's 50K+/1K+/₹10L+ are illustrative, not copy.

### R5.2 Where the Phase 5 extras sit on the home page
The design has no winners carousel or "How it works"; Phase 5 requires both. They share one row ("Recent Champions" | "How It Works") between the tournaments/leaderboard row and "Why Play", so the design's order above and below is unchanged. "Watch Trailer" links to the admin's YouTube social link and is hidden when none is set. Hero panels link to /games/[game] and show today's match count (the Phase 5 hero bullet).

### R5.3 Sponsors live in the footer only
The spec wants sponsors on Home and on tournament pages. The footer's "Our Partners" row (shown only when sponsor logos exist) is on every page, so the old inline sponsors row on the tournament page was removed rather than duplicated.

### R5.4 Honest copy where the design makes claims
"Fair & Secure — Verified players, moderated results" (not "anti-cheat system", which the platform does not have) and "Active Community — Squads, Discord and WhatsApp updates" (not "Join thousands of gamers"). "India's biggest" stays because it is the design's headline.

### R5.5 Navbar dropdowns are disclosures, not menus
Games / More use the WAI disclosure-navigation pattern (a button with aria-expanded controlling a list of links; Escape, outside click, focus leaving and navigation close it). It is the recommended pattern for site navigation and removed Radix DropdownMenu + floating-ui (~45 KB gzipped) from every page. The mobile menu sheet and the toaster are loaded on demand for the same reason.

### R7.1 Fonts in generated images
ImageResponse can't use next/font's WOFF2 files, so Barlow Condensed 700/800 (SIL OFL 1.1, licence in `assets/fonts/`) are committed as WOFF. Barlow has no rupee sign, so next/og's bundled Geist is registered as a fallback and "₹" is rendered in its own text run; body lines stay in Barlow.

### R7.2 App icon and favicon
All icons (PWA 192/512/maskable, favicon, Apple touch icon) come from one renderer: the delivered `app-icon` artwork, else the brand's first letter in gold on the design surface. The create-next-app `favicon.ico` was removed so the tab icon matches the brand.

## Scrims page — docs/design/pages/scrims-desktop.png

### S1 Date chips select a day; "Upcoming" is the days after it
The four chips (Today, Tomorrow, then weekday + date, from the current IST day) choose the day shown in the first section ("Today's Scrims", "Tomorrow's Scrims", "Scrims on Tue, 29 Sep"). "Upcoming Scrims (Next N Days)" lists the days after the selected one within the 4-day window and disappears when the last day is selected. Filters, search and sort apply to both sections. Everything is in the query string (`game, date, mode, fee, prize, status, q, sort, view`); defaults are left out and unknown values fall back to defaults.

### S2 Card status comes from the registration rules (revised)
The pill is derived from the existing `cardAction` (rules unchanged): LIVE when the match is live; CLOSED when registration is over; WAITLIST when full; ALMOST FULL at ≥ 80% of slots taken (not full); otherwise REGISTRATION OPEN. **UPCOMING** (registration not open yet) shows a grey "UPCOMING" pill with the IST registration opening time under it: "Opens at 5:30 PM" when it opens today, "Opens 29 Sep, 5:30 PM" on a later day (the date is added so a bare time is never read as today); no note when the opening time is unset or already past. Paid matches while `PAYMENTS_ENABLED=false` keep **no pill**, also when UPCOMING (their button says "Coming Soon"). "Upcoming" is a pill only, not a Status filter option (the filter list is as specified). "Amber" WAITLIST uses the gold token (no amber in the palette).
_Revision: the first version showed no pill for UPCOMING; reverted at the owner's request._

### S3 Buttons and card variants
"Join Now" on today's matches, "Register" on later ones (both only when the rules allow joining; waitlist, closed and not-open labels are unchanged). The first section uses the design's today card (clock row, labelled amounts); Upcoming uses its compact card (calendar row, amounts without visible labels; labels stay for screen readers).

### S4 Filter semantics
Prize pool buckets: under ₹1,000 (< ₹1,000, includes no prize), ₹1,000–5,000 (inclusive), above ₹5,000. Sort: Start Time ascending, Prize Pool highest first, Entry Fee lowest first, Slots left most first; ties by start time. Search matches the title or game name. Selecting the highlighted game card again clears the game filter. Reset clears everything.

### S5 "View Calendar" is a URL view, not a modal
`view=calendar` swaps the Upcoming grid for a grouped-by-day view with a heading per day; an empty day says "No scrims yet for this day" and links to the next day that has matches.

### S6 The scrims video link is an admin content entry
Added content key `scrims.video` (Admin → Content). It must be empty or an https link (validated on save and again on render); empty hides "Watch Video".

### S7 One footer for both designs
home-desktop.png shows a partners row and "Follow Us"; scrims-desktop.png shows brand + tagline, links, social icons and copyright. The footer now stacks both: the partners row (only with sponsor logos), then the scrims design's bar, then a small legal row (Terms, Privacy, Refund policy, non-affiliation note) that neither design shows but the site needs. A `/games` index page was added for the footer's "Games" link.

### S8 Account menu
Avatar (photo or initials) + display name + role, opening Dashboard, Profile, Teams and Logout; moderators and admins also get "Admin panel". Same disclosure pattern as Games/More (shared `useDisclosure` hook). The bell shows a red dot instead of a count; the count stays in its accessible name.

### S9 No game chips under the navbar on /scrims
The design's game strip replaces them there; tournament and leaderboard pages keep the chips.

### S10 Trust row copy
Uses the design's four items with the same honest wording as the home page (R5.4): "Verified players, moderated results" and "Squads, Discord and WhatsApp updates" instead of "anti-cheat system" and "Join thousands of gamers".

## Performance pass (Lighthouse mobile on /scrims and /)

### P1 Measure the median of 5 runs, on HTTP/1.1 and HTTP/2
Single Lighthouse runs on this machine swing by up to 10 points. Scores are the median of 5 mobile runs against a production build. `next start` serves HTTP/1.1 (6 connections, and Lighthouse's simulation queues requests accordingly), but production on Vercel is HTTP/2, so runs are also made through a local HTTP/2 TLS proxy (Caddy). Both are reported; the HTTP/1.1 figure is never hidden.

### P2 Prefetch on intent for bulk links
Next's default `<Link>` prefetches every link entering the viewport. On /scrims that meant 13+ RSC requests during first load, competing with the page (and counted against LCP). Cards, chips, game strips and header/hero links use `IntentLink`, which prefetches on hover, touch or keyboard focus (Next's documented hover-triggered pattern, extended to touch and focus).

### P3 Local glyph for ₹
Neither Barlow Condensed nor Inter's latin subset contains ₹, so every price downloaded two extra latin-ext font files. A `unicode-range: U+20B9` face maps only ₹ to a device font (Segoe UI, Roboto, Noto Sans, Nirmala UI, Kohinoor Devanagari, Arial); where none exists the stack falls through as before. The ₹ glyph therefore looks slightly different per platform (it was never Barlow's).

### P4 Dark only without next-themes
The site was already forced to dark (R0.1); the provider only added client JS and an inline script. `<html>` carries `class="dark"` and `color-scheme: dark` statically; the toaster is told `theme="dark"`. The `next-themes` dependency is removed.

### P5 Deferred non-urgent work
The service worker registers 4 s after `load` (web.dev guidance: register after load; it is only needed for the offline page and push later). The page-view beacon is sent 2 s after load when idle, or immediately if the tab is hidden first, so no view is lost.

### P6 Cheaper artwork placeholder and header
The placeholder's "faint gold glow" is a radial gradient instead of a 48 px blurred inset shadow (same look, no blur pass), and the header is solid `bg-background` instead of a translucent backdrop blur (the designs show a solid bar).

### P7 Smaller DOM for hydration
Card icons are `<svg><use>` references to one lucide sprite (up to ~11 elements each before); the home leaderboard preview keeps only the active game's table in the DOM (the others render from props on tab switch). Below-the-fold sections are wrapped in `<Suspense>` so they hydrate as separate tasks.

### P2 (revised) No prefetch on first load anywhere
The first version used `IntentLink` only for bulk and above-the-fold links. The route audit then showed contextual links (back links, CTAs, result lists) still prefetching on load on 7 routes, so the rule is now site-wide: every internal link prefetches on intent only. It is enforced by ESLint (`no-restricted-imports` on `next/link`) and by `e2e/prefetch-budget.spec.ts` (budget 0 on 40 routes). Hovering gives desktop users the prefetch head start; on phones the prefetch starts at touch.

### P8 Bundle budget keyed by source modules
Chunk file names are content hashes, so the budget keys chunks by what they contain. Next's runtime chunks are keyed by position in `rootMainFiles`; app chunks by the client modules the client reference manifests map to them, plus their position in the module's chunk list; shared chunks by the route segments that load them. When code moves between chunks, the keys change and those chunks are reported as "new" instead of compared. The per-route first-load totals and the async-JS total still catch growth, so nothing escapes the 20% rule. Sizes are gzip level 9. The baseline is committed (`perf/bundle-baseline.json`) and updated deliberately in the PR that causes the growth.

### P9 Client import audit as the primary guard
The primary guard is static: any import path from a `"use client"` file to a server-only package or folder fails CI and prints the import chain, so the fix is obvious. The bundle check adds a content scan (for example the string `ZodError` in any client chunk) as a second line of defence against anything the static parser misses.

## Home page — home-desktop.png

### H1 Demo stats are seeded, editable, and must be replaced before launch (supersedes R5.1)
At the owner's request the hero shows admin-editable text, seeded with the design's demo values (50K+, 1K+, ₹10L+) so the page looks complete from day one. These are claims visitors will read as facts, so the admin form says they are demo values, and docs/LAUNCH.md has an item to replace them with true numbers or switch on live stats before launch. An empty value hides that stat.

### H2 "Use live stats" reuses the existing counts
The brief asked for the toggle only, with the calculation left for later. The real-count query already existed (`getHomeStats`: players with a profile, tournaments, prize money offered), so the toggle uses it and no new calculation was written. Zero values stay hidden, as before.

### H3 "Last Week's Winners" reads published podiums (supersedes the Phase 5 fallback card)
Slides are the newest tournament with published winners for each game, taken from the tournament record (public fields only). The section is hidden entirely until any tournament has published winners; the brief replaces PHASES Phase 5's "first tournament this week" fallback card. Admin carousel items are no longer shown on the home page; the admin Content page says so, and removing them is left for a later cleanup.

### H4 "Register Now" only while registration is open
The brief asks for an outlined "Register Now" button. It shows exactly that whenever the tournament's sign-up list is open. When sign-ups are closed or not yet open, the same outlined button reads "View Tournament", so the label never promises something the registration rules would refuse. Games without a tournament this week show "Announcing soon" and no button.

### H5 Section order follows the brief
The design shows This Week's Tournaments and the Leaderboard side by side. The brief puts "Last Week's Winners" (not in the design) between them, so the three stack in the brief's order. "How It Works" (PHASES Phase 5) is not in the brief's section list and was removed from the home page.

### H6 Past seasons
More → "Past seasons" opens a new "Past seasons" section on /leaderboard (all games, each season's podium, links to final standings). There was no cross-game list before.

### H7 Crown and medals for the top 3 (supersedes R4.1)
Rank 1 shows a gold crown and ranks 2 and 3 show lucide medals (foreground and muted tones, design tokens only). The number stays for screen readers. This applies to every leaderboard table.

### H8 Date aliases on /scrims
`/scrims?date=tomorrow` (and `today`) is accepted, so the home empty state can link to tomorrow without computing a date.

### H9 Hero panels
The taglines come from the admin settings ("Part one · part two", two lines). Each panel keeps the Phase 5 "N matches today" line. On phones the panels become a sideways-scrolling row of cards; the slanted edges apply on desktop only.

### H10 Trailer link has its own setting
"Watch Trailer" used the YouTube social link; it is now its own admin setting (https only), hidden when empty.

### P8 (revised) Chunks serving the same modules are budgeted as one group
Pairing chunks with the same module set by their position in the module's chunk list was not stable across builds. The first code change after the budget landed produced a false +3174% on a chunk whose route totals had not moved. Such chunks are now one group, and the group total is compared. Verified against a clean build of the previous commit: 0 unmatched keys, and the only failure was the genuine home-page growth.

## Match modes and operations gaps

### M1 Head-to-head modes in every game
At the owner's request every game gets head-to-head modes next to the battle-royale lobbies. Free Fire and BGMI offer Solo, Duo and Squad lobbies plus 1v1, 2v2 and 4v4 (Clash Squad / TDM custom rooms). Valorant offers 1v1, 2v2 and 5v5. Scoring follows the mode, not the game. Lobby modes use placement + kills. Head-to-head modes use win/loss (`winPoints`/`lossPoints` of the game's points config) with round difference as the tiebreaker, and they always have exactly 2 slots. 1v1 registers individually; 2v2, 4v4 and 5v5 register as a team of that size.

### M2 Tournaments carry a mode
The admin picks the mode when creating a tournament. Head-to-head modes make a single-elimination bracket (8 or 16 entries); lobby modes use lobby points. Existing tournaments were migrated to Squad (lobby) or 5v5 (bracket). The limit is now one tournament per game, mode and week, so a Free Fire Squad cup and a Free Fire 1v1 cup can run in the same week. "Current" tournaments are this week's and next week's. The tournament page switches between them with `?mode=`; the home card shows the soonest and "+N more".

### M3 Duo placements
Duo players register one by one and pair up in the lobby (D3.1), so two entries may share a placement in a Duo match; three or more is a conflict. Duo standings stay per player.

### M4 Walkovers
Approving a head-to-head match needs exactly one winner. If only one side played, the moderator marks it as the winner (walkover) and the absent side becomes a no-show. If nobody played, the match must be cancelled. In a bracket, a walkover loser counts as −13 round difference, which decides 3rd place between the semifinal losers.

### M5 Reopening results for finished tournaments
Reopening results of a tournament whose winners are published is admin-only and unpublishes the winners (the carousel card is hidden). A bracket match can be reopened only while the next-round match has not started; the advanced side is removed from it.

### M6 Tournament cancel and edit
Admins can cancel a tournament with a reason. Every open tournament match, the sign-up list included, is cancelled and refunded. Cancelling is refused while a match waits for results or winners are published. Start time, mode and size can be edited only while nobody has signed up and no matches exist.

### M7 Account deletion keeps the phone reserved
Players can delete their account. The phone number stays on the soft-deleted row, so strikes and bans cannot be dodged by signing up again. Deletion is refused while the player captains a team, has a pending payout, is in a match past its registration close, or is on another captain's roster in an unfinished match. Players can change their phone number after verifying the new one with OTP; a number held by another account or an active ban is refused.

### M9 Email: notifications and login by code
At the owner's request players can add an email on their profile. It counts only after they enter a 6-digit code sent to it. A verified email gets copies of the important notifications (slots, room IDs, results, prizes, cancellations, announcements) unless the player switches them off. The same email can be used to log in with a code. Accounts are still created with a phone number: email login works only for an account that verified that email, so bans, strikes and merges stay tied to the phone, and phone bans apply to email logins too. Codes are stored hashed, expire after 10 minutes, allow 5 wrong tries and work once. Code requests are rate-limited per email, IP and user. The login endpoint answers the same for unknown emails so it can't reveal who has an account. Email goes through Resend (`RESEND_API_KEY`, `EMAIL_FROM`). Without them, dev and tests print emails to the server console, and production refuses to send. Deleting an account frees its email.

### M10 Game IDs are asked for where they're needed (supersedes the profile's Game IDs section)
At the owner's request the profile no longer has a Game IDs section, and a complete profile is just a display name and date of birth. A game's ID is still required to play that game. When a player registers for a match without that game's ID, the registration box asks for it inline, then shows "Playing as <ID> · Edit" above the Register button, where a wrong ID can also be fixed. Creating a team asks for the team game's ID first, because teammates invite each other by game ID. Game IDs stay unique per game and still carry game-ID bans. On the profile, the phone and email are shown masked with a show/hide toggle and a "Verified" badge (they are never public). Date of birth is picked with day, month and year dropdowns.

### M11 Open entry: scrims never fill, they split into lobbies (supersedes the scrim waitlist)
At the owner's request standalone scrims take every registration: no max field, no "full", no waitlist. The lobby size follows the game and mode (Free Fire 48 players, BGMI 100, head-to-head 2 sides). When registration closes (cron or admin), a scrim with more entries than one lobby holds is split: the listing becomes lobby 1 and extra lobbies are created as their own matches (`parentMatchId`, `lobbyNumber`), each with its own room credentials, results, points and prize (the prize is per lobby, as the owner chose). Entries go in sign-up order into balanced lobbies (50 players → 25 + 25, never 48 + 2). Their rosters and payments move with them, and every player is told which lobby they are in. Head-to-head modes pair sides into games of two. With an odd count, the side left over stays on the listing's waitlist for an admin to decide: remove and refund it, or promote it if a game loses a side. Whatever is still unplaced when the games go live is cancelled and refunded automatically. The minimum-entries rule is checked on the whole listing before splitting. Extra lobbies are hidden from scrim listings (they are shown on the listing's page) and cannot be cloned. Tournament sign-ups and tournament matches keep a fixed capacity and the waitlist: a bracket needs exactly 8 or 16, and lobby-points standings assume one lobby.

### M12 Email required, exact in-game names, revealable UPI ID, open and upcoming matches on home
At the owner's request:
- Updates go out by email (not SMS), so a verified email is now part of a complete profile and is required to register. Players who haven't added one are sent to the profile, where the "Login & contact" card sits right below the details and marks the email as required.
- Free Fire now needs the exact in-game name next to the UID, as BGMI already did (Valorant's Riot ID includes the name). The name is kept exactly as typed, with capitals, symbols and inner spaces; only surrounding spaces are dropped and control characters refused. Registration asks for it inline when missing, and team rosters check it for every member.
- The full UPI ID is now stored (`PayoutMethod.vpa`) so its owner can reveal it on the profile with the same show/hide toggle as the phone and email. It is never written to audit logs, never returned by the save action and never loaded for admin views; bank accounts still keep only the last 4 digits.
- The home page's "Today's Matches" row became "Open & Upcoming Matches": every scrim and tournament match from today on that is upcoming, open, closed-but-not-started or live, soonest first (the hero's "N matches today" counts still count today only).

### M13 The captain enters the whole team (supersedes per-match roster confirmation)
At the owner's request a team registration no longer needs teammates' accounts, invites or confirmations. In team modes (Squad, 2v2, 4v4, 5v5) the captain types a team name and each teammate's game ID plus exact in-game name (Valorant: the Riot ID). The captain's own row comes from his profile. The slot is confirmed as soon as he submits, or held for his payment when there is an entry fee.

The server checks the roster:
- the team size for the mode, with every ID valid and every exact name present;
- no duplicate IDs, no banned game IDs, and no registration-blocked linked accounts;
- no player already playing in another team of the same match.

Roster rows (`RegistrationMember`) now carry `gameId` and `ign`, and their `userId` is set only when an account owns that game ID. Linked players get points, notifications, the room ID and "You play for <team>" on the match page. Players without an account appear by in-game name in results and admin views. The team name is stored on the registration (`teamName`) and shown in entry lists, standings, results and published winners. Rosters move with lobby splits and are copied into tournament lobby and bracket matches. The old flow (Team records, invites, "Confirm spot") still works for existing registrations, but the registration box no longer offers it.

### M14 Registration happens in a pop-up, with an IGL
At the owner's request, the match page's registration box now shows only a Register or Register team button. The player's own game ID is no longer a separate form in the box: it is entered or corrected in the pop-up's first card (Player 1 · IGL in team modes; Riot ID and region for Valorant, ID and exact in-game name for Free Fire and BGMI) and saved to the profile before registering. Whether registration is possible (open, not blocked, payments on for paid entry) is decided before the pop-up is offered. The button opens a pop-up dialog, whose code loads on first open so the page stays light.

The pop-up depends on the mode:
- **Individual modes (Solo, Duo, 1v1):** the player confirms their own details; there is no team name.
- **Team modes (Squad, 2v2, 4v4, 5v5):** the pop-up asks for the team name first. It then shows the registering player as **Player 1 · IGL (team leader)**, taken from their profile, followed by one card per other player with their game ID and exact in-game name (Valorant: the Riot ID). 2v2 has the IGL and 1 player, 4v4 and BGMI/Free Fire Squad have the IGL and 3, and Valorant 5v5 has the IGL and 4.

The IGL is the captain, stored as the registration's user; no extra column is needed. It is marked "IGL" in the player's roster view and in the admin registrations table. The server rules are unchanged (DECISIONS M13).

### M15 No Valorant region field
At the owner's request the Riot ID forms (registration pop-up, game ID form) have no Region field. Players are in India, which is Valorant's AP server, so the region defaults to AP, or keeps a region saved earlier. The server schema still accepts a region and defaults it to AP when none is sent.

### M16 Team registrations in admin and on the dashboard
Captain-entered rosters (M13) are not Team records, so the admin Teams page first lists **events** (tournament sign-ups, scrims, matches) that have team registrations, each with its team count. Opening one lists that event's teams: team name, IGL, and every player with a game ID and exact name. Solo, Duo and 1v1 entries are listed too, counted as players: each row shows the player with their own game ID. Searching by a team or player name lists matches across all events. Player identities are shown once (`playerIdLabel`): a Valorant Riot ID once as typed, and Free Fire/BGMI as "in-game name · ID". The player dashboard's "My upcoming matches" now includes tournament sign-ups (entry lists). Each one links to the game's tournament page and never shows room credentials.

### M17 Team join codes and registering with a saved team
Every team has a unique 5-letter code (A–Z without I and O; `lib/team-code.ts`), shown with a copy button on the team card. "Join a team" on /teams finds the team by code, and the player adds that game's ID if it is missing. They then join as a confirmed member directly, within the team's member limit, and not while in another team for that game. Lookups are rate-limited. The app picks an unused code, and a database default (`random_team_code()`) covers direct inserts.

The team registration pop-up offers two choices: **"Use my team"**, which ticks teammates who have a complete ID for the game, or **"Enter players manually"** (M13). Any confirmed member may register the saved team and becomes the IGL. The roster goes through the same validation as M13; the registration is linked to the team, whose name is used.

### M18 Staff email + password login
At the owner's request, admins and moderators can also log in with their email and a password. On the login page this is under "Log in with email instead", then "Staff? Log in with password". Players still log in with a phone OTP or an emailed code; a player account never has a password.

- Passwords are stored only as scrypt hashes (`lib/password-hash.ts`).
- A wrong password, an unknown email and a player's email all get the same answer.
- Attempts are rate-limited per IP and per email.
- A password is set with `scripts/set-staff-password.ts`. It reads the password from `STAFF_PASSWORD`, never from an argument, sets the email as verified and writes an AuditLog entry.

### M19 Locked date of birth; one team per player for joining
- A player sets their date of birth once. After that, only an admin can change it, from the admin user page, and the change is written to the AuditLog. The profile shows the saved date with a "contact support" link.
- A player already in a team (any game) doesn't see "Join a team". The server also refuses to let them join by code.

### M20 Room credentials as soon as they are shared
At the owner's request, room ID and password are no longer held back until 15 minutes before the start.
- A confirmed player (solo, captain, or linked roster member) sees them as soon as staff save them, on the dashboard and on the match page. This lasts until the match is over (results pending, completed or cancelled).
- Saving the credentials sends those players a notification.
- Waitlisted players, people who aren't registered and logged-out visitors never get them.
- The credentials still come only from `/api/matches/<id>/room`, never from page HTML.

### M21 No search box in the header or mobile menu
At the owner's request, the design's "Search players, teams or matches" box was removed from the desktop header and the mobile menu. Opening the menu also no longer pops up the phone keyboard. The `/search` page still works if opened directly, but nothing links to it.

### M22 Valorant rooms are a single code; no-show is never pre-ticked
- A Valorant custom game is joined with one party code, so a Valorant match has only a **Room code**, with no password. This applies to the admin form, to storage (`roomPassword` is null) and to the player's view (`lib/room-rules.ts`). Free Fire and BGMI still need a Room ID and a password.
- On the admin results page, "Did not play (no-show)" is no longer ticked for every entry that submitted nothing. Only a no-show the admin already saved stays ticked; the admin enters results or ticks no-show themselves.

### M23 WhatsApp community link in the header
At the owner's request, the header shows a "Community" link next to the notification bell. On phones only its icon shows; logged-out visitors see it too. It opens the WhatsApp link set in Admin → Content → Social links (the same one the footer, login and contact pages use), and is hidden while that link is empty. It shows the WhatsApp logo in green (see M24).

### M24 Real social logos
At the owner's request, the footer's social links and the header's Community link show the real WhatsApp, Discord, Instagram, Facebook and YouTube logos instead of generic lucide icons. The SVG paths come from the `simple-icons` package through `BrandIcon` (`components/common/brand-icon.tsx`). They are server-rendered, so they add no client JavaScript. They are drawn in `currentColor` (foreground, gold on hover, or `text-success`) instead of brand hex colours, keeping the design-token rule. Game logos and partner logos are still never drawn.

### M25 Admins can delete played matches
At the owner's request, an admin can delete a match that has players, including a completed one. Before, only empty matches could be deleted. The confirmation says how many registrations (and results and points) go with it.

When a played match is deleted, the server:
- takes back its leaderboard points and refreshes the standings,
- gives back the no-show strikes it gave,
- voids its prize payout if that is still pending,
- deletes the match together with its registrations and results, and writes the counts to the AuditLog.

The server still refuses to delete, and the admin should cancel the match instead, when:
- entry fees were paid, since refunds are needed;
- a prize payout is already approved or paid;
- the match was split into games;
- it is a tournament sign-up list or a bracket match.

### M26 Payout status set by hand; card times without "IST"
- On Admin → Prizes, each unpaid prize has a **Status** menu with three choices:
  - **Waiting** (PENDING);
  - **Processing** (being sent; the winner gets a "being processed" notification);
  - **Confirmed (paid)** (SUCCESS; asks for the UPI/bank reference, as "mark paid by hand" did).

  **Void** stays next to the menu. This covers prizes paid outside Cashfree. A payout sent as a real Cashfree transfer isn't changed by hand; its status comes from Cashfree. Transfers to the local stub gateway count as hand-paid. Every change is audited. The ledger and the player's winnings say Waiting / Processing / Confirmed or Paid, and "to pay" also counts payouts that are processing.
- Scrim cards show match times without the "IST" suffix, because the footer already says times are IST.
- The "Opens at …" note under an Upcoming pill has a dark backing, so it stays readable over the card art.

### M27 Match status changes on time
Registration opening and closing, going live and results pending are driven by the clock (`runMatchStatusJob`). That job only ran from Vercel Cron every 5 minutes, and never on a local dev server, so an admin could see "Upcoming" after the opening time had passed.
- **Catch-up on use:** `catchUpMatchStatuses()` (`server/jobs/status-catch-up.ts`) runs the status and reminder jobs before match data is read. This covers the scrims list, match page, tournament page, home rows, dashboard and admin match pages, and runs before a registration. It is throttled to once per 20 s per server instance, concurrent requests share one run, and errors are logged, not thrown. It is off in Vitest (tests drive the jobs themselves) or with `STATUS_CATCH_UP=off`.
- **Local dev:** `instrumentation.ts` calls `/api/cron/match-status` every 30 s while `npm run dev` runs. This needs `CRON_SECRET`.
- **Production:** Vercel Cron still runs every 5 minutes as the safety net. Vercel's Hobby plan allows only daily crons, so production needs the Pro plan (or an external pinger) for the 5-minute schedule; the catch-up covers the gap in any case.

### M28 Match emails: 30 minutes before, cancelled, and prize won
Players with a verified email (email notifications are on by default) get emails for:
- **Match starting in 30 minutes** (MATCH_STARTING_SOON, from the reminder job). This now runs on time; see M27.
- **Match cancelled** (MATCH_CANCELLED), with the reason and a refund note.
- **Prize won** (new PRIZE_WON): "You finished 1st in X and won ₹Y. You will receive your prize any time within 2 working days, paid to the UPI or bank account on your profile." It is sent when results are approved and a scrim prize payout is created for the winner, and when tournament winners are published (to each prize's payee). `PRIZE_PAYOUT_WORKING_DAYS` in `lib/notifications.ts` holds the 2 days.

The "slot confirmed" message no longer says room details come 15 minutes before the start (M20).

### M29 Continue with Google; phone verified once
At the owner's request, players can sign up and log in with Google. Every account still has a verified phone, because bans, merges and prize identity depend on it.
- **"Continue with Google"** (login page) uses Firebase's Google popup. The server verifies the ID token (`server/auth/google-verifier.ts`) and checks that it comes from Google with a verified email.
- **Known accounts:** an account already linked to this Google account (`User.googleId`), or one whose verified email is the Google email, logs in. The Google account is linked on first use.
- **New player:** the Google profile goes into a signed 30-minute `google_signup` cookie (`lib/google-signup-token.ts`). The player verifies their mobile number once with OTP. That phone login then fills the account from Google: name (if valid as a display name, otherwise the first name), email (verified), photo and the Google link. Fields the player already set are never overwritten, and an email or Google account that another account uses is never taken.
- **Date of birth:** Google does not share it with a normal sign-in (it needs a sensitive scope and Google's app review, and many accounts hide it), so the profile still asks once (and locks it, M19).
- **Dev/test:** without Firebase keys, a dev form takes the Google email and name and makes a stub token. Production refuses the stub. Going live needs the Google provider enabled in Firebase Authentication and the site's domain in its authorised domains.

### M8 Public team pages
`/teams/<id>` is public (name, game, captain, confirmed members, recent results). Only the exact `/teams` page (my teams) needs login. Match pages list confirmed entries by name only, never phone numbers or game IDs.

### M30 Brand name "Capital Esports" (first "Bright Esports")
At the owner's request, the brand is "Capital Esports" (`SITE_NAME` in `lib/site.ts`; it was "Bright Esports" for a day). The wordmark shows "CAPITAL" in gold and "ESPORTS" in white: on one line from the `sm` breakpoint, stacked on two lines on phones so the header keeps room for its buttons (checked at 360/390/412 px). The name also changes in page titles, the app manifest, share cards, the footer copyright, email text and the default push title. The home hero heading is the brand ("CAPITAL" / "ESPORTS" in gold) under the kicker "India's biggest esports platform"; the footer tagline stays. The "E" logo artwork is unchanged until a new logo file is dropped into `docs/design/assets/logo.png`.

### M31 Google sign-up without a phone (replaces the "phone once" step of M29)
At the owner's request, "Continue with Google" now creates the account straight away; a phone is not required. `User.phone` is optional (still unique).
- **Google sign-up:** a new Google player gets an account linked to the Google account, with the name, verified email and photo from Google. They finish the profile (date of birth) as usual. Existing accounts whose verified email matches log in and get linked.
- **Bans:** a ban now also records the account's email (`Ban.email`), and the Google, phone and email-code logins all check phone and email bans, so a banned player can't return through Google. Unbanning lifts only that player's own phone, email and game-ID records. A missing phone or email is never turned into a `null` filter, which would match other players' bans.
- **Money still needs a phone:** Cashfree requires the payer's and the beneficiary's mobile number. Registering for a paid match, paying an entry fee and adding a payout method ask for the mobile number (PROFILE_INCOMPLETE, "mobile number"), which the player adds and verifies on the profile ("Phone (optional)" → Add). Free matches need no phone.
- **Elsewhere:** WhatsApp/SMS reminders skip players without a phone. Admin user search also matches email, and the user list shows "email · Google" when there is no phone.
- The `google_signup` cookie and `lib/google-signup-token.ts` from M29 were removed.

### M32 Admin can reveal a winner's UPI ID to pay by hand
Prizes are paid by hand until Cashfree Payouts is set up: the admin sends the money from their own UPI app, then sets the status to Confirmed with the UTR (M26). That needs the full UPI ID, which until now only its owner could see (M12).
- On Admin → Prizes, an unpaid, un-voided prize whose winner added a UPI ID shows **Show UPI** (`revealPayoutUpi`). It returns the full UPI ID and account-holder name, with Copy.
- Admins only. Each reveal writes an AuditLog entry (`payout.revealUpi`) that names the payout and winner but never contains the UPI ID.
- After the prize is paid or voided it can't be revealed again.
- Bank accounts keep only the last 4 digits, so a bank-account prize can't be paid by hand from this page; winners should use UPI.

### M33 UPI ID without a phone
At the owner's request, a player without a mobile number (Google sign-up, M31) can add a UPI ID or bank account. Prizes are paid by hand for now (M26, M32), so no phone is needed for that.
- Without a phone, the method is saved with an `unregistered_…` beneficiary id and is not registered with Cashfree Payouts, because Cashfree needs a mobile number.
- **Approve** (automatic Cashfree transfer) refuses such a payout. It tells the admin to pay by hand (Show UPI) or to ask the winner to add their number and save the UPI again, which registers it.
- Paid entry fees still need a phone (M31).

### M34 Hover lift
At the owner's request, things rise slightly when the mouse is on them and settle back when it leaves.
- **Cards** (`card-ds-interactive`: match, game, tournament and event cards) rise 4px with a soft gold shadow, alongside the existing gold border.
- **Buttons** (default, gold-outline, outline, secondary, destructive) rise 2px, and pressing pushes them back down. Ghost and link buttons (icons, menus) don't move.
- Only on devices with a mouse (`hover: hover`), so a tap on a phone never leaves a card raised. It is turned off for people who chose reduced motion.

### M35 Hosting on Vercel
Production runs on Vercel (region `sin1`, next to the Neon Postgres database) at capitalesports.in.
- Uploads go to Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set (`server/providers/storage.ts`).
- The Hobby plan allows only daily crons, so `vercel.json` schedules them once a day. Registration opening and closing still happen on time because pages and registration catch match statuses up when they run (`server/jobs/status-catch-up.ts`).

### M36 Firebase ID tokens verified with jose
On Vercel, `firebase-admin/auth` fails to load (its `jwks-rsa` dependency `require()`s the ESM-only `jose`), which broke Google and phone login in production with "Something went wrong."
- `server/auth/firebase-id-token.ts` now verifies the token the way Firebase documents: RS256 against Google's securetoken public keys, with issuer `https://securetoken.google.com/<project>` and audience `<project>`. Both the OTP and the Google verifiers use it.
- The revocation check (`verifyIdToken(token, true)`) is dropped. Sign-in still requires a token from the last 10 minutes, and bans are enforced by our own `Ban` table, so nothing a revocation check caught is lost.

### M37 Phone login switch
New Firebase projects send no SMS at all until a billing account (Blaze plan) is linked (`auth/billing-not-enabled`). The owner chose to stay on the free plan for now.
- `NEXT_PUBLIC_PHONE_LOGIN=off` hides phone login on the login page and the "Add/Change phone" button on the profile. Players sign up and log in with Google. Staff can still use "Log in with email instead" for the password login.
- Players who already have a phone keep it, and it is still shown on their profile.
- Production sets it to `off`. Once billing is linked, remove the variable (or set `on`) and redeploy; nothing else changes.
- At the owner's request ("remove phone from everywhere"), the switch also hides the whole Phone row on the profile. Wording across the site now speaks of Google and email: the FAQ, privacy text, contact form, the profile's "Logged in as", and the admin user list, user page, audit search and ban text. Phone data and the phone login code stay in place behind the switch, so turning it back on needs no code change.

### M38 Sign up and log in with email and password
At the owner's request, **Get Started** opens `/signup`: username, email, date of birth and password, with "Continue with Google" and the WhatsApp link below. The login page has email + password first, then Google.
- **The email must be proven.** Sign-up creates the account and emails a 6-digit code (the same `EmailCode` codes as M12: 10 minutes, 5 tries, one use). The account can't log in until the code is entered. Then the profile is complete (name, date of birth, verified email), so the player lands on the dashboard.
- **An unproven email doesn't block its owner.** Someone could start a sign-up with another person's email. Until the code is entered, that email can still be taken: a second sign-up replaces the first; "Continue with Google" or verifying the email on a profile clears it from the unfinished account (`releaseUnprovenEmail`).
- **Password login is open to players.** Any account with a password and a verified email can use it (it was staff only). The answer is the same for an unknown email, an account without a password and a wrong password.
- **Forgot password:** "Forgot password?" logs in with a code sent to the verified email. There is no "set a new password" screen yet.
- **No email provider (live site before Resend):** sign-up says to use Google instead, and no account is created.
- Passwords: scrypt, at least 8 characters, with a show/hide button.

### M39 Account deletion needs an admin's approval
At the owner's request, players can no longer delete their account themselves.
- **Player:** the profile's "Delete account" section has **Request account deletion**, with an optional reason. While the request is pending, the account works as usual and the player can withdraw it. Only one request can be pending at a time.
- **Admin:** **Admin → Deletion requests** (admins only), plus a dashboard card with the pending count.
  - **Approve and delete** erases the account (`eraseAccount`, the old self-deletion with the same checks). Captains, payouts in flight and matches that can't be cancelled still block it, and the request stays pending.
  - **Decline** keeps the account and sends the player a notification with the admin's optional note.
  - Every step is audited (`user.deletionRequest.*`, `user.deleteAccount` with the admin as actor).
- **Erasing now also clears the Google link and the password,** like the email (M7 keeps only the phone). Before, a deleted Google account blocked that Google login forever. A migration clears both on accounts that were already deleted.

### M40 The admin panel is a 404 for logged-out visitors
At the owner's request, nobody outside the staff should see that an admin panel exists.
- `proxy.ts` answers **404** to any `/admin…` request without a valid session, instead of redirecting to `/login?returnTo=/admin…`.
- Players who are logged in already got a 404 (`requireStaffPage`), and moderators get one on admin-only sections.
- **Staff log in at `/login` first**, then open `/admin`. There is no separate admin login page, so nothing on the public site points to the panel.
- Server actions and route handlers still check the role on every call, so hiding the pages is an extra layer, not the protection itself.

### M41 Code clean-up
At the owner's request, unused code was removed. Every change was checked against typecheck, lint, all unit/integration tests, the full e2e suite and the bundle budget, with no change in behaviour.
- **Removed:**
  - Functions nothing called: `isTerminal`, `formatTimeIST`, `phoneSchema`, `clearSessionCookie`, `getActiveCarouselItems`, `formDataToObject`, `confirmedCount` (server query).
  - Three unused type aliases.
  - Six shadcn components no page used (avatar, badge, card, select, separator, tabs). Add them back with the shadcn CLI if needed.
  - The `firebase-admin` dependency: tokens are verified with `jose` since M36 (125 fewer packages).
- **Kept, although `knip` lists them:**
  - `public/sw.js`: the service worker, loaded by URL.
  - `scripts/set-staff-password.ts`: run by hand.
  - `tests/stubs/server-only.ts`: a Vitest alias.
  - `@prisma/client`: the generated client imports its runtime.
  - `pg`: the Prisma Postgres adapter.
  - Exports that are only used inside their own file: harmless, and some are kept on purpose for tests.

### M42 No refund when a player cancels
At the owner's request, a paid entry fee is refunded only when **we** cancel the match. This also covers the existing automatic refunds for a payment that arrives after the slot is gone, and for duplicate payments.
- A player can still cancel before registration closes. Their slot goes to the waitlist, but the payment stays `PAID` and no refund is started.
- An unpaid checkout attempt is still marked `FAILED`.
- On a paid match, the cancel confirmation says the fee is not refunded.
- The Refund policy and rule 11 on the Rules page say the same.

### M43 Razorpay Checkout for entry fees
At the owner's request, entry fees can be taken through Razorpay. Cashfree is no longer the only option.
- **Choosing the provider:**
  - `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` set → Razorpay. They win over Cashfree if both are set.
  - Otherwise Cashfree, otherwise the local stub (dev/test only).
  - Paid matches still need `PAYMENTS_ENABLED=true`.
- **The amount can't be changed by the player.**
  - The server creates the Razorpay order from our `Payment.amountPaise`, which is the match's entry fee. The order id is kept in `Payment.sessionId`; our order id goes in Razorpay's `receipt`.
  - The browser only opens Razorpay's popup for that order. The player never types an amount.
- **A payment counts only after checks.**
  - The popup's callback (`confirmRazorpayPaymentAction`) is verified with the key secret (HMAC of `order|payment`).
  - We then re-read the payment from Razorpay: same order, exact amount, INR, captured. An authorized payment is captured first.
  - Only then does `applyPaymentEvent` confirm the slot. A mismatch is refused and flagged.
- **Webhook:** `/api/webhooks/razorpay` checks `X-Razorpay-Signature` against `RAZORPAY_WEBHOOK_SECRET`.
  - `payment.authorized`, `payment.captured` and `order.paid` are settled the same way.
  - `refund.*` events close refunds.
  - `payment.failed` is only acknowledged, because a Razorpay order stays open for another attempt.
  - Money for an order we no longer know is recorded as a ReconciliationFlag for a manual refund.
- **Refunds** (only when we cancel; M42) go to `POST /payments/:id/refund` with our refund id as `receipt`. The existing refunds are listed first, so a retry never refunds twice.
- **Missed callbacks:** the payment-expiry and nightly reconciliation jobs look up the order's payments (`recoverPaidOrder`). A paid order is settled with its Razorpay payment id, which refunds need.
- **No phone needed:** Razorpay doesn't ask for the payer's mobile number, so the paid-entry phone check now applies only to Cashfree.
- CSP and Permissions-Policy allow `checkout.razorpay.com` and `*.razorpay.com`. The checkout script loads only when a player pays.
- Prizes are still paid by hand. RazorpayX Payouts needs a current account and is not built.

### M44 Entry-fee refunds can be made by hand
The test account's Razorpay refund API refused every request, and the owner will make refunds by hand when needed.
- Refunds are still sent to the provider automatically when we cancel a match. Failed refunds stay `REFUND_PENDING` and are retried nightly.
- **Admin → Prizes → "Entry-fee refunds to make"** lists every pending refund with:
  - the player, masked email and amount;
  - the match and reason;
  - the Razorpay payment ID, to search in the dashboard.
- **Mark refunded** (optional note) closes a refund the admin made by hand: Razorpay dashboard "Issue Refund", or UPI. The payment becomes `REFUNDED`, the nightly retry stops, and `payment.refund.manual` is audited. Admins only.
- **Never twice:** before creating a refund, the Razorpay gateway also checks the payment's `amount_refunded`. A refund made in the dashboard (which has no receipt from us) is treated as done, never sent again.

### M45 A 5-minute keep-alive for reminders
Vercel's Hobby plan runs crons once a day. The 30-minute match reminder, room notices and registration open/close only ran when someone opened a page, through the throttled catch-up (M27).
- `.github/workflows/keep-alive.yml` and a cron-job.org job call `GET /api/keep-alive` every 5 minutes. It runs the same throttled catch-up as a page view and answers `{"ok":true}`. cron-job.org rejects big responses such as a full page ("output too large"). No secret is involved.
- GitHub can delay scheduled runs by a few minutes, which the 30-minute reminder window absorbs. GitHub pauses schedules after 60 days without commits.
- **Only during playing hours** (12:00 PM to 11:55 PM IST; cron-job.org runs the same window as a second pinger). Each visit also wakes the database and the server, so first loads are fast in those hours. A database kept awake around the clock would use up the Neon free plan's monthly compute. Matches outside these hours get their reminder only if someone visits the site. A paid Vercel plan (crons every 5 minutes) or an external pinger such as cron-job.org would replace it.

### M46 Fewer emails: no email for "Room ID is ready" or "Results are in"
At the owner's request, to save the daily email quota (Resend free plan: about 100 a day), these two notices are now in-app only (bell, plus push if turned on):
- **Room ID is ready** (`ROOM_CREDENTIALS_AVAILABLE`)
- **Results are in** (`RESULTS_APPROVED`)

The 30-minute reminder email now says that the room ID and password are on the match page and dashboard. Slot confirmations, the reminder, cancellations, prizes and the other events are still emailed (`EMAIL_EVENTS` in `lib/notifications.ts`).

### M47 Emails only for slot, reminder and cancellation
At the owner's request, emails go out for three things only (`EMAIL_EVENTS`):
- the slot is confirmed (`REGISTRATION_CONFIRMED`, and `WAITLIST_PROMOTED` when a waitlisted player gets a slot);
- the match starts in 30 minutes (`MATCH_STARTING_SOON`);
- the match is cancelled (`MATCH_CANCELLED`).

Everything else is in the bell (and push, if turned on) only: prizes won, room ready, results, result submission, disputes, payouts, team and roster invites, lobbies, removals and announcements. This replaces M46 and the prize email of M28.

Account emails (sign-up and email-verification codes, login codes) are not notifications and are unchanged. A player in one match costs about 2 emails, so the free plan's ~100 a day covers about 45 players.

### M48 Results filled from screenshots; players don't submit
At the owner's request, players no longer submit their own results. Staff upload the end-of-match screenshots and the results form fills itself.
- **Admin → Results → match → "Fill from screenshots":**
  - Upload up to 4 screenshots, PNG, JPEG or WebP, 5 MB each.
  - Google Gemini (`GEMINI_API_KEY`, free tier available; `GEMINI_MODEL`, default `gemini-2.5-flash`) reads every row: in-game name plus rank and kills, or won/lost for head-to-head modes.
  - `lib/result-matching.ts` matches the names to the entries: team name, display names, saved IGNs and game IDs, roster IGNs.
  - Free Fire look-alike letters are folded (ᴀʟᴘʜᴀ → alpha), and names within 75% similarity count.
  - A squad's rows share its best placement and add up kills.
- **Nothing is saved by the read.** The editor fills its form. Each card says "Filled from the screenshot", "Check: read as …" (a close match, gold border) or "Not found". Names that matched nobody are listed. The admin checks, edits and approves as before.
- **Limits and safety:**
  - Moderators and admins only.
  - The match must be in Results pending.
  - Images are checked by magic bytes.
  - 30 reads per staff member per hour, to protect the free quota.
  - Screenshots go to Google for reading. They contain only in-game names and scores.
  - Without a key, or when the free quota is used up, the button says so and results are typed in by hand.
- **Players:** `PLAYERS_SUBMIT_RESULTS = false` (`lib/results-config.ts`) hides the player "Submit result" form and stops the "Submit your result" notice. The code stays, so setting it to true brings both back.
