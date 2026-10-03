import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3101);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/support/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-chrome",
      // E2E_CHANNEL=chrome uses the locally installed Chrome when the bundled browser can't be downloaded.
      use: { ...devices["Pixel 7"], ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}) },
    },
  ],
  webServer: {
    // Production build + start, so e2e exercises what ships.
    command: process.env.E2E_SKIP_BUILD
      ? `npx next start -p ${PORT}`
      : `npm run build && npx next start -p ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
    // The app under test talks to the dedicated e2e database and uses the local OTP stub.
    env: {
      ...(process.env as Record<string, string>),
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      AUTH_OTP_STUB: "true",
      // Real Firebase keys in .env would replace the stub (code 123456) the specs log in with.
      NEXT_PUBLIC_FIREBASE_API_KEY: "",
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "",
      NEXT_PUBLIC_FIREBASE_APP_ID: "",
      FIREBASE_ADMIN_PROJECT_ID: "",
      FIREBASE_ADMIN_CLIENT_EMAIL: "",
      FIREBASE_ADMIN_PRIVATE_KEY: "",
      PAYMENTS_ENABLED: "true",
      // The specs log in by phone with the local OTP stub; the site has phone login off (M37).
      NEXT_PUBLIC_PHONE_LOGIN: "on",
      NEXT_PUBLIC_SITE_URL: baseURL,
    },
  },
});
