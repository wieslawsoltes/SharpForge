// Local resource limits for builds, validation and tests. See CONTRIBUTING.md, "Resource limits".
// Many agents share one developer machine; an unbounded `node --test` run starts one process per core.
// CI is not limited: these defaults apply only when the CI environment variable is unset.
import {mkdirSync, readdirSync} from 'node:fs';
import {tmpdir, totalmem} from 'node:os';
import {join} from 'node:path';
import {claimRunSlot, inheritedRunSlot, reclaimRunSlot} from './run-slot-lease.js';

const GIB = 1024 ** 3;
const positiveInteger = value => (/^[1-9]\d*$/.test(String(value ?? '')) ? Number(value) : null);

/** Limits in effect for this process; every value can be overridden through the environment. */
export function resourceLimits(env = process.env, memoryBytes = totalmem()) {
  const local = !env.CI;
  const perEightGiB = Math.max(1, Math.min(4, Math.floor(memoryBytes / GIB / 8)));
  return {
    // Test files run in parallel processes of 300-500 MB each: allow one per 8 GiB of RAM, at most 4.
    testConcurrency: positiveInteger(env.SHARPFORGE_TEST_CONCURRENCY) ?? (local ? perEightGiB : null),
    // Heavy runs (full test suites, builds, benchmarks) allowed at once on this machine, across all checkouts.
    parallelRuns: positiveInteger(env.SHARPFORGE_MAX_PARALLEL_RUNS) ?? (local ? perEightGiB : null),
    // V8 old-space cap per Node process, in MiB; stops a runaway test from taking the machine into swap.
    maxOldSpaceMb: positiveInteger(env.SHARPFORGE_MAX_OLD_SPACE_MB) ?? (local ? 2048 : null),
  };
}

/** Adds --test-concurrency to `node --test` arguments unless the caller already chose one. */
export function limitTestArgs(args, limits = resourceLimits()) {
  if (limits.testConcurrency === null || args.some(arg => arg.startsWith('--test-concurrency'))) return args;
  const index = args.indexOf('--test');
  return index < 0 ? args : [...args.slice(0, index + 1), `--test-concurrency=${limits.testConcurrency}`, ...args.slice(index + 1)];
}

/** Environment for child processes with the heap cap applied, preserving any existing NODE_OPTIONS. */
export function limitedEnv(env = process.env, limits = resourceLimits(env)) {
  if (limits.maxOldSpaceMb === null || /--max-old-space-size/.test(env.NODE_OPTIONS ?? '')) return env;
  return {...env, NODE_OPTIONS: `${env.NODE_OPTIONS ?? ''} --max-old-space-size=${limits.maxOldSpaceMb}`.trim()};
}

/**
 * Machine-wide counting semaphore backed by one lock file per slot in the temp directory.
 * Returns a release function with an environment capability for its child command.
 * Children may borrow a live inherited lease; only its original owner releases it.
 */
export async function acquireRunSlot(options = {}) {
  const {env = process.env, limits = resourceLimits(env), directory = join(tmpdir(), 'sharpforge-run-slots'),
    log = console.error, pollMs = 2000} = options;
  if (limits.parallelRuns === null) return () => {};
  const inherited = inheritedRunSlot(env, directory);
  if (inherited) return inherited;
  mkdirSync(directory, {recursive: true, mode: 0o700});
  let announced = false;
  for (;;) {
    for (const name of readdirSync(directory)) {
      if (!/^slot-\d+\.lock$/.test(name)) continue;
      reclaimRunSlot(directory, Number(name.slice(5, -5)));
    }
    for (let slot = 0; slot < limits.parallelRuns; slot++) {
      try {
        return claimRunSlot(directory, slot);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    if (!announced) {
      log(`Waiting for a free run slot: ${limits.parallelRuns} heavy runs are allowed at once (SHARPFORGE_MAX_PARALLEL_RUNS).`);
      announced = true;
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}
