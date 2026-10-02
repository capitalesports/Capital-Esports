import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAROUSEL_INTERVAL_MS, isPaused, scheduleAdvance, wrapIndex } from "@/lib/carousel";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const idle = { hovered: false, touched: false, focused: false, reducedMotion: false };

describe("carousel timer", () => {
  it("advances once after 7 seconds, not before", () => {
    const onAdvance = vi.fn();
    scheduleAdvance({ count: 3, paused: false, onAdvance });
    vi.advanceTimersByTime(CAROUSEL_INTERVAL_MS - 1);
    expect(onAdvance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onAdvance).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CAROUSEL_INTERVAL_MS * 3);
    expect(onAdvance).toHaveBeenCalledTimes(1); // one timer per render; the component reschedules
  });

  it("does nothing while paused or with fewer than two slides", () => {
    const onAdvance = vi.fn();
    scheduleAdvance({ count: 3, paused: true, onAdvance });
    scheduleAdvance({ count: 1, paused: false, onAdvance });
    scheduleAdvance({ count: 0, paused: false, onAdvance });
    vi.advanceTimersByTime(60_000);
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("can be cancelled (hover or unmount before it fires)", () => {
    const onAdvance = vi.fn();
    const cancel = scheduleAdvance({ count: 3, paused: false, onAdvance });
    vi.advanceTimersByTime(3_000);
    cancel();
    vi.advanceTimersByTime(10_000);
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("re-checks reduced motion when the timer fires", () => {
    const onAdvance = vi.fn();
    scheduleAdvance({ count: 3, paused: false, onAdvance, stillAllowed: () => false });
    vi.advanceTimersByTime(CAROUSEL_INTERVAL_MS);
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("pauses on hover, touch, focus and reduced motion", () => {
    expect(isPaused(idle)).toBe(false);
    for (const key of ["hovered", "touched", "focused", "reducedMotion"] as const) expect(isPaused({ ...idle, [key]: true })).toBe(true);
  });

  it("wraps slide indexes both ways", () => {
    expect(wrapIndex(2, 1, 3)).toBe(0);
    expect(wrapIndex(0, -1, 3)).toBe(2);
    expect(wrapIndex(5, 0, 3)).toBe(2);
    expect(wrapIndex(0, 1, 0)).toBe(0);
  });
});
