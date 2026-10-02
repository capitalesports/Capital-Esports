import type { ContentKey } from "./content";

/**
 * Text shown until an admin saves other content in Admin → Content.
 * The legal pages describe how the site actually works; have them reviewed by a lawyer.
 */
export const DEFAULT_CONTENT: Record<ContentKey, string> = {
  "rules.FREE_FIRE": `## Free Fire rules

- Squad lobbies are 4 players per team; solo and duo lobbies are individual.
- Join the custom room with the room ID and password shown on the match page and your dashboard as soon as the admin posts them.
- Use the in-game name linked to your registered Free Fire UID.
- Emulators, hacks, teaming with other squads and account sharing are not allowed.
- Upload the end-screen screenshot after the match.

### Clash Squad (1v1, 2v2, 4v4)

- Two sides per room; 1v1 players register alone, 2v2 and 4v4 teams are registered by the captain.
- Default Clash Squad settings unless the match description says otherwise.
- The winning side scores; round difference breaks ties on the leaderboard.
- Each side submits win or loss with the final scoreboard screenshot.`,
  "rules.BGMI": `## BGMI rules

- Squad lobbies are 4 players per team; solo and duo lobbies are individual.
- Join the custom room with the room ID and password shown on the match page and your dashboard as soon as the admin posts them.
- Your BGMI Character ID and IGN must match your profile.
- Emulators, hacks, teaming and account sharing are not allowed.
- Upload the end-screen screenshot after the match.

### TDM (1v1, 2v2, 4v4)

- Two sides per room; 1v1 players register alone, 2v2 and 4v4 teams are registered by the captain.
- Team Deathmatch on the map named in the match description.
- The winning side scores; round (or kill) difference breaks ties on the leaderboard.
- Each side submits win or loss with the final scoreboard screenshot.`,
  "rules.VALORANT": `## Valorant rules

- 1v1, 2v2 and 5v5 matches, two sides per match. 1v1 players register alone; 2v2 and 5v5 teams are registered by the captain.
- Tournaments are single elimination.
- The host creates the custom lobby; map pick or veto is announced before the match.
- Play on the Riot ID linked to your profile.
- Each side (the captain for teams) submits win or loss with the scoreboard screenshot or a tracker link.
- Round difference breaks ties on the leaderboard.`,
  "rules.general": `## Scoring

- Battle royale: placement points (1st 15, 2nd 12, 3rd 10, 4th 8, 5th 6, 6th 4, 7th–8th 2, 9th–12th 1) + 1 point per kill.
- Head-to-head matches (1v1, 2v2, 4v4 and 5v5: Free Fire Clash Squad, BGMI TDM and Valorant): win 3, loss 0; round difference breaks ties.
- Tournament matches count double.

## No-show policy

- Registering and not playing earns 1 strike. 3 strikes in a season block registration for 7 days.

## Disputes

- You can dispute results within 2 hours of them being posted. A moderator reviews and may correct points.`,
  faq: `## How do I register?

Log in with Google, complete your profile with your game ID, then open a scrim and tap Register.

## When do I get the room ID and password?

As soon as the admin posts them, on the match page and your dashboard — only for confirmed players.

## Is it free?

Scrims are free to enter unless the match shows an entry fee.`,
  terms: `## Terms of service

*Last updated: 3 October 2026*

These terms apply to everyone who uses capitalesports.in ("Capital Esports", "we", "us"). Capital Esports is run from New Delhi, India. By creating an account or registering for a match you agree to them.

### 1. What we do

Capital Esports organises online scrims and tournaments for Free Fire, BGMI and Valorant. We are not affiliated with Garena, Krafton or Riot Games. Matches are played inside those games under their own terms of service, which you must also follow.

### 2. Your account

- You must be at least 10 years old. If you are under 18, you need the permission of a parent or guardian to use the site.
- Give your real date of birth and your own game ID. One person, one account: duplicate accounts are merged or banned.
- Keep your login private. You are responsible for what happens on your account.
- You can ask us to delete your account from your profile. An admin reviews every request.

### 3. Registering for matches

- Each match page shows the game, mode, start time, slots, entry fee (if any) and prize pool before you register.
- A slot is confirmed only when the site shows it as confirmed. When a match is full you may join the waitlist.
- Room IDs and passwords are only for confirmed players. Sharing them is not allowed.
- Not turning up after registering counts as a no-show. 3 no-shows in a season block registration for 7 days.

### 4. Entry fees

- Some matches have an entry fee, shown in Indian Rupees on the match page. Payment is handled by our payment partner. We never see or store your card, UPI PIN or bank login.
- Your slot is confirmed after the payment succeeds. Refunds follow our [Refund policy](/refund-policy).

### 5. Fair play

- No hacks, mods, emulators where not allowed, teaming with other teams, account sharing or playing on someone else's account.
- No abuse, threats or harassment of players or staff.
- Breaking these rules can lead to disqualification, loss of points and prizes, and a temporary or permanent ban. Prizes won by cheating are taken back.

### 6. Results and disputes

- Results are checked by our moderators against the screenshots or scoreboards submitted.
- You can dispute a result within 2 hours of it being posted, using the Report button. The moderator's decision after review is final.

### 7. Prizes

- Prize pools are shown on each match or tournament page. Winners are paid by UPI or bank transfer, normally within 2 working days after the results are final.
- Prizes are paid only to an account in the winner's own name. Prizes for players under 18 are paid through a parent or guardian.
- We may hold a prize while a dispute or a fair-play check is open, and we may ask for ID before paying.
- Applicable taxes, such as TDS where the law requires it, are deducted before payment.

### 8. Changes and cancellations

We may change the time of a match, or cancel it if too few players register or for reasons outside our control (game server problems, for example). Registered players are told on the site and by email. Entry fees for cancelled matches are refunded as described in the [Refund policy](/refund-policy).

### 9. Liability

The site and matches are provided "as is". We are not responsible for losses caused by game servers, your internet connection or device, or other things outside our control. Nothing in these terms limits rights you have under Indian consumer law.

### 10. Changes to these terms

We may update these terms. The date at the top shows the latest version. Continuing to use the site means you accept the updated terms.

### 11. Contact

Questions about these terms: **capitalesportssupport@gmail.com**. These terms are governed by the laws of India, and the courts of New Delhi have jurisdiction.`,
  privacy: `## Privacy policy

*Last updated: 3 October 2026*

This policy explains what Capital Esports (capitalesports.in, New Delhi, India) collects, why, and the choices you have.

### What we collect

- **Account details:** your name and email from Google, or the username and email you sign up with, and your profile photo if you add one.
- **Date of birth:** to check the minimum age and to pay prizes correctly to adults or guardians.
- **Game details:** your game IDs and in-game names, your team, the matches you register for, and the results and screenshots you submit.
- **Payment and payout details:** for paid matches, the payment status and reference from our payment partner (we never see your card, UPI PIN or bank login). For prizes, the UPI ID or bank account you give us.
- **Technical data:** basic logs such as IP address and browser, used to keep the site secure and to stop abuse.

### How we use it

To run matches and leaderboards, confirm slots, share room details with confirmed players, pay prizes, prevent cheating and duplicate accounts, and send you match updates. Emails about your matches can be turned off on your profile.

### What others can see

Your display name, avatar, in-game names, team and match results are public on the leaderboards and match pages. Your email, date of birth, phone number and payout details are never shown publicly. Only you and our staff can see them.

### Who we share it with

Only the services that run the site: hosting and database (Vercel, Neon), sign-in (Google Firebase), email (Resend), file storage (Vercel Blob) and our payment partner. We do not sell your data or use it for advertising.

### How long we keep it

As long as your account is active. When your account is deleted we remove your name, avatar, date of birth, email, game IDs and team memberships. We keep the minimum needed for bans, payment and tax records, and match history.

### Your choices

You can update your details on your profile, turn off emails, and ask us to delete your account from your profile. For any other request, email **capitalesportssupport@gmail.com**.

### Children

Players under 18 should use the site with a parent's or guardian's permission. Prizes for under-18 players are paid through a parent or guardian.

### Changes

We may update this policy. The date at the top shows the latest version.`,
  "refund-policy": `## Refund policy

*Last updated: 3 October 2026*

This policy covers entry fees paid on capitalesports.in. Free matches have nothing to refund.

### Full refund

- **Match cancelled by us:** if we cancel a match for any reason, every entry fee is refunded in full, automatically.
- **You cancel in time:** if you cancel your registration on the match page before registration closes, your entry fee is refunded in full.
- **Paid but no slot:** if your payment succeeded but your slot was not confirmed (for example, the match filled up while you were paying), the amount is refunded in full.
- **Charged twice:** a duplicate payment for the same slot is refunded in full.

### No refund

- After registration closes, including if you do not turn up (no-show).
- If you are disqualified or banned for breaking the fair-play rules.
- If you cannot join or play because of your own device, internet connection or game account.

### How refunds are paid

Refunds go back to the original payment method (UPI, card, net banking or wallet). We start the refund within 2 working days. Your bank usually credits it within 5–7 working days after that.

### Questions

If a refund has not reached you, email **capitalesportssupport@gmail.com** with your registered email and the match name.`,
  // A link, not markdown: empty hides the "Watch Video" button on /scrims.
  "scrims.video": "",
};
