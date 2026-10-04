import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const moduleBenchmarkHash = bytes => createHash('sha256').update(bytes).digest('hex');
const memoryFields = ['rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers'];

/** Arithmetic median and nearest-rank p95 of actual samples; empty measurements have no summary. */
export function moduleBenchmarkSummary(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.every(Number.isFinite)) throw new Error('A measured benchmark metric is not finite');
  const middle = sorted.length >> 1;
  return {
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1], min: sorted[0], max: sorted.at(-1),
  };
}

function memoryScope(before, after) {
  return Object.fromEntries(memoryFields.map(name => [name, {
    beforeBytes: before[name], afterBytes: after[name], deltaBytes: after[name] - before[name],
  }]));
}

function assemblyOf(result, role) {
  if (!result.success || !result.assembly?.byteLength)
    throw new Error(`${role}: compileToAssembly failed: ${JSON.stringify(result.diagnostics)}`);
  return result.assembly;
}

function checkExecution(result, fixture, role) {
  if (result.fault || result.state !== 'terminated')
    throw new Error(`${role}/${fixture.id}: ${result.state}: ${result.fault?.message ?? 'no terminal result'}`);
  if (result.output !== fixture.expected || result.exitCode !== 0)
    throw new Error(`${role}/${fixture.id}: output ${JSON.stringify(result.output)}, exit code ${result.exitCode}`);
}

/** Every compiler output must match the independently captured fixture before either timed phase begins. */
export function prepareModuleStartupArtifact(variant, fixture, options) {
  const started = performance.now();
  const assembly = assemblyOf(variant.compiler.compileToAssembly(fixture.source, options.compile), variant.role);
  const vm = new variant.runtime.CilVirtualMachine(assembly, options.launch);
  try {
    const result = vm.run();
    checkExecution(result, fixture, variant.role);
    if (performance.now() - started > options.timeoutMs) throw new Error(`Untimed output preflight exceeded ${options.timeoutMs} ms`);
    return {
      assembly,
      description: { peBytes: assembly.byteLength, peSha256: moduleBenchmarkHash(assembly), verifiedOutput: result.output },
    };
  } finally {
    vm.stop();
  }
}

/** Host GC, memory reads, artifact checks and hashing are all outside the compilation timer. */
export function measureModuleStartupCompile(variant, fixture, options, expectedArtifact) {
  globalThis.gc();
  const before = process.memoryUsage();
  const started = performance.now();
  const result = variant.compiler.compileToAssembly(fixture.source, options.compile);
  const elapsedMs = performance.now() - started;
  const after = process.memoryUsage();
  const assembly = assemblyOf(result, variant.role);
  if (assembly.byteLength !== expectedArtifact.peBytes || moduleBenchmarkHash(assembly) !== expectedArtifact.peSha256)
    throw new Error(`${variant.role}/${fixture.id}: repeated compilation changed the PE bytes`);
  if (elapsedMs > options.timeoutMs) throw new Error(`Synchronous compilation exceeded ${options.timeoutMs} ms`);
  return { elapsedMs, memory: memoryScope(before, after) };
}

/** The timed API is a fresh CilVirtualMachine(bytes) followed by run(); output checks and stop() follow the timer. */
export function measureModuleStartupExecution(variant, fixture, options, artifact) {
  globalThis.gc();
  const before = process.memoryUsage();
  let vm;
  try {
    const started = performance.now();
    vm = new variant.runtime.CilVirtualMachine(artifact, options.launch);
    const result = vm.run();
    const elapsedMs = performance.now() - started;
    const after = process.memoryUsage();
    checkExecution(result, fixture, variant.role);
    if (elapsedMs > options.timeoutMs) throw new Error(`Synchronous VM startup/run exceeded ${options.timeoutMs} ms`);
    return {
      elapsedMs, memory: memoryScope(before, after), instructions: vm.instructions,
      managedAllocations: vm.heap.stats.allocations, managedAllocatedBytes: vm.heap.stats.allocatedBytes,
      managedCollections: vm.heap.stats.collections, managedCollectionPauseMs: vm.heap.stats.totalPauseMs,
    };
  } finally {
    vm?.stop();
  }
}
