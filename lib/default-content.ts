import type { ContentKey } from "./content";

/**
 * Starter text shown until an admin saves real content in Admin → Content.
 * Legal pages are placeholders only and must be reviewed by a lawyer before launch.
 */
export const DEFAULT_CONTENT: Record<ContentKey, string> = {
  "rules.FREE_FIRE": `## Free Fire rules

- Squad lobbies are 4 players per team; solo and duo lobbies are individual.
- Join the custom room with the room ID and password shown on your dashboard 15 minutes before the start.
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
- Join the custom room with the room ID and password shown on your dashboard 15 minutes before the start.
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

Log in with your phone number, complete your profile with your game ID, then open a scrim and tap Register.

## When do I get the room ID and password?

15 minutes before the start, on the match page and your dashboard — only for confirmed players.

## Is it free?

Scrims are free to enter unless the match shows an entry fee.`,
  terms: `## Terms of service

These terms are a placeholder and must be replaced with terms reviewed by a lawyer before launch.`,
  privacy: `## Privacy policy

We collect your phone number, display name, date of birth and game IDs to run matches and prevent multiple accounts. We never show your phone number or date of birth publicly.

This policy is a placeholder and must be reviewed by a lawyer before launch.`,
  "refund-policy": `## Refund policy

- If a match is cancelled, entry fees are refunded automatically to the original payment method.
- No refunds for no-shows.

This policy is a placeholder and must be reviewed before paid entry is enabled.`,
  // A link, not markdown: empty hides the "Watch Video" button on /scrims.
  "scrims.video": "",
};
