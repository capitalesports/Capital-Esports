import "server-only";
import { AppError } from "@/server/errors";
import { firebaseAdminConfig, otpStubAllowed } from "@/server/env";
import { normalizeEmail } from "@/lib/input-rules";

/** What a verified Google sign-in tells us about the player. */
export interface GoogleProfile {
  /** Stable Google account id. */
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

/**
 * Verifies the proof of a Google sign-in from the client (DECISIONS M29) and returns the Google
 * profile. Firebase (signInWithPopup + GoogleAuthProvider) is the production implementation; the
 * stub exists for local dev and tests only, like the phone OTP stub.
 */
export interface GoogleVerifier {
  readonly kind: "firebase" | "stub";
  verify(idToken: string): Promise<GoogleProfile>;
}

const MAX_AUTH_AGE_SECONDS = 10 * 60;
const INVALID = "Google sign-in failed. Please try again.";

class FirebaseGoogleVerifier implements GoogleVerifier {
  readonly kind = "firebase" as const;

  async verify(idToken: string): Promise<GoogleProfile> {
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
    const googleIds = decoded.firebase?.identities?.["google.com"] as string[] | undefined;
    const email = decoded.email ? normalizeEmail(decoded.email) : null;
    if (decoded.firebase?.sign_in_provider !== "google.com" || !googleIds?.[0] || !email) {
      throw new AppError("UNAUTHENTICATED", INVALID);
    }
    if (!decoded.email_verified) {
      throw new AppError("UNAUTHENTICATED", "Your Google email isn't verified.");
    }
    if (Date.now() / 1000 - decoded.auth_time > MAX_AUTH_AGE_SECONDS) {
      throw new AppError("UNAUTHENTICATED", INVALID);
    }
    return {
      sub: googleIds[0],
      email,
      name: typeof decoded.name === "string" ? decoded.name : null,
      picture: typeof decoded.picture === "string" ? decoded.picture : null,
    };
  }
}

/** Dev/test tokens: "stub-google:" + JSON {"email","name"} (made by the dev Google form). */
export const STUB_GOOGLE_PREFIX = "stub-google:";

class StubGoogleVerifier implements GoogleVerifier {
  readonly kind = "stub" as const;

  async verify(idToken: string): Promise<GoogleProfile> {
    if (!idToken.startsWith(STUB_GOOGLE_PREFIX)) throw new AppError("UNAUTHENTICATED", INVALID);
    let data: { email?: unknown; name?: unknown };
    try {
      data = JSON.parse(idToken.slice(STUB_GOOGLE_PREFIX.length));
    } catch {
      throw new AppError("UNAUTHENTICATED", INVALID);
    }
    const email = typeof data.email === "string" ? normalizeEmail(data.email) : null;
    if (!email) throw new AppError("UNAUTHENTICATED", INVALID);
    return {
      sub: `stub-${email}`,
      email,
      name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : null,
      picture: null,
    };
  }
}

export function getGoogleVerifier(): GoogleVerifier {
  if (firebaseAdminConfig()) return new FirebaseGoogleVerifier();
  if (otpStubAllowed()) return new StubGoogleVerifier();
  throw new AppError("UNAVAILABLE", "Google sign-in is not configured yet.");
}
