import { cpus, platform, arch } from 'node:os';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFixtureSize } from './limits.js';

export const editorBenchmarkSizes = Object.freeze([1024, 1024 ** 2, 10 * 1024 ** 2, 100 * 1024 ** 2]);
export const rootDirectory = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const schemaVersion = 1;

export function distribution(samples) {
  if (!Array.isArray(samples) || !samples.length || samples.some(value => !Number.isFinite(value) || value < 0)) {
    throw new TypeError('Expected finite nonnegative benchmark samples');
  }
  const values = [...samples].sort((first, second) => first - second);
  const percentile = value => values[Math.max(0, Math.ceil(value * values.length) - 1)];
  return { p50Ms: percentile(.50), p95Ms: percentile(.95), p99Ms: percentile(.99), minMs: values[0], maxMs: values.at(-1), count: values.length };
}

export function validateOptions({ sizes = editorBenchmarkSizes, samples = 20, warmups = 3 } = {}) {
  if (!Array.isArray(sizes) || !sizes.length || sizes.length > 8) throw new RangeError('Expected one through eight editor fixture sizes');
  for (const size of sizes) validateFixtureSize(size);
  if (!Number.isSafeInteger(samples) || samples < 3 || samples > 1000 || !Number.isSafeInteger(warmups) || warmups < 0 || warmups > 100) {
    throw new RangeError('Invalid benchmark sample/warmup count');
  }
  return { sizes: [...new Set(sizes)], samples, warmups };
}

export function parseArguments(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!flag.startsWith('--')) throw new Error(`Unexpected argument '${flag}'`);
    const key = flag.slice(2);
    if (['require-browser', 'allow-environment-change'].includes(key)) { result[key] = true; continue; }
    const value = args[++index];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (Object.hasOwn(result, key)) throw new Error(`Duplicate ${flag}`);
    result[key] = value;
  }
  return result;
}

export function environment() {
  let commit = 'unknown';
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDirectory, encoding: 'utf8' }).trim(); }
  catch { /* A source archive has no Git metadata; the report states that explicitly. */ }
  return { node: process.version, v8: process.versions.v8, platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpus: cpus().length, commit };
}

export async function writeReport(path, report) {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
  return destination;
}

export function isMain(url) {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(url);
}
