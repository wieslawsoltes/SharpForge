import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, release, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AssemblyInspector, decodeCoded } from '@sharpforge/cil';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (checkout, ...parameters) => execFileSync('git', ['-C', checkout, ...parameters], { encoding: 'utf8' }).trim();
const compilerEntry = realpathSync(resolve(option('--compiler') ?? fileURLToPath(import.meta.resolve('@sharpforge/compiler'))));
const compilerCheckout = realpathSync(resolve(dirname(compilerEntry), '../../..'));
assert.equal(compilerEntry, join(compilerCheckout, 'packages', 'compiler', 'src', 'index.js'), 'Compiler must be its checkout entry point');
const compilerPackage = JSON.parse(readFileSync(join(compilerCheckout, 'packages/compiler/package.json'), 'utf8'));
const compilerRequire = createRequire(pathToFileURL(compilerEntry));
const aliases = Object.keys(compilerPackage.dependencies).filter(name => name.startsWith('@sharpforge/')).map(name => {
  const resolved = realpathSync(compilerRequire.resolve(name));
  const expected = realpathSync(join(compilerCheckout, 'packages', name.slice('@sharpforge/'.length), 'src', 'index.js'));
  assert.equal(resolved, expected, `${name} must resolve inside the selected compiler checkout`);
  return { name, resolved, ownCheckout: true };
});
const driverPath = fileURLToPath(import.meta.url);
const driverCheckout = realpathSync(resolve(dirname(driverPath), '../../..'));
const provenance = {
  compilerEntry, compilerCheckout, compilerRevision: git(compilerCheckout, 'rev-parse', 'HEAD'),
  compilerTrackedChanges: git(compilerCheckout, 'status', '--porcelain', '--untracked-files=no'),
  compilerEntrySha256: hash(readFileSync(compilerEntry)), aliases,
  driverPath, driverRevision: git(driverCheckout, 'rev-parse', 'HEAD'), driverSha256: hash(readFileSync(driverPath)),
  driverTrackedChanges: git(driverCheckout, 'status', '--porcelain', '--untracked-files=no'),
  nodeArguments: process.execArgv, arguments: process.argv,
};
const importStarted = performance.now();
const { compileToReferenceAssembly } = await import(pathToFileURL(compilerEntry).href);
const compilerImportMs = performance.now() - importStarted;
const sourcePath = fileURLToPath(new URL('../../../tests/fixtures/a03-reference-assemblies/surface.cs', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const requested = option('--mode') ?? 'refout';
assert.ok(['refout', 'metadata'].includes(requested), 'Mode is refout or metadata');
const options = { name: 'RefSurface', allowUnsafe: true, ...(requested === 'refout' ? { refout: true } : {}) };
const firstStarted = performance.now();
const first = compileToReferenceAssembly(source, options);
const firstCompileMs = performance.now() - firstStarted;
assert.equal(first.success, true, JSON.stringify(first.diagnostics));

// Mode and output validation are outside every timed region; ignoring an unknown refout option must fail this guard.
const inspector = new AssemblyInspector(first.assembly);
const metadata = inspector.metadata;
const markerCount = (metadata.rows[12] ?? []).filter(([parent, constructor]) => {
  if (decodeCoded('HasCustomAttribute', parent) !== 0x20000001) return false;
  const member = inspector.resolveToken(decodeCoded('CustomAttributeType', constructor));
  return member.owner === 'System.Runtime.CompilerServices.ReferenceAssemblyAttribute';
}).length;
const contract = inspector.types.find(type => type.name === 'RefSurface.Contract');
assert.ok(contract, 'The rich contract fixture must be emitted');
assert.equal(markerCount, requested === 'refout' ? 1 : 0);
assert.equal(contract.fields.some(field => field.name === 'secret'), requested === 'metadata');
assert.equal(contract.methods.some(method => method.name === 'Hidden'), requested === 'metadata');
for (const name of ['RefSurface.GenericPacket`1', 'RefSurface.Envelope`1+Packet`1']) {
  assert.ok(inspector.types.some(type => type.name === name), `Missing generic fixture owner ${name}`);
}
const samples = [];
const heapDeltas = [];
const settlingSamples = 20;
const measuredSamples = 100;
for (let index = 0; index < settlingSamples + measuredSamples; index++) {
  globalThis.gc?.();
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  const result = compileToReferenceAssembly(source, options);
  const duration = performance.now() - started;
  heapDeltas.push(process.memoryUsage().heapUsed - before);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.assembly, first.assembly);
  samples.push(duration);
}
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const measured = samples.slice(settlingSamples);
const report = {
  schemaVersion: 2, mode: requested, node: process.version, platform: process.platform, architecture: process.arch,
  operatingSystemRelease: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem(),
  ...provenance, sourcePath, sourceSha256: hash(source), sourceBytes: Buffer.byteLength(source),
  assemblySha256: hash(first.assembly), assemblyBytes: first.assembly.length, markerCount,
  compilerImportMs, firstCompileMs,
  timingNote: 'First compilation excludes compiler import; sample summaries exclude the first 20 of 120 repeats.',
  settlingSamples, measuredSamples, medianMs: median(measured), p95Ms: percentile(measured, 0.95), p99Ms: percentile(measured, 0.99),
  gcExposed: typeof globalThis.gc === 'function', medianHeapUsedDelta: median(heapDeltas.slice(settlingSamples)),
  memoryNote: 'GC runs before each sample when exposed; heapUsed deltas include temporaries, not total allocations or retained-heap accounting.',
  samplesMs: samples, heapUsedDeltas: heapDeltas,
};
const json = JSON.stringify(report, null, 2) + '\n';
if (option('--output')) writeFileSync(option('--output'), json);
console.log(json);
