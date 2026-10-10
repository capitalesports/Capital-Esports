import type { ContentKey } from "./content";

/**
 * Text shown until an admin saves other content in Admin → Content.
 * The legal pages describe how the site actually works; have them reviewed by a lawyer.
 */
export const DEFAULT_CONTENT: Record<ContentKey, string> = {
  "rules.FREE_FIRE": `- Squad (4), Duo or Solo. Up to 12 squads per lobby.
- Skills, pets and skins are allowed unless the match says "No Skills".
- No emulators.
- Points: placement + 1 per kill.
- Proof: screenshot of the final result screen.

### Clash Squad (1v1, 2v2, 4v4)

- Two sides per room. 1v1 players register alone; 2v2 and 4v4 teams are registered by the captain.
- Default Clash Squad settings unless the match says otherwise.
- Points: win 3, loss 0. Round difference breaks ties.
- Proof: final scoreboard screenshot.`,
  "rules.BGMI": `- Squad (4), Duo or Solo. Up to 16 squads per lobby. TPP.
- Map: Erangel unless announced.
- No emulators.
- Points: placement + 1 per kill.
- Proof: screenshot of the final result screen, uploaded by the captain.

### TDM (1v1, 2v2, 4v4)

- Two sides per room. 1v1 players register alone; 2v2 and 4v4 teams are registered by the captain.
- Team Deathmatch on the map named in the match.
- Points: win 3, loss 0. Round difference breaks ties.
- Proof: final scoreboard screenshot.`,
  "rules.VALORANT": `- 5v5, best of 1 unless announced. 1v1 and 2v2 matches run when announced.
- Tournaments: knockout bracket.
- Our host creates the lobby. Map as announced.
- Subs must be added to the team before registration closes.
- Points: win 3, loss 0. Tiebreaker: round difference.
- Proof: scoreboard screenshot, uploaded by the winning captain.`,
  "rules.general": `## General rules (all games)

1. **One account per player.** Fake or duplicate accounts = permanent ban.
2. **Same ID.** Play with the same in-game ID you added to your profile. Different ID = no points.
3. **Registration.** First come, first served. Registration closes 30 minutes before the match.
4. **Room ID.** Shown on the match page and your dashboard as soon as the admin posts it (usually 15 minutes before the start), only to confirmed players. Do not share it. Sharing = removed from the match + 1 strike.
5. **Be on time.** Join within 5 minutes of the room opening. Late = slot gone, no refund.
6. **Strikes.** Missing a match after registering = 1 strike. 3 strikes in a season = no registration for 7 days.
7. **No cheating.** Hacks, mods, scripts, teaming or bug abuse = permanent ban; all points and prizes removed.
8. **Results.** Upload your result screenshot within 15 minutes after the match. No screenshot = no points.
9. **Disputes.** Report a problem from the match page within 2 hours of the result being posted, with proof. The moderator's decision is final.
10. **Respect.** No abuse or spam. Toxic behaviour = warning, then ban.
11. **Refunds.** Only if we cancel the match. No refund if you cancel your registration, and none for no-shows, disconnects, or network or device problems. See the [Refund policy](/refund-policy).
12. **Prizes.** Sent to the winner's (for teams, the captain's) verified UPI or bank account within 2 working days after results are final.
13. **Streaming.** We may stream and record matches.
14. **Rules may change.** The rules shown here at match time apply.

## Scoring

- Battle royale: placement points (1st 15, 2nd 12, 3rd 10, 4th 8, 5th 6, 6th 4, 7th–8th 2, 9th–12th 1) + 1 point per kill.
- Head-to-head matches (Free Fire Clash Squad, BGMI TDM and Valorant): win 3, loss 0; round difference breaks ties.
- Tournament matches count double.`,
  faq: `## How do I register?

Log in with Google, complete your profile with your game ID, then open a scrim and tap Register.

## When do I get the room ID and password?

As soon as the admin posts them, on the match page and your dashboard — only for confirmed players.

## Is it free?

Scrims are free to enter unless the match shows an entry fee.`,
  terms: `*Last updated: 3 October 2026*

These terms apply to everyone who uses capitalesports.in ("Capital Esports", "we", "us"). Capital Esports is run from New Delhi, India. By creating an account or registering for a match you agree to them.

## 1. What we do

Capital Esports organises online scrims and tournaments for Free Fire, BGMI and Valorant. We are not affiliated with Garena, Krafton or Riot Games. Matches are played inside those games under their own terms of service, which you must also follow.

## 2. Your account

- You must be at least 10 years old. If you are under 18, you need the permission of a parent or guardian to use the site.
- Give your real date of birth and your own game ID. One person, one account: duplicate accounts are merged or banned.
- Keep your login private. You are responsible for what happens on your account.
- You can ask us to delete your account from your profile. An admin reviews every request.

## 3. Registering for matches

- Each match page shows the game, mode, start time, slots, entry fee (if any) and prize pool before you register.
- A slot is confirmed only when the site shows it as confirmed. When a match is full you may join the waitlist.
- Room IDs and passwords are only for confirmed players. Sharing them is not allowed.
- Not turning up after registering counts as a no-show. 3 no-shows in a season block registration for 7 days.

## 4. Entry fees

- Some matches have an entry fee, shown in Indian Rupees on the match page. Payment is handled by our payment partner. We never see or store your card, UPI PIN or bank login.
- Your slot is confirmed after the payment succeeds. Refunds follow our [Refund policy](/refund-policy).

## 5. Fair play

- No hacks, mods, emulators where not allowed, teaming with other teams, account sharing or playing on someone else's account.
- No abuse, threats or harassment of players or staff.
- Breaking these rules can lead to disqualification, loss of points and prizes, and a temporary or permanent ban. Prizes won by cheating are taken back.

## 6. Results and disputes

- Results are checked by our moderators against the screenshots or scoreboards submitted.
- You can dispute a result within 2 hours of it being posted, using the Report button. The moderator's decision after review is final.

## 7. Prizes

- Prize pools are shown on each match or tournament page. Winners are paid by UPI or bank transfer, normally within 2 working days after the results are final.
- Prizes are paid only to an account in the winner's own name. Prizes for players under 18 are paid through a parent or guardian.
- We may hold a prize while a dispute or a fair-play check is open, and we may ask for ID before paying.
- Applicable taxes, such as TDS where the law requires it, are deducted before payment.

## 8. Changes and cancellations

We may change the time of a match, or cancel it if too few players register or for reasons outside our control (game server problems, for example). Registered players are told on the site and by email. Entry fees for cancelled matches are refunded as described in the [Refund policy](/refund-policy).

## 9. Liability

The site and matches are provided "as is". We are not responsible for losses caused by game servers, your internet connection or device, or other things outside our control. Nothing in these terms limits rights you have under Indian consumer law.

## 10. Changes to these terms

We may update these terms. The date at the top shows the latest version. Continuing to use the site means you accept the updated terms.

## 11. Contact

Questions about these terms: **capitalesportssupport@gmail.com**. These terms are governed by the laws of India, and the courts of New Delhi have jurisdiction.`,
  privacy: `*Last updated: 3 October 2026*

This policy explains what Capital Esports (capitalesports.in, New Delhi, India) collects, why, and the choices you have.

## What we collect

- **Account details:** your name and email from Google, or the username and email you sign up with, and your profile photo if you add one.
- **Date of birth:** to check the minimum age and to pay prizes correctly to adults or guardians.
- **Game details:** your game IDs and in-game names, your team, the matches you register for, and the results and screenshots you submit.
- **Payment and payout details:** for paid matches, the payment status and reference from our payment partner (we never see your card, UPI PIN or bank login). For prizes, the UPI ID or bank account you give us.
- **Technical data:** basic logs such as IP address and browser, used to keep the site secure and to stop abuse.

## How we use it

To run matches and leaderboards, confirm slots, share room details with confirmed players, pay prizes, prevent cheating and duplicate accounts, and send you match updates. Emails about your matches can be turned off on your profile.

## What others can see

Your display name, avatar, in-game names, team and match results are public on the leaderboards and match pages. Your email, date of birth, phone number and payout details are never shown publicly. Only you and our staff can see them.

## Who we share it with

Only the services that run the site: hosting and database (Vercel, Neon), sign-in (Google Firebase), email (Resend), file storage (Vercel Blob) and our payment partner. We do not sell your data or use it for advertising.

## How long we keep it

As long as your account is active. When your account is deleted we remove your name, avatar, date of birth, email, game IDs and team memberships. We keep the minimum needed for bans, payment and tax records, and match history.

## Your choices

You can update your details on your profile, turn off emails, and ask us to delete your account from your profile. For any other request, email **capitalesportssupport@gmail.com**.

## Children

Players under 18 should use the site with a parent's or guardian's permission. Prizes for under-18 players are paid through a parent or guardian.

## Changes

We may update this policy. The date at the top shows the latest version.`,
  "refund-policy": `*Last updated: 3 October 2026*

This policy covers entry fees paid on capitalesports.in. Free matches have nothing to refund.

## Full refund

- **Match cancelled by us:** if we cancel a match for any reason, every entry fee is refunded in full, automatically.
- **Paid but no slot:** if your payment succeeded but your slot was not confirmed (for example, the match filled up while you were paying), the amount is refunded in full.
- **Charged twice:** a duplicate payment for the same slot is refunded in full.

## No refund

- If you cancel your own registration. You can still cancel before registration closes to free your slot for the waitlist, but the entry fee is not refunded.
- If you do not turn up (no-show).
- If you are disqualified or banned for breaking the fair-play rules.
- If you cannot join or play because of your own device, internet connection or game account.

## How refunds are paid

Refunds go back to the original payment method (UPI, card, net banking or wallet). We start the refund within 2 working days. Your bank usually credits it within 5–7 working days after that.

## Questions

If a refund has not reached you, email **capitalesportssupport@gmail.com** with your registered email and the match name.`,
  // A link, not markdown: empty hides the "Watch Video" button on /scrims.
  "scrims.video": "",
  "tournament.howToRegister": "",
};
