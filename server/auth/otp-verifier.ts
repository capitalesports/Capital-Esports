import "server-only";
import { AppError } from "@/server/errors";
import { firebaseAdminConfig, otpStubAllowed } from "@/server/env";
import { normalizePhone } from "@/lib/validators";

/**
 * Verifies the proof-of-phone produced by the client OTP flow and returns the phone (E.164).
 * Firebase is the production implementation; the stub exists for local dev and tests only.
 */
export interface OtpVerifier {
  readonly kind: "firebase" | "stub";
  verify(idToken: string): Promise<{ phone: string }>;
}

/** Tokens older than this (since the OTP was entered) are rejected to limit replay. */
const MAX_AUTH_AGE_SECONDS = 10 * 60;

const INVALID = "The code is invalid or has expired. Request a new one.";

class FirebaseOtpVerifier implements OtpVerifier {
  readonly kind = "firebase" as const;

  async verify(idToken: string): Promise<{ phone: string }> {
    const cfg = firebaseAdminConfig()!;
    const { cert, getApps, initializeApp } = await import("firebase-admin/app");
    const { getAuth } = await import("firebase-admin/auth");
    const app =
      getApps().find((a) => a.name === "esports") ??
      initializeApp({ credential: cert(cfg), projectId: cfg.projectId }, "esports");
    let decoded;
    try {
      decoded = await getAuth(app).verifyIdToken(idToken, true);
    } catch {
      throw new AppError("UNAUTHENTICATED", INVALID);
    }
    const phone = decoded.phone_number ? normalizePhone(decoded.phone_number) : null;
    if (!phone) throw new AppError("UNAUTHENTICATED", INVALID);
    if (Date.now() / 1000 - decoded.auth_time > MAX_AUTH_AGE_SECONDS) {
      throw new AppError("UNAUTHENTICATED", INVALID);
    }
    return { phone };
  }
}

/** Accepts "stub:<E.164 phone>" tokens minted by the dev login form (code 123456). */
export const STUB_TOKEN_PREFIX = "stub:";

class StubOtpVerifier implements OtpVerifier {
  readonly kind = "stub" as const;

  async verify(idToken: string): Promise<{ phone: string }> {
    if (!idToken.startsWith(STUB_TOKEN_PREFIX)) throw new AppError("UNAUTHENTICATED", INVALID);
    const phone = normalizePhone(idToken.slice(STUB_TOKEN_PREFIX.length));
    if (!phone) throw new AppError("UNAUTHENTICATED", INVALID);
    return { phone };
  }
}

export function getOtpVerifier(): OtpVerifier {
  if (firebaseAdminConfig()) return new FirebaseOtpVerifier();
  if (otpStubAllowed()) return new StubOtpVerifier();
  throw new AppError("UNAVAILABLE", "Login is not configured yet. Please try again later.");
}
