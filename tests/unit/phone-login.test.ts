import { afterEach, describe, expect, it, vi } from "vitest";
import { phoneLoginEnabled } from "@/lib/phone-login";

describe("phoneLoginEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is on unless the switch says off", () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_LOGIN", "");
    expect(phoneLoginEnabled()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_PHONE_LOGIN", "on");
    expect(phoneLoginEnabled()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_PHONE_LOGIN", "off");
    expect(phoneLoginEnabled()).toBe(false);
  });
});
