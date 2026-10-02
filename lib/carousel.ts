/**
 * Auto-advancing carousel rules (home "Last Week's Winners"): advance every 7 s, never while the viewer
 * hovers, touches or focuses it, and never with prefers-reduced-motion. Framework-free so it is testable.
 */
export const CAROUSEL_INTERVAL_MS = 7000;

/** Index `step` slides away, wrapping both ways. */
export function wrapIndex(index: number, step: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + step) % count) + count) % count;
}

export interface PauseState {
  hovered: boolean;
  touched: boolean;
  focused: boolean;
  reducedMotion: boolean;
}

export function isPaused(s: PauseState): boolean {
  return s.hovered || s.touched || s.focused || s.reducedMotion;
}

/**
 * Schedules the next advance, or nothing when paused or with fewer than two slides. `stillAllowed` is
 * re-checked when the timer fires (the reduced-motion preference can land after the first render).
 * Returns a cancel function.
 */
export function scheduleAdvance(opts: {
  count: number;
  paused: boolean;
  intervalMs?: number;
  onAdvance: () => void;
  stillAllowed?: () => boolean;
}): () => void {
  const {
    count,
    paused,
    intervalMs = CAROUSEL_INTERVAL_MS,
    onAdvance,
    stillAllowed = () => true,
  } = opts;
  if (paused || count < 2) return () => {};
  const id = setTimeout(() => {
    if (stillAllowed()) onAdvance();
  }, intervalMs);
  return () => clearTimeout(id);
}
