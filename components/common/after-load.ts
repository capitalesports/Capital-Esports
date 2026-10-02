/**
 * Runs `task` once the page has loaded (plus `delayMs`) and the main thread is idle, so non-urgent work
 * (service worker registration, analytics) never competes with the first paint. Returns a cancel function.
 */
export function afterLoad(
  task: () => void,
  { delayMs = 0 }: { delayMs?: number } = {},
): () => void {
  let cancel = () => {};
  const idle = () => {
    // Safari has no requestIdleCallback.
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(task, { timeout: 3000 });
      cancel = () => window.cancelIdleCallback(id);
    } else {
      const id = setTimeout(task, 1);
      cancel = () => clearTimeout(id);
    }
  };
  const run = () => {
    const id = setTimeout(idle, delayMs);
    cancel = () => clearTimeout(id);
  };
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
  return () => {
    window.removeEventListener("load", run);
    cancel();
  };
}
