# Deploying

The app is a single Next.js 16 project on **Vercel** with a managed **PostgreSQL** (Supabase or Neon). Scheduled work runs on **Vercel Cron**. Everything below is done once per environment (Preview, Production).

## 1. Database

1. Create a Postgres 15+ database (Supabase: *Project → Settings → Database*; Neon: *Project → Connection details*).
2. Use the **pooled** connection string for `DATABASE_URL` (Supabase "Transaction pooler" on port 6543 with `?pgbouncer=true`, or Neon's `-pooler` host) because serverless functions open many short connections.
3. Apply the schema from your machine or CI (never `migrate dev` against production):

   ```bash
   DATABASE_URL="<direct (non-pooled) connection string>" npx prisma migrate deploy
   ```

4. Seed the first admin, the first season and the points tables (idempotent; creates 6 sample matches only if the database has none — delete them afterwards if you don't want them):

   ```bash
   DATABASE_URL="<direct connection string>" ADMIN_PHONE="+91XXXXXXXXXX" npm run db:seed
   ```

Use a **separate database for Preview** deployments so test data never touches production.

## 2. Vercel project

1. Import the Git repository in Vercel (framework preset: Next.js; build command `npm run build`; install `npm ci`). `postinstall` runs `prisma generate`.
2. Set the environment variables below for **Production** and **Preview** (Preview gets sandbox/test values).
3. Every pull request gets a Preview deployment; `main` deploys to Production.

### Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | yes | `https://your-domain` (no trailing slash). Used for OG images, sitemap, payment return URLs; `https://` also turns on Secure cookies. |
| `DATABASE_URL` | yes | Pooled Postgres URL. |
| `SESSION_SECRET` | yes | `openssl rand -base64 48`. Rotating it logs everyone out. |
| `CRON_SECRET` | yes | Random string; Vercel Cron sends it as a Bearer token. |
| `ADMIN_PHONE` | seed only | E.164 phone of the first admin. |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` | yes | Firebase web app config. |
| `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` | yes | Service account; paste the key with `\n` escapes. |
| `AUTH_OTP_STUB` | **never in production** | `true` only for local dev / CI. Ignored when `VERCEL_ENV=production`. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | yes | Public bucket for avatars/screenshots (see step 4). |
| `PAYMENTS_ENABLED` | yes | `false` until the legal review is done. |
| `CASHFREE_ENV` | if payments | `sandbox` on Preview, `production` on Production. |
| `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` | if payments | Payment Gateway keys. The secret also verifies PG webhooks. |
| `CASHFREE_PAYOUTS_CLIENT_ID`, `CASHFREE_PAYOUTS_CLIENT_SECRET` | if payouts | Payouts keys. The secret also verifies payout webhooks (use the **oldest active** client secret). |
| `PAYOUT_TWO_STEP_THRESHOLD_PAISE` | no | Default `500000` (₹5,000). |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | for push | `npx web-push generate-vapid-keys`; subject `mailto:you@domain`. |
| `RESEND_API_KEY`, `EMAIL_FROM` | for email | resend.com → API Keys; verify your domain in Resend (DNS records) and use a sender on it, e.g. `Esports <no-reply@yourdomain.in>`. Without them production sends no email and email login is unavailable. |
| `NEXT_PUBLIC_SENTRY_DSN` | recommended | Enables server + browser error reporting. |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | recommended | Uploads source maps during `next build`. |

Missing optional integrations fall back to local stubs **only outside the production deployment**; on Production the app refuses to use them (login, uploads, payments and payouts show "not configured" instead).

## 3. Cron jobs (`vercel.json`)

| Path | Schedule (UTC) | What it does |
| --- | --- | --- |
| `/api/cron/match-status` | every 5 min | Opens/closes registration, marks live/results pending; 30-minute reminders and "room ID ready" notices. |
| `/api/cron/payment-expiry` | every 10 min | Frees slots held by unpaid registrations (re-checks Cashfree first). |
| `/api/cron/reconcile` | 21:30 daily (03:00 IST) | Compares payments, refunds and payouts with Cashfree; flags and fixes mismatches. |
| `/api/cron/season-end` | 18:35 daily (00:05 IST) | Archives ended seasons, starts the next, resets strikes; prunes rate-limit rows. |

Sub-daily schedules need a **Vercel Pro** plan (Hobby runs crons once a day). Alternative: any external scheduler calling the same URLs with `Authorization: Bearer $CRON_SECRET`.

## 4. File storage (Supabase)

Create a **public** bucket named `uploads` (or set `SUPABASE_STORAGE_BUCKET`). The app writes with the service-role key and serves images from the public URL. Uploads are validated by magic bytes and size on the server.

## 5. Webhooks

| Provider | URL | Events |
| --- | --- | --- |
| Cashfree PG | `https://<domain>/api/webhooks/cashfree` | Payment success / failed / user dropped, refund status |
| Cashfree Payouts (v2) | `https://<domain>/api/webhooks/cashfree-payouts` | Transfer events |

Both verify `x-webhook-signature` (HMAC-SHA256 of timestamp + raw body) and are idempotent.

## 6. Monitoring

- **Sentry**: set the DSN (and auth token for readable stack traces). Cookies, headers, bodies, query strings and user info are not sent.
- **Uptime**: add checks (e.g. Better Stack, UptimeRobot) on `https://<domain>/` (expect 200) and `https://<domain>/api/health` (200 when the app and database are up, 503 otherwise), every 1–5 minutes.

## 7. Backups and restore

**Automated backups**: Supabase Pro keeps daily backups (7 days; enable Point-in-Time Recovery for more); Neon keeps history for the plan's retention window. Turn them on and note the retention.

**Own daily export** (belt and braces), e.g. from a scheduled GitHub Action or any machine:

```bash
pg_dump "<direct connection string>" -Fc -f esports-$(date +%F).dump
```

Store the file somewhere other than the database provider.

**Restore procedure** (tested on 2026-09-27 against a copy of the local database: all row counts matched and `prisma migrate status` reported the schema up to date):

```bash
# 1. Create an empty database (never restore over production directly)
createdb -h <host> -U <user> esports_restore
# 2. Restore the dump
pg_restore -h <host> -U <user> -d esports_restore --no-owner --no-privileges esports-YYYY-MM-DD.dump
# 3. Check it
DATABASE_URL="postgresql://<user>:<pw>@<host>/esports_restore" npx prisma migrate status
psql "postgresql://<user>:<pw>@<host>/esports_restore" -c 'select count(*) from "User"; select count(*) from "Match";'
# 4. Point DATABASE_URL (Vercel) at the restored database, redeploy, run the smoke checks below
```

Repeat a restore drill at least once per quarter.

## 8. Smoke checks after each production deploy

1. `GET /api/health` → `{"ok":true,"db":"ok"}`.
2. Log in with a real phone number; open `/dashboard`.
3. Open a scrim page; check times are in IST.
4. As admin, open `/admin/matches`.
5. Check Sentry receives a test event (`Sentry.captureMessage` from a preview, or the Sentry "verify" button).
