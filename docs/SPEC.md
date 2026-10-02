# Esports Platform Spec — Free Fire, BGMI, Valorant

## Overview

A mobile-first esports website for India where anyone can browse daily scrims, weekly tournaments and leaderboards for Free Fire, BGMI and Valorant, and where registering for a match requires a phone-verified, completed profile.

Three product pillars: daily **Scrims** (today + next 3 days), one **Tournament** per week per game, and a per-game **Leaderboard** that resets every 3 months. Players enter through a game card on the home page and see only that game's matches, tournament and ranking.

Recommended launch order: Free Fire and BGMI first (mobile battle royale, same match logic), Valorant once the first two are stable (5v5, PC, different match structure).

## Access model and profile

Browsing is open; login is required only to register for a match, view room credentials, or join a team.

**Login: phone OTP via Firebase Phone Authentication** at launch. Google is the SMS sender, so no DLT registration, sender ID or template approval is needed. Firebase Phone Auth needs the Blaze plan with a billing account; set a budget alert. Use Firebase test phone numbers during development so abuse blocks are not triggered. Move to MSG91/2Factor (with DLT) or WhatsApp OTP later if volume or branding needs it; only the verification step changes, not the user database.

**Profile completion is mandatory before the first registration.**

| Field | Required | Notes |
| --- | --- | --- |
| Phone | Yes | OTP-verified, unique |
| Display name | Yes | |
| Age / date of birth | Yes | Needed for any paid entry or prize rules |
| Avatar | No | Image upload |
| Free Fire UID | Only to register in Free Fire | Numeric, unique across accounts |
| BGMI Character ID + IGN | Only to register in BGMI | Unique across accounts |
| Valorant Riot ID (Name#Tag) + region | Only to register in Valorant | Unique across accounts |
| Team | No | Captain creates, invites by game ID |

**Roles:** Player, Moderator (uploads results, handles disputes), Admin (everything). Store roles in the database, not in code.

**Anti-multi-account:** phone and every game ID are unique keys; a banned phone or game ID cannot re-register.

## Games and per-game structure

Every game gets its own page (scrims, tournament, leaderboard), reached from a game card on the home page or a game filter in the navbar. The two battle-royale titles share one match model; Valorant needs a second one.

| | Free Fire | BGMI | Valorant |
| --- | --- | --- | --- |
| Platform | Mobile | Mobile | PC |
| Format | Battle royale, many squads in one lobby | Battle royale, many squads in one lobby | 5v5, exactly 2 teams per match |
| Squad size | 4 (also solo/duo) | 4 (also solo/duo) | 5 |
| Match length | ~20 min | ~30 min | 40–60 min |
| Slot model | N squads per lobby, waitlist | N squads per lobby, waitlist | 2 teams per match, bracket for tournaments |
| Player ID field | UID | Character ID + IGN | Riot ID (Name#Tag) + region |
| Scoring | Placement + kill points | Placement + kill points | Match win/loss, round difference as tiebreaker |
| Result proof | End-screen screenshot | End-screen screenshot | Scoreboard screenshot or tracker link |
| Lobby setup | Custom room ID + password | Custom room ID + password | Host account creates custom lobby; map pick or veto |

Leaderboards are per game; a combined board would mix incompatible point systems. Winner cards on the home carousel carry the game logo.

## Navbar and pages

Navbar: **Home · Scrims · Tournament · Leaderboard · Login/Profile**, with a game switcher (Free Fire / BGMI / Valorant) on Scrims, Tournament and Leaderboard.

| Page | Contents |
| --- | --- |
| Home | Hero, three game cards, winners carousel (auto-rotates every 7 s, pauses on touch/hover, manual dots), today's matches, "how it works" strip, sponsors, social links |
| Game page | That game's today + upcoming scrims, this week's tournament, its leaderboard |
| Scrims | Today + next 3 days; card shows time (IST), slots filled/total, entry fee, prize, status; filter by game and mode |
| Tournament | Current week's event: format, prize pool, rules, bracket or points table; archive of past tournaments |
| Leaderboard | Current season per game, tiebreakers shown, past seasons archive, past champions |
| Player dashboard | My upcoming matches, room credentials, match history, points, team, notification settings |
| Rules & FAQ | Per-game rules, scoring, no-show and dispute policy |
| Legal | Terms, privacy policy, refund policy |
| Contact / Support | Form plus WhatsApp and Discord links |

Rename "Screens" to **Scrims**. The winners block is a prominent carousel at the top of Home, not a pinned element that follows the scroll; pinned blocks eat mobile screen space.

## Match lifecycle and registration rules

**Match state machine**

```
UPCOMING -> REGISTRATION_OPEN            admin opens, or scheduled open time
REGISTRATION_OPEN -> REGISTRATION_CLOSED 30 min before start; room ID + password visible to confirmed players 10–15 min before start
REGISTRATION_OPEN -> CANCELLED           too few players or admin cancels; entry fees refunded
REGISTRATION_CLOSED -> LIVE              at start time
LIVE -> RESULTS_PENDING                  match ends; moderator checks screenshots
RESULTS_PENDING -> COMPLETED             moderator approves; points posted
COMPLETED -> RESULTS_PENDING             dispute within 2 hours reopens results; points reversed
```

Illegal transitions are rejected server-side. Every transition is written to the audit log. A cancellation refunds any fee.

**Registration rules**

- Slot limit per match; extra registrations join a waitlist and are auto-promoted when a slot frees.
- Registration closes 30 minutes before start. Late joins are not possible.
- Squad games: the captain registers and invites teammates by game ID; all members confirm before the slot counts as filled.
- Room ID and password appear in the player dashboard only for confirmed players, 10–15 minutes before start. Never distribute them on WhatsApp.
- Reminders: in-app plus WhatsApp/SMS/push 30 minutes before start.
- No-show policy: 1 strike per missed match after registering; 3 strikes in a season = 7-day registration block.
- Result proof: BR games upload the end-screen screenshot; Valorant uploads the scoreboard screenshot or a tracker link. A moderator approves before points post.
- Valorant tournaments use a bracket (2 teams per match); BR tournaments use lobby points across a fixed number of matches.
- Match page shows the YouTube stream link when the match is streamed.

## Points, leaderboards and seasons

One leaderboard per game, one season every 3 months, tournament points worth more than scrim points. Points are the standard placement-plus-kills model for the BR games and win-based for Valorant; exact values are configurable.

| Rule | Free Fire / BGMI | Valorant |
| --- | --- | --- |
| Scrim points | Placement points (1st highest) + 1 point per kill | Win = 3, loss = 0 |
| Tournament points | Same table × 2 (or a separate tournament board) | Bracket placement points |
| Tiebreakers | Most wins, then most kills, then earlier achievement | Most wins, then round difference |
| Season | 3 months, resets for all games on the same day | Same |
| Reset behavior | Season archived; past seasons and champions stay visible | Same |

**Anti-cheat and disputes**

- Report button on every player profile and match result page.
- Ban list with reason and duration; banned phone and game IDs cannot re-register.
- Dispute window of 2 hours after results post; a moderator resolves and the audit log records the change.
- Top 3 of each season are verified manually before prizes are paid.

## Money: fees, prizes, payments, legal

Cashfree handles both entry fees and prize payouts; before enabling paid entry, check real-money gaming rules for the states you serve.

- Payments: Cashfree Payment Gateway (UPI, cards, wallets) for entry fees; Cashfree Payouts API for prize transfers to UPI or bank accounts, so winners are paid from the admin ledger without manual transfers.
- Refund policy page: automatic refund when a match is cancelled; no refund for no-shows.
- Prize ledger in admin: winner, amount, status (pending/paid), transaction reference.
- Minors: many players are under 18. Decide whether they can enter paid matches and how prizes are paid to them; collect date of birth in the profile.
- Legal: real-money gaming law differs by Indian state and some states ban paid entry. This is not legal advice; consult a lawyer before charging fees or paying cash prizes.

## Community and marketing

WhatsApp is the announcement channel, not a requirement; the site itself carries reminders and room credentials so nobody is locked out for skipping a group.

- WhatsApp Channel (not an open group) for daily schedules and results; strongly recommended at signup, never mandatory.
- Discord server for team finding and voice; competitive players expect it.
- Instagram, Facebook and YouTube linked in the footer and on Home; YouTube also hosts tournament streams.
- Sponsors section on Home and on tournament pages; this is the main revenue line while entry is free.
- Share cards on result and leaderboard pages ("Won today's BGMI scrim, ranked #4") with an OG image for organic reach.
- Winners carousel on Home shows the last tournament winners per game, rotating every 7 seconds.

## Admin panel

Build the admin panel first; without it every daily scrim is manual work in a database.

| Area | Functions |
| --- | --- |
| Matches | Create, edit, clone (daily scrims repeat), set game/mode/slots/fee/prize, open and close registration, set room ID + password, mark live, cancel with refund |
| Results | Upload or approve screenshots, enter placements and kills, publish points, reopen on dispute |
| Tournaments | Create weekly event per game, bracket or points table, set prize pool, publish winners to the Home carousel |
| Users | Search, view profile and history, ban/unban with reason, reset a broken profile, merge duplicate accounts |
| Teams | View rosters, remove a player, resolve captain disputes |
| Seasons | Start/end season per game, export leaderboard as CSV, archive |
| Prizes | Ledger of winners, amounts, paid/pending, transaction reference |
| Content | Edit rules, FAQ, sponsors, social links, carousel items |
| Audit log | Every admin and moderator action with who, what, when |

Moderators get Matches, Results and Teams only; Admins get everything.

## Technical: stack, OTP, security, ops

A serverless stack (Next.js + Postgres, hosted on Vercel) covers auth, database, file uploads and hosting without running servers.

| Concern | Choice |
| --- | --- |
| Frontend | Next.js (App Router, TypeScript strict), Tailwind, shadcn/ui; mobile-first, dark theme by default, PWA so players can install it and receive push notifications |
| Auth | Firebase Phone Auth for OTP only; own signed httpOnly session after verifying the Firebase ID token server-side |
| Database | PostgreSQL (Supabase or Neon) via Prisma; core tables: users, game_profiles, teams, matches, registrations, results, points, seasons, tournaments, payments, payouts, bans, audit_log |
| Files | Supabase Storage or S3-compatible bucket for avatars and result screenshots |
| Hosting | Vercel; Vercel Cron for scheduled jobs |
| Payments | Cashfree PG for entry fees, Cashfree Payouts for prizes; webhook-verified order status, never trust the client redirect |
| Time | Store UTC, display IST everywhere |
| Monitoring | Sentry for errors; basic analytics on page views and profile-completion drop-off |
| Backups | Daily database export; test a restore once |
| SEO | Match and tournament pages indexable, OG images for sharing, sitemap |

**OTP and abuse controls**

- Rate-limit OTP requests: 3 per phone per 15 minutes and a per-IP cap; 30–60 second resend cooldown on client and server.
- Generic error message for wrong or expired codes; never say which one.
- Firebase test phone numbers during development so real SMS is not sent and abuse blocks are not triggered.
- If moving off Firebase later: server-side 6-digit code from a crypto-secure random, stored hashed with a 5-minute expiry and a 5-attempt cap, deleted on success; Indian SMS then requires DLT registration of sender ID and templates.
- Unique constraints on phone and every game ID; room credentials served only to confirmed registrants by a server-side check, never embedded in the page for everyone.

## Build order and open questions

| Phase | Contents | Gate before next phase |
| --- | --- | --- |
| 1. Auth + admin | OTP login, profile fields, match creation | A test match can be created |
| 2. Scrims | Listing + registration, waitlist, room ID reveal | 50 players have played |
| 3. Results | Screenshot upload, point rules, leaderboard | Points post to the leaderboard |
| 4. Tournament | Weekly event, bracket / points table, winners carousel | First tournament completed |
| 5. Growth | Payments (Cashfree), notifications/PWA, sponsors + share cards | — |

Each phase is usable on its own. Launch with Free Fire and BGMI in phase 2 and add Valorant during phase 4.

**Open questions**

- [ ] Free entry only, or paid entry from day one?
- [ ] Exact placement and kill point values per game
- [ ] Squad-only scrims, or solo and duo lobbies too?
- [ ] Who hosts Valorant custom lobbies (a dedicated host account per match)?
- [ ] Season start date for the first 3-month leaderboard
- [ ] Prize payout method for players under 18
