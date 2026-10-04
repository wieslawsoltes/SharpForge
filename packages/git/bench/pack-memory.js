import { fork } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, cpus, totalmem, release } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchmarkGit } from './native.js';
import { packMemoryProfile, PACK_MEMORY_MINIMUM_BYTES } from './pack-memory-profile.js';

function runMeasuredChild(options) {
  return new Promise((resolveResult, reject) => {
    const child = fork(fileURLToPath(new URL('./pack-memory-worker.js', import.meta.url)), [], {
      execArgv: ['--max-old-space-size=128'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true
    });
    let result;
    let failure;
    let outputBytes = 0;
    const diagnostics = [];
    const stop = error => {
      failure ??= error;
      child.kill('SIGKILL');
    };
    const abort = () => stop(new Error('Pack memory qualification was cancelled'));
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop(new Error('Pack memory qualification exceeded its deadline')), options.timeoutMs);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
      outputBytes += bytes.length;
      if (outputBytes > 65536) stop(new Error('Pack memory worker diagnostic limit exceeded'));
      else diagnostics.push(bytes);
    });
    child.on('message', message => {
      if (message?.type === 'progress') options.onProgress?.(message.value);
      else if (message?.type === 'result') result = message.result;
      else if (message?.type === 'failure') failure = new Error(`${message.code}: ${message.message}`);
    });
    child.on('error', error => { failure ??= error; });
    child.on('close', code => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code || !result) {
        reject(new Error(`Pack memory worker exited ${code}: ${Buffer.concat(diagnostics).toString('utf8').slice(0, 2000)}`));
      } else resolveResult(result);
    });
    if (options.signal?.aborted) abort();
    else child.send({ root: options.root, profile: options.profile }, error => { if (error) stop(error); });
  });
}

async function verifyNativePack(root, options) {
  const env = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: join(root, 'system-config'),
    GIT_CONFIG_GLOBAL: join(root, 'global-config'), GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
  const commandOptions = { cwd: root, env, signal: options.signal, timeoutMs: options.timeoutMs };
  const version = await benchmarkGit(['--version'], commandOptions);
  const checksum = await benchmarkGit(['index-pack', '--strict', '--threads=1',
    '--object-format=' + options.profile.algorithm, 'input.pack'], commandOptions);
  await benchmarkGit(['--git-dir=repo.git', 'fsck', '--strict', '--full', '--no-reflogs'], commandOptions);
  return { version, checksum, packIndexVerified: true, looseObjectsVerified: true };
}

/** Measure a real streamed pack in a separate process, then verify its pack and persisted objects with native Git. */
export async function runPackMemoryBenchmark(options = {}) {
  const profile = packMemoryProfile(options);
  const timeoutMs = options.timeoutMs ?? 600_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3600_000) throw new RangeError('Invalid pack memory deadline');
  if (options.signal?.aborted) throw new Error('Pack memory qualification was cancelled');
  const parent = resolve(options.directory ?? tmpdir());
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'sharpforge-pack-memory-'));
  try {
    const measured = await runMeasuredChild({ ...options, profile, root, timeoutMs });
    options.onProgress?.({ phase: 'native-verification', objects: measured.pack.objects, bytes: measured.pack.bytes });
    const reference = await verifyNativePack(root, { ...options, profile, timeoutMs });
    if (reference.checksum !== measured.pack.checksum) throw new Error('Native index-pack and streaming decoder disagree on the pack checksum');
    const qualifyingProfile = measured.pack.bytes >= PACK_MEMORY_MINIMUM_BYTES && measured.pack.expandedBytes >= PACK_MEMORY_MINIMUM_BYTES;
    return {
      schema: 'sharpforge.git.pack-memory.v1', ...measured, reference,
      machine: { release: release(), cpu: cpus()[0]?.model, cpus: cpus().length, totalMemoryBytes: totalmem() },
      memoryPolicy: {
        measuredProcess: 'Dedicated decoder process with a 128 MiB V8 old-generation limit; no forced collection',
        window: 'Independent source generation, streamed decoding, address verification and real loose-object writes',
        sampling: 'Every generated source chunk, every decoded object, and a 1 ms timer; transient synchronous peaks may be missed',
        reference: 'Native index-pack and fsck run sequentially after the measured decoder has exited',
        interpretation: 'The 64 MiB assertion applies only to sampled V8 heapUsed; external, ArrayBuffer and RSS peaks are separate',
        source: 'Independent PACK v2 encoder with zlib stored blocks; the complete pack is never held in memory'
      },
      minimumQualifyingBytes: PACK_MEMORY_MINIMUM_BYTES, qualifyingProfile,
      qualifies100MiB: qualifyingProfile && measured.heapWithinLimit, ok: measured.heapWithinLimit,
      ...(options.keep ? { directory: root } : {})
    };
  } finally {
    if (!options.keep) await rm(root, { recursive: true, force: true });
  }
}

function parseOptions(argv) {
  const options = {};
  const names = { '--objects': 'objects', '--object-bytes': 'objectBytes', '--algorithm': 'algorithm', '--seed': 'seed',
    '--directory': 'directory', '--output': 'output', '--timeout-ms': 'timeoutMs' };
  if (argv.includes('--quick')) Object.assign(options, { objects: 4, objectBytes: 256 * 1024 });
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--quick') continue;
    if (flag === '--keep') { options.keep = true; continue; }
    if (!names[flag] || argv[index + 1] === undefined) throw new Error(`Invalid pack memory option ${flag}`);
    const value = argv[++index];
    options[names[flag]] = ['objects', 'objectBytes', 'seed', 'timeoutMs'].includes(names[flag]) ? Number(value) : value;
  }
  return options;
}

export async function packMemoryMain(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: pack-memory.js [--quick] [--algorithm sha1|sha256] [--objects N] [--object-bytes N]\n'
      + '  [--seed N] [--timeout-ms N] [--directory DIR] [--output REPORT.json] [--keep]\n');
    return 0;
  }
  const options = parseOptions(argv);
  const result = await runPackMemoryBenchmark({ ...options,
    onProgress: value => process.stderr.write(`SHARPFORGE_GIT_PACK_MEMORY_PROGRESS ${JSON.stringify(value)}\n`) });
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) await writeFile(options.output, json);
  process.stdout.write(json);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await packMemoryMain();
