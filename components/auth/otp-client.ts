"use client";

/**
 * Client side of phone OTP. Firebase sends and checks the SMS code and yields an ID token;
 * our server verifies that token and issues its own session.
 * Without Firebase config (local dev/tests) a stub accepts code 123456, mirroring Firebase test numbers.
 */
export interface OtpClient {
  readonly kind: "firebase" | "stub";
  sendCode(phone: string): Promise<void>;
  /** Returns the proof token to POST to /api/auth/session. */
  confirmCode(code: string): Promise<string>;
}

export const STUB_OTP_CODE = "123456";

export class OtpError extends Error {}

const GENERIC_CODE_ERROR = "The code is invalid or has expired. Request a new one.";

function firebaseConfig() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
}

function sendErrorMessage(code: string | undefined): string {
  switch (code) {
    case "auth/invalid-phone-number":
      return "That phone number is not valid.";
    case "auth/too-many-requests":
    case "auth/quota-exceeded":
      return "Too many attempts. Please wait a while and try again.";
    // SMS region not allowed / SMS sign-in off / no billing: a set-up problem, not the player's.
    case "auth/operation-not-allowed":
    case "auth/billing-not-enabled":
      // The code in brackets tells staff what to fix in Firebase; players can ignore it.
      return `SMS login isn't available for this number yet. Please use “Continue with Google”. (${code})`;
    case "auth/captcha-check-failed":
    case "auth/invalid-app-credential":
      return "The security check failed. Refresh the page and try again.";
    default:
      return "Could not send the code. Please try again.";
  }
}

class FirebaseOtpClient implements OtpClient {
  readonly kind = "firebase" as const;
  private confirmation: import("firebase/auth").ConfirmationResult | null = null;
  private verifier: import("firebase/auth").RecaptchaVerifier | null = null;

  constructor(private recaptchaContainerId: string) {}

  private async auth() {
    const { getApps, initializeApp } = await import("firebase/app");
    const { getAuth } = await import("firebase/auth");
    const app = getApps()[0] ?? initializeApp(firebaseConfig()!);
    const auth = getAuth(app);
    auth.languageCode = "en";
    return auth;
  }

  async sendCode(phone: string): Promise<void> {
    const { RecaptchaVerifier, signInWithPhoneNumber } = await import("firebase/auth");
    const auth = await this.auth();
    this.verifier ??= new RecaptchaVerifier(auth, this.recaptchaContainerId, { size: "invisible" });
    try {
      this.confirmation = await signInWithPhoneNumber(auth, phone, this.verifier);
    } catch (e) {
      this.verifier.clear();
      this.verifier = null;
      const code = (e as { code?: string }).code;
      // The Firebase code tells staff what to fix (e.g. SMS region policy); players see plain words.
      console.error("Could not send the OTP", code);
      throw new OtpError(sendErrorMessage(code));
    }
  }

  async confirmCode(code: string): Promise<string> {
    if (!this.confirmation) throw new OtpError(GENERIC_CODE_ERROR);
    try {
      const cred = await this.confirmation.confirm(code);
      return await cred.user.getIdToken();
    } catch {
      throw new OtpError(GENERIC_CODE_ERROR);
    }
  }
}

class StubOtpClient implements OtpClient {
  readonly kind = "stub" as const;
  private phone: string | null = null;

  async sendCode(phone: string): Promise<void> {
    this.phone = phone;
  }

  async confirmCode(code: string): Promise<string> {
    if (!this.phone || code !== STUB_OTP_CODE) throw new OtpError(GENERIC_CODE_ERROR);
    return `stub:${this.phone}`;
  }
}

/**
 * Phone login can be switched off (NEXT_PUBLIC_PHONE_LOGIN=off) while Firebase has no billing
 * account, because new Firebase projects send no SMS without one (DECISIONS M37).
 */
export function phoneLoginEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PHONE_LOGIN !== "off";
}

export function otpMode(): "firebase" | "stub" {
  return firebaseConfig() ? "firebase" : "stub";
}

export function createOtpClient(recaptchaContainerId: string): OtpClient {
  return firebaseConfig() ? new FirebaseOtpClient(recaptchaContainerId) : new StubOtpClient();
}
