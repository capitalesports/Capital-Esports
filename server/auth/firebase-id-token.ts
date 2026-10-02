import "server-only";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * Verifies a Firebase Auth ID token the documented way (RS256, Google's securetoken keys,
 * issuer/audience = our project). Replaces firebase-admin's verifyIdToken, whose jwks-rsa
 * dependency fails to load on Vercel (DECISIONS M36). Throws on any invalid token.
 */
const JWKS_URL = new URL(
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
);
const jwks = createRemoteJWKSet(JWKS_URL);

export interface FirebaseIdToken extends JWTPayload {
  sub: string;
  auth_time: number;
  email?: string;
  email_verified?: boolean;
  name?: unknown;
  picture?: unknown;
  phone_number?: string;
  firebase?: { sign_in_provider?: string; identities?: Record<string, unknown> };
}

export async function verifyFirebaseIdToken(
  idToken: string,
  projectId: string,
): Promise<FirebaseIdToken> {
  const { payload } = await jwtVerify(idToken, jwks, {
    algorithms: ["RS256"],
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });
  if (typeof payload.sub !== "string" || !payload.sub || typeof payload.auth_time !== "number") {
    throw new Error("Malformed Firebase ID token");
  }
  return payload as FirebaseIdToken;
}
