import { checkCancelled } from '@sharpforge/git';
import { benchmarkTextPath } from './generate.js';

/** Real repository reads keep their correctness gates and share the caller's cancellation signal. */
export const benchmarkReadOperations = Object.freeze({
  async status(repo, profile, options = {}) {
    checkCancelled(options.signal);
    const value = await repo.status({ signal: options.signal });
    checkCancelled(options.signal);
    if (value.length) throw new Error('Benchmark clone worktree is unexpectedly dirty');
    return value.length;
  },
  async log(repo, profile, options = {}) {
    checkCancelled(options.signal);
    const value = await repo.log({ maxCount: profile.history, signal: options.signal });
    checkCancelled(options.signal);
    if (value.length !== profile.history) throw new Error('Benchmark history is incomplete');
    return value.length;
  },
  async blame(repo, profile, options = {}) {
    checkCancelled(options.signal);
    const value = await repo.blame(benchmarkTextPath(0), { signal: options.signal });
    checkCancelled(options.signal);
    if (value.length !== 8) throw new Error('Benchmark blame result is incomplete');
    return value.length;
  }
});
