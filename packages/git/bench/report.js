import { cpus, totalmem, platform, release, arch } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { summarizeSamples } from './metrics.js';

/** Incomplete reports contain only measurements which actually finished successfully. */
export function createBenchmarkReport(profile) {
  return {
    schema: 'sharpforge.git.benchmark.v1', profile,
    machine: {
      platform: platform(), release: release(), arch: arch(), cpus: cpus().length, cpu: cpus()[0]?.model,
      totalMemoryBytes: totalmem(), node: process.version, reference: null
    },
    fixture: null,
    cachePolicy: {
      cold: 'New repository session after initialization', warm: 'Immediate repeat in the same repository session',
      clone: 'Fresh empty destination for every sample; native source and OS caches are not flushed'
    },
    memoryPolicy: { sampleIntervalMs: 10, processPeakRssBytes: process.resourceUsage().maxRSS * 1024 },
    measurements: {}, storage: null, regressions: [], phase: 'initialize', complete: false, ok: false
  };
}

export function recordBenchmarkSample(report, name, sample) {
  const samples = [...(report.measurements[name]?.raw ?? []), sample];
  report.measurements[name] = summarizeSamples(samples);
}

/** Preserve the original failure for callers while retaining a serializable, explicitly incomplete report. */
export class BenchmarkFailure extends Error {
  constructor(cause, report) {
    super(cause?.message ?? 'Benchmark failed', { cause });
    this.name = 'BenchmarkFailure';
    const primary = cause?.cause ?? cause;
    this.code = primary?.name === 'AbortError' ? 'Cancelled' : primary?.code ?? 'BenchmarkFailed';
    report.ok = false;
    report.complete = false;
    report.failure = { phase: report.phase, name: cause?.name ?? 'Error', code: this.code };
    this.report = report;
  }
}

/** The CLI uses the same artifact format for complete measurements and caught failures. */
export async function writeBenchmarkReport(report, output) {
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (output) await writeFile(output, json);
  return json;
}
