import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { symbolWorkspace, sha256, benchmarkSources, benchmarkEnvironment } from './benchmarks/pdb-context.mjs';
import { measurePdbWorkloads } from './benchmarks/pdb-measure.mjs';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');
const argument = (name) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  assert(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), 'Missing ' + name + ' value');
  return process.argv[index + 1];
};
const current = await symbolWorkspace(root, { compiler: true });
const libraries = [{ name: 'current', ...current }];
const baseline = argument('--baseline');
if (baseline) libraries.unshift({ name: 'baseline', ...await symbolWorkspace(baseline, {
  expectedCommit: argument('--baseline-revision') ?? '8b101c0c7e8ad73675dfe12e68f26329d7ea2d9c',
}) });
assert(new Set(libraries.map((library) => library.provenance.root)).size === libraries.length, 'Baseline and current must resolve separately');

// Keep the original emit/read/load fixture and API arguments unchanged.
const text = 'public class Example { public int Value => 42; }\n'.repeat(200);
const sourceBytes = new TextEncoder().encode(text);
const program = 'Console.WriteLine(1);';
const compiled = current.compiler.compileToIL(program, { portablePdb: false });
assert(compiled.success, JSON.stringify(compiled.diagnostics));
const debug = { sources: [{ uri: '/src/Example.cs', text }] };
const pe = current.cil.readPE(compiled.assembly);
const methodCount = pe.metadata.counts[6];
assert(methodCount > 0, 'Benchmark assembly must contain methods');

function facts(symbols) {
  return { id: symbols.id, entryPoint: symbols.entryPoint, documents: symbols.documents, methods: symbols.methods,
    scopes: symbols.scopes, variables: symbols.variables, constants: symbols.constants, imports: symbols.imports,
    stateMachines: symbols.stateMachines, custom: symbols.custom, sourceLink: symbols.sourceLink };
}

function guard(symbols, emitted, bound) {
  assert.deepEqual(symbols.id, emitted.id);
  assert.equal(symbols.documents.length, 1);
  assert.equal(symbols.documents[0].name, debug.sources[0].uri);
  assert.equal(Buffer.from(symbols.documents[0].hash).toString('hex'), sha256(sourceBytes));
  assert.deepEqual(symbols.documents[0].embedded, sourceBytes);
  assert.equal(symbols.methods.length, methodCount);
  assert.deepEqual(symbols.metadata.externalCounts, Object.fromEntries(Object.entries(pe.metadata.counts).filter(([, count]) => count)));
  assert.equal(symbols.entryPoint, pe.entryPoint);
  for (const [index, method] of symbols.methods.entries()) {
    assert.equal(method.token, 0x06000001 + index);
    assert.deepEqual(method.points, [], 'The original benchmark supplies no sequence points');
    assert.equal(symbols.location(method.token, 0), null);
    assert.deepEqual(symbols.locals(method.token, 0), []);
  }
  if (bound) assert.equal(symbols.bound, true, 'Embedded PDB must bind to the assembly');
}

for (const item of libraries) {
  item.emitted = item.symbols.emitPortablePdb(compiled.assembly, debug);
  item.attached = item.symbols.attachPortablePdb(compiled.assembly, item.emitted.bytes, { embedded: true });
  item.read = item.symbols.readPortablePdb(item.emitted.bytes);
  item.loaded = item.symbols.loadSymbols(item.attached);
  guard(item.read, item.emitted, false);
  guard(item.loaded, item.emitted, true);
  assert.deepEqual(facts(item.loaded), facts(item.read), 'Read and bound-load semantic facts differ');
}
for (const item of libraries.slice(1)) {
  assert.deepEqual(item.emitted.bytes, libraries[0].emitted.bytes, 'Baseline/current emitted PDB bytes differ');
  assert.deepEqual(item.attached, libraries[0].attached, 'Baseline/current attached PE/PDB bytes differ');
  assert.deepEqual(facts(item.read), facts(libraries[0].read), 'Baseline/current read facts differ');
  assert.deepEqual(facts(item.loaded), facts(libraries[0].loaded), 'Baseline/current loaded facts differ');
}

const workloads = [];
for (const name of ['emit', 'read', 'load']) for (const item of libraries) {
  workloads.push({ library: item.name, name,
    operation: name === 'emit' ? () => item.symbols.emitPortablePdb(compiled.assembly, debug) :
      name === 'read' ? () => item.symbols.readPortablePdb(item.emitted.bytes) : () => item.symbols.loadSymbols(item.attached),
    consume: (result) => {
      assert.deepEqual(result.id, item.emitted.id);
      if (name === 'emit') {
        assert.equal(result.bytes.length, item.emitted.bytes.length);
        return result.bytes.length + result.bytes[0] + result.bytes.at(-1);
      }
      assert.equal(result.methods.length, methodCount);
      assert.equal(result.documents[0].embedded.length, sourceBytes.length);
      if (name === 'load') assert.equal(result.bound, true);
      return result.methods.length + result.documents[0].embedded.length + result.id[0];
    },
  });
}
const environment = benchmarkEnvironment();
const measured = measurePdbWorkloads(workloads);
console.log(JSON.stringify({ schemaVersion: 2, scope: 'Existing baseline Portable PDB emit/read/load workloads', environment,
  benchmarkSources: benchmarkSources([script, resolve(root, 'scripts/benchmarks/pdb-context.mjs'),
    resolve(root, 'scripts/benchmarks/pdb-measure.mjs')]),
  libraries: libraries.map((item) => ({ name: item.name, ...item.provenance })),
  fixture: { program, programSha256: sha256(program), sourceBytes: sourceBytes.length, sourceSha256: sha256(sourceBytes),
    assemblyBytes: compiled.assembly.length, assemblySha256: sha256(compiled.assembly), methodCount,
    pdbBytes: libraries[0].emitted.bytes.length, pdbSha256: sha256(libraries[0].emitted.bytes),
    attachedBytes: libraries[0].attached.length, attachedSha256: sha256(libraries[0].attached) },
  correctness: { comparedLibraries: libraries.length, byteExactEmittedPdb: libraries.length > 1,
    byteExactAttachedImage: libraries.length > 1, readAndLoadFacts: true, documentChecksumAndEmbeddedSource: true,
    methodIdentitiesAndEmptyMaps: true,
    qualification: 'Untimed guards before measurement; each timed result is also consumed and checked outside timing' },
  ...measured }, null, 2));
