import { execSync } from "node:child_process";
import { seed } from "../../prisma/seed";
import { e2eDatabaseUrl, e2eDb, truncateAll } from "./db";
import { seedE2eExtras } from "./seed-extras";

/** Migrate, wipe and seed the e2e database before the run. */
export default async function globalSetup() {
  const url = e2eDatabaseUrl();
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
  const db = e2eDb();
  await truncateAll(db);
  await seed(db);
  await seedE2eExtras(db);
  await db.$disconnect();
}
