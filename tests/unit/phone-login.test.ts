import { afterEach, describe, expect, it, vi } from "vitest";
import { phoneLoginEnabled } from "@/lib/phone-login";

describe("phoneLoginEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off unless the switch says on", () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_LOGIN", "");
    expect(phoneLoginEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_PHONE_LOGIN", "off");
    expect(phoneLoginEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_PHONE_LOGIN", "on");
    expect(phoneLoginEnabled()).toBe(true);
  });
});
