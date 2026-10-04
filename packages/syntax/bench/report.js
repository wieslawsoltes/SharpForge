import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, release, totalmem } from 'node:os';
import { dirname } from 'node:path';

/** Source and host identity for a retained benchmark capture; unavailable Git is explicitly recorded. */
export function captureEnvironment(root) {
  let source;
  try {
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    source = {
      commit: git(['rev-parse', '--verify', 'HEAD']),
      trackedChanges: git(['status', '--porcelain', '--untracked-files=no']).split('\n').filter(Boolean)
    };
  } catch (error) {
    source = { commit: null, error: `Git source identity unavailable: ${error.code ?? error.message}` };
  }
  const processors = cpus();
  return {
    source,
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    architecture: process.arch,
    osRelease: release(),
    cpuModel: processors[0]?.model ?? null,
    logicalProcessors: processors.length,
    totalMemoryBytes: totalmem(),
    hostContext: process.env.SHARPFORGE_BENCH_HOST_CONTEXT ?? 'Unspecified; this benchmark does not verify host isolation.',
    loadAverage: loadavg(),
    gcExposed: typeof globalThis.gc === 'function'
  };
}

/** SHA-256 of the exact UTF-8 baseline contents used by a regression gate. */
export function baselineDigest(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Write a complete JSON capture, creating only its containing directory. */
export function writeReport(path, result) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(result, null, 2) + '\n');
}

/** Options for the parse benchmark. Checking cannot replace its own baseline. */
export function parseOptions(args) {
  const result = { quick: false, check: false, update: false, output: null };
  const flags = new Map([['--quick', 'quick'], ['--check', 'check'], ['--update', 'update']]);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index],
      flag = flags.get(argument);
    if (flag) result[flag] = true;
    else if (argument === '--output') {
      const path = args[++index];
      if (!path || path.startsWith('--')) throw new Error('--output requires a path');
      result.output = path;
    } else throw new Error(`Unknown parse benchmark argument: ${argument}`);
  }
  if (result.check && result.update) throw new Error('--check cannot be combined with --update');
  if (result.check && result.quick) throw new Error('--check requires all cases; omit --quick');
  return result;
}
