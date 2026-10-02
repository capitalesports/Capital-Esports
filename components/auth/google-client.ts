"use client";

import { otpMode } from "./otp-client";

/**
 * Client side of "Continue with Google" (DECISIONS M29): Firebase's Google popup yields an ID token
 * that our server verifies. Without Firebase config (local dev) there is no Google: the login form
 * shows a dev form whose email/name become a stub token the stub verifier accepts.
 */
export class GoogleSignInError extends Error {}

export function googleMode(): "firebase" | "stub" {
  return otpMode();
}

export async function googleIdTokenFromPopup(): Promise<string> {
  const { getApps, initializeApp } = await import("firebase/app");
  const { GoogleAuthProvider, getAuth, signInWithPopup, signOut } = await import("firebase/auth");
  const app =
    getApps()[0] ??
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const cred = await signInWithPopup(auth, provider);
    const token = await cred.user.getIdToken();
    // Our own session cookie is the login; Firebase's browser session isn't needed.
    await signOut(auth).catch(() => {});
    return token;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      throw new GoogleSignInError("Google sign-in was cancelled.");
    }
    if (code === "auth/popup-blocked") {
      throw new GoogleSignInError(
        "Your browser blocked the Google window. Allow pop-ups and try again.",
      );
    }
    // Set-up problems (provider off, site domain not authorised): say so, so staff can fix it.
    if (code === "auth/operation-not-allowed" || code === "auth/configuration-not-found") {
      throw new GoogleSignInError(
        "Google sign-in isn't switched on yet. Please use your mobile number for now.",
      );
    }
    if (code === "auth/unauthorized-domain") {
      throw new GoogleSignInError(
        "Google sign-in isn't set up for this web address yet. Please use your mobile number.",
      );
    }
    console.error("Google sign-in failed", code);
    throw new GoogleSignInError("Google sign-in failed. Please try again.");
  }
}

/** Dev only: the token the stub verifier accepts. */
export function stubGoogleToken(email: string, name: string): string {
  return `stub-google:${JSON.stringify({ email, name })}`;
}

export interface GoogleResult {
  ok: boolean;
  error?: string;
  needsProfile?: boolean;
}

export async function postGoogleToken(idToken: string): Promise<GoogleResult> {
  const res = await fetch("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const body = (await res.json().catch(() => ({}))) as GoogleResult;
  return { ...body, ok: res.ok && !!body.ok };
}
