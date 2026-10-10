/**
 * One-time pre-launch reset (owner's request, DECISIONS M53): every player account and everything
 * players or test runs created is deleted, so everyone signs up again. Staff accounts (admin,
 * moderators) and site settings stay.
 *
 * Kept:    staff Users (role ADMIN/MODERATOR, with their login), SiteContent, Sponsor, SocialLink,
 *          PointsConfig, Season.
 * Deleted: player Users and all player/test data (matches, tournaments, registrations, teams,
 *          results, points, leaderboards, payments, payouts, notifications, referrals, reports,
 *          contact messages, analytics, rate limits, audit log), in one transaction.
 *
 *   node scripts/launch-reset.mjs                      # dry run: counts only, changes nothing
 *   node scripts/launch-reset.mjs --confirm=<db host>  # really delete (host of DATABASE_URL)
 *
 * DATABASE_URL comes from the environment.
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL.");
  process.exit(1);
}
const host = new URL(url).hostname;
const confirm = process.argv.find((a) => a.startsWith("--confirm="))?.slice("--confirm=".length);
const apply = confirm !== undefined;
if (apply && confirm !== host) {
  console.error(`Refusing: --confirm must equal the database host (${host}).`);
  process.exit(1);
}

/** Emptied completely (order doesn't matter: one TRUNCATE ... CASCADE). */
const WIPE = [
  "ManualPayment",
  "ReferralCreditUse",
  "AccountDeletionRequest",
  "AnalyticsEvent",
  "PushSubscription",
  "EmailCode",
  "Notification",
  "ContactMessage",
  "Report",
  "SeasonResult",
  "LeaderboardSnapshot",
  "CarouselItem",
  "RateLimit",
  "AuditLog",
  "ReconciliationFlag",
  "WebhookEvent",
  "PayoutMethod",
  "Payout",
  "Payment",
  "PointsEntry",
  "Result",
  "RegistrationMember",
  "Registration",
  "Tournament",
  "Match",
  "TeamMember",
  "Team",
  "Ban",
];

const c = new pg.Client({ connectionString: url });
await c.connect();
const count = async (sql) => (await c.query(sql)).rows[0].n;
const report = {};
for (const t of WIPE) report[t] = await count(`select count(*)::int n from "${t}"`);
report["User (players, deleted)"] = await count(
  `select count(*)::int n from "User" where role = 'PLAYER'`,
);
report["User (staff, kept)"] = await count(
  `select count(*)::int n from "User" where role <> 'PLAYER'`,
);
report["GameProfile (players, deleted)"] = await count(
  `select count(*)::int n from "GameProfile" g join "User" u on u.id = g."userId" where u.role = 'PLAYER'`,
);
console.log(apply ? "DELETING on" : "DRY RUN on", host);
console.table(report);

if (apply) {
  await c.query("BEGIN");
  try {
    await c.query(`TRUNCATE TABLE ${WIPE.map((t) => `"${t}"`).join(", ")} CASCADE`);
    await c.query(
      `DELETE FROM "GameProfile" WHERE "userId" IN (SELECT id FROM "User" WHERE role = 'PLAYER')`,
    );
    await c.query(
      `UPDATE "User" SET "referredById" = NULL, "referredAt" = NULL, "referralCode" = NULL`,
    );
    await c.query(`DELETE FROM "User" WHERE role = 'PLAYER'`);
    const staff = await c.query(
      `SELECT id FROM "User" WHERE role = 'ADMIN' ORDER BY "createdAt" LIMIT 1`,
    );
    await c.query(
      `INSERT INTO "AuditLog" (id, "actorId", action, "entityType", "entityId", after, "createdAt")
       VALUES ($1, $2, 'launch.reset', 'Database', 'ALL', $3, now())`,
      [
        `reset${Date.now().toString(36)}`,
        staff.rows[0]?.id ?? null,
        JSON.stringify({ deleted: report }),
      ],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
  const left = {};
  for (const t of [...WIPE, "GameProfile"])
    left[t] = await count(`select count(*)::int n from "${t}"`);
  left["User (players)"] = await count(`select count(*)::int n from "User" where role = 'PLAYER'`);
  left["User (staff)"] = await count(`select count(*)::int n from "User" where role <> 'PLAYER'`);
  console.log("After reset:");
  console.table(left);
}
await c.end();
