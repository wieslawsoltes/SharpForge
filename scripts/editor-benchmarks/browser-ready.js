/** Poll through the protocol's evaluate primitive; waitForFunction installs a CSP-sensitive page function. */
export function waitForBenchmarkReady(page, { timeoutMs = 30_000, intervalMs = 50, signal } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000
      || !Number.isFinite(intervalMs) || intervalMs < 1 || intervalMs > 1000) throw new RangeError('Invalid browser startup deadline');
  return new Promise((resolve, reject) => {
    let finished = false, deadline, next;
    const finish = (error, failed = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearTimeout(next);
      signal?.removeEventListener('abort', abort);
      if (failed) reject(error); else resolve();
    };
    const abort = () => finish(signal.reason ?? new Error('Editor benchmark cancelled'), true);
    const poll = async () => {
      try {
        if (await page.evaluate(() => Boolean(globalThis.editorBenchmark))) finish();
        else if (!finished) next = setTimeout(poll, intervalMs);
      } catch (error) { finish(error, true); }
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    deadline = setTimeout(() => finish(new Error(`Editor benchmark did not initialize within ${timeoutMs} milliseconds`), true), timeoutMs);
    void poll();
  });
}
