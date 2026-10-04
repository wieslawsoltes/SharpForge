import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { AssemblyLoadSession } from '../src/index.js';

const native = JSON.parse(readFileSync(new URL('../../../tests/fixtures/clr-manifest-resources/native-manifest-resources.json', import.meta.url)));
const files = new Map(native.files.map(file => [file.name, new Uint8Array(Buffer.from(file.bytesBase64, 'base64'))]));
const assemblies = new Map(native.files.filter(file => file.assemblyName).map(file => [file.assemblyName, files.get(file.name)]));
const context = new AssemblyLoadSession().createContext({ name: 'Manifest resource benchmark', isCollectible: true,
  load: ({ assemblyName }) => assemblies.get(assemblyName.name) ?? null });
const embeddedCase = native.cases.find(item => item.classification === 'embedded' && item.expectedBase64);
const fileCase = native.cases.find(item => item.classification === 'linked-file' && item.expectedBase64);
const forwardedCase = native.cases.find(item => item.classification === 'forwarded' && item.expectedBase64);
assert(embeddedCase && fileCase && forwardedCase, 'The benchmark needs positive embedded, file and forwarded native inputs');
const embedded = await context.loadFromAssemblyName(embeddedCase.assemblyName);
const linked = await context.loadFromAssemblyName(fileCase.assemblyName);
const forwarded = await context.loadFromAssemblyName(forwardedCase.assemblyName);
const fileProvider = ({ name }) => files.get(name) ?? null;
const warmEmbedded = embedded.openManifestResources();
const warmFile = linked.openManifestResources({ fileProvider });
const warmForwarded = forwarded.openManifestResources();
const expectedNames = embeddedCase.coreClr.names.value;
const protocol = Object.freeze({ samples: 100, warmupBatches: 10, coldIterations: 100, warmIterations: 5000 });
let checksum = 0;

function payloadGuard(expectedBase64) {
  const expected = Buffer.from(expectedBase64, 'base64');
  return actual => {
    assert(actual instanceof Uint8Array);
    assert.equal(actual.length, expected.length);
    for (let index = 0; index < expected.length; index++) assert.equal(actual[index], expected[index]);
    return actual.length;
  };
}

const embeddedGuard = payloadGuard(embeddedCase.expectedBase64);
const fileGuard = payloadGuard(fileCase.expectedBase64);
const forwardedGuard = payloadGuard(forwardedCase.expectedBase64);

async function measure(name, operation, iterations) {
  const samples = [];
  for (let sample = -protocol.warmupBatches; sample < protocol.samples; sample++) {
    const start = performance.now();
    for (let index = 0; index < iterations; index++) checksum += await operation();
    if (sample >= 0) samples.push((performance.now() - start) * 1000 / iterations);
  }
  const ordered = [...samples].sort((left, right) => left - right);
  return { name, unit: 'microseconds/operation', iterations, samples,
    median: (ordered[49] + ordered[50]) / 2, p95: ordered[94], p99: ordered[98] };
}

try {
  const results = [];
  results.push(await measure('cold manifest index on an already loaded assembly', () => {
    const reader = embedded.openManifestResources();
    assert.deepEqual(reader.names, expectedNames);
    const count = reader.names.length;
    reader.dispose();
    return count;
  }, protocol.coldIterations));
  results.push(await measure('warm embedded resource with owned payload copy', async () =>
    embeddedGuard(await warmEmbedded.read(embeddedCase.resource)), protocol.warmIterations));
  results.push(await measure('cold linked-file acquisition, copy and hash verification', async () => {
    const reader = linked.openManifestResources({ fileProvider });
    const count = fileGuard(await reader.read(fileCase.resource));
    reader.dispose();
    return count;
  }, protocol.coldIterations));
  results.push(await measure('warm verified file with owned payload copy', async () =>
    fileGuard(await warmFile.read(fileCase.resource)), protocol.warmIterations));
  results.push(await measure('warm AssemblyRef chain with owned payload copy', async () =>
    forwardedGuard(await warmForwarded.read(forwardedCase.resource)), protocol.warmIterations));
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
    protocol, cases: [embeddedCase.id, fileCase.id, forwardedCase.id], fileHashAlgorithm: linked.manifestModule.row(0x20000001)[0],
    payloadBytes: [embeddedCase, fileCase, forwardedCase].map(item => Buffer.from(item.expectedBase64, 'base64').length),
    previousEquivalentImplementation: false, allocationCount: 'not measured', checksum, results }, null, 2));
} finally {
  warmEmbedded.dispose();
  warmFile.dispose();
  warmForwarded.dispose();
  context.unload();
}
