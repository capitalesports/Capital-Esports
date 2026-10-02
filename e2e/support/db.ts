import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

/** Direct DB access for arranging e2e state (the app server uses the same E2E database). */
export function e2eDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL must be set (see .env.example)");
  if (url === process.env.DATABASE_URL) throw new Error("E2E_DATABASE_URL must differ from DATABASE_URL");
  return url;
}

type UserData = Record<string, unknown> & { phone?: string; email?: unknown; gameProfiles?: { create?: unknown } };

/**
 * Players arranged directly in the database get what registering needs today (DECISIONS M10–M12):
 * a verified email (derived from the phone) and, for Free Fire, an exact in-game name. Specs that
 * test a missing email pass `email: null` explicitly.
 */
function withRegistrationBasics<T extends UserData | undefined>(data: T): T {
  if (!data || typeof data.phone !== "string") return data;
  const out: UserData = { ...data };
  if (!("email" in out)) {
    out.email = `e2e${out.phone!.replace(/\D/g, "")}@test.in`;
    out.emailVerifiedAt = new Date();
  }
  const create = out.gameProfiles?.create;
  if (create) {
    const addIgn = (p: Record<string, unknown>) =>
      p.game === "FREE_FIRE" && !p.ign ? { ...p, ign: `FF${String(p.gameId)}` } : p;
    out.gameProfiles = {
      ...out.gameProfiles,
      create: Array.isArray(create)
        ? create.map((p) => addIgn(p as Record<string, unknown>))
        : addIgn(create as Record<string, unknown>),
    };
  }
  return out as T;
}

function makeClient() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: e2eDatabaseUrl() }) }).$extends({
    query: {
      user: {
        create: ({ args, query }) => query({ ...args, data: withRegistrationBasics(args.data as UserData) as typeof args.data }),
        upsert: ({ args, query }) =>
          query({ ...args, create: withRegistrationBasics(args.create as UserData) as typeof args.create }),
      },
    },
  }) as unknown as PrismaClient;
}

let client: PrismaClient | null = null;
export function e2eDb(): PrismaClient {
  client ??= makeClient();
  return client;
}

export async function truncateAll(db: PrismaClient): Promise<void> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (!tables.length) return;
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}
