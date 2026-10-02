import { jwtVerify, SignJWT } from "jose";

/** Session cookie contract shared by the auth route, server guards and proxy.ts. */
export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
/** Re-issue the cookie (rolling expiry) once the token is older than this. */
export const SESSION_ROLL_AFTER_SECONDS = 24 * 60 * 60;

const ISSUER = "esports-platform";
const AUDIENCE = "session";

export interface SessionClaims {
  userId: string;
  /** Issued-at, seconds since epoch. */
  iat: number;
  exp: number;
}

function key(secret: string): Uint8Array {
  if (!secret || secret.length < 32)
    throw new Error("SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(secret);
}

export async function signSession(
  userId: string,
  secret: string,
  now = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_MAX_AGE_SECONDS)
    .sign(key(secret));
}

/** Returns the claims, or null for a missing, tampered, expired or foreign token. */
export async function verifySession(
  token: string | undefined | null,
  secret: string,
  now = new Date(),
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
      currentDate: now,
    });
    if (!payload.sub || typeof payload.iat !== "number" || typeof payload.exp !== "number")
      return null;
    return { userId: payload.sub, iat: payload.iat, exp: payload.exp };
  } catch {
    return null;
  }
}

export function shouldRollSession(claims: SessionClaims, now = new Date()): boolean {
  return Math.floor(now.getTime() / 1000) - claims.iat >= SESSION_ROLL_AFTER_SECONDS;
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
