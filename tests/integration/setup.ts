import "dotenv/config";
import { afterAll } from "vitest";

// Point the app's lazy Prisma client at the test database before any test touches it.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.AUTH_OTP_STUB = "true";
delete process.env.FIREBASE_ADMIN_PROJECT_ID;
delete process.env.SUPABASE_URL;

afterAll(async () => {
  const { getDb } = await import("@/server/db");
  await getDb().$disconnect();
});
