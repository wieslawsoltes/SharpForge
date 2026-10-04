import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { checkCancelled } from '@sharpforge/git';

export function percentile(values, fraction) {
  if (!values.length) throw new RangeError('A percentile requires samples');
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}

/** Per-phase sampled memory plus process RSS high-water information; no claim of OS cache eviction. */
export async function measureOperation(operation, { counters, signal } = {}) {
  checkCancelled(signal);
  const before = { ...counters };
  const initial = process.memoryUsage();
  let peakRssBytes = initial.rss;
  let peakHeapBytes = initial.heapUsed;
  const sample = () => {
    const memory = process.memoryUsage();
    peakRssBytes = Math.max(peakRssBytes, memory.rss);
    peakHeapBytes = Math.max(peakHeapBytes, memory.heapUsed);
  };
  const timer = setInterval(sample, 10);
  const start = performance.now();
  try {
    const value = await operation();
    checkCancelled(signal);
    sample();
    return { value, sample: {
      milliseconds: performance.now() - start, peakRssBytes, peakHeapBytes,
      objectOperations: Object.fromEntries(Object.entries(counters ?? {}).map(([key, count]) => [key, count - (before[key] ?? 0)]))
    } };
  } finally { clearInterval(timer); }
}

export function summarizeSamples(samples) {
  const times = samples.map(sample => sample.milliseconds);
  return {
    samples: samples.length, medianMs: percentile(times, 0.5), p95Ms: percentile(times, 0.95), p99Ms: percentile(times, 0.99),
    peakRssBytes: Math.max(...samples.map(sample => sample.peakRssBytes)),
    peakHeapBytes: Math.max(...samples.map(sample => sample.peakHeapBytes)), raw: samples
  };
}

/** All measured ODB calls are explicit wrapper delegation, preserving the real storage backend. */
export class CountingObjectDatabase {
  constructor(database) {
    this.database = database;
    this.algorithm = database.algorithm;
    this.store = database.store;
    this.counters = { read: 0, readHeader: 0, has: 0, write: 0, list: 0 };
  }
  read(oid, options) { this.counters.read++; return this.database.read(oid, options); }
  readHeader(oid, options) { this.counters.readHeader++; return this.database.readHeader(oid, options); }
  has(oid, options) { this.counters.has++; return this.database.has(oid, options); }
  write(type, data, options) { this.counters.write++; return this.database.write(type, data, options); }
  list(options) { this.counters.list++; return this.database.list(options); }
  addPackReader(reader) { return this.database.addPackReader(reader); }
}

export async function directoryStatistics(directory, { signal } = {}) {
  checkCancelled(signal);
  const pending = [directory];
  let bytes = 0;
  let files = 0;
  while (pending.length) {
    checkCancelled(signal);
    const current = pending.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      checkCancelled(signal);
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else { bytes += (await lstat(path)).size; files++; }
    }
  }
  checkCancelled(signal);
  return { bytes, files };
}

/** A baseline must describe the identical fixture and measurements; >20% time/RSS regression fails. */
export function compareBenchmarkBaseline(result, baseline, tolerance = 0.2) {
  if (baseline.complete === false) throw new Error('An incomplete benchmark report cannot be used as a baseline');
  const keys = Object.keys(result.profile).sort();
  if (baseline.schema !== result.schema || keys.length !== Object.keys(baseline.profile).length
    || keys.some(key => baseline.profile[key] !== result.profile[key])) {
    throw new Error('Benchmark baseline profile does not match the current fixture');
  }
  const regressions = [];
  for (const [operation, value] of Object.entries(result.measurements)) {
    const previous = baseline.measurements[operation];
    if (!previous) throw new Error(`Benchmark baseline is missing ${operation}`);
    for (const metric of ['medianMs', 'p95Ms', 'p99Ms', 'peakRssBytes']) {
      if (!Number.isFinite(previous[metric]) || previous[metric] < 0) throw new Error(`Invalid baseline metric: ${operation}.${metric}`);
      if (value[metric] > previous[metric] * (1 + tolerance)) {
        regressions.push({ operation, metric, baseline: previous[metric], current: value[metric],
          ratio: previous[metric] ? value[metric] / previous[metric] : null });
      }
    }
  }
  return regressions;
}
