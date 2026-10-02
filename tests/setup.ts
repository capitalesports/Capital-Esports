// Shared Vitest setup for every project.
process.env.TZ = "UTC";
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
// Paid entry is off unless a test switches it on, whatever the developer's local .env says.
process.env.PAYMENTS_ENABLED = "false";
