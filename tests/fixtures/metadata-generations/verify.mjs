import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertPins, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';

const fixtureRoot = dirname(fileURLToPath(import.meta.url)), root = resolve(fixtureRoot, '../../..');
const hashPattern = /^[a-f0-9]{64}$/;
const inputNames = ['baseline.dll', 'delta1.dmeta', 'delta2.dmeta'];

async function hashedFile(file, expected, label) {
  assert.match(expected, hashPattern, label + ' SHA-256');
  const bytes = await readFile(file);
  assert.equal(sha256(bytes), expected, label);
  return bytes;
}

async function verifyCommands(record, directory) {
  assert.deepEqual(record.commands.map(command => command.label), ['build', 'create-mixed', 'observe-original', 'observe-mixed']);
  for (const command of record.commands) {
    assert.equal(command.result.exitCode, 0, command.label + ' exit status');
    assert.equal(command.result.signal, null, command.label + ' signal');
    assert.ok(Number.isFinite(command.result.elapsedMs) && command.result.elapsedMs >= 0, command.label + ' duration');
    assert.ok(command.argv.length > 1 && command.cwd, command.label + ' command');
    for (const stream of ['stdout', 'stderr']) {
      assert.equal(command[stream + 'File'], command.label + '.' + stream + '.log');
      const bytes = await hashedFile(join(directory, command[stream + 'File']), command[stream + 'SHA256'], command.label + ' ' + stream);
      assert.equal(bytes.toString('utf8'), command.result[stream], 'Retained raw command output');
    }
  }
}

async function verifySources(record, strictSource) {
  assert.match(record.sourceCommit, /^[a-f0-9]{40}$/, 'Frozen source commit');
  assert.ok(Object.keys(record.sourceHashes).length > 10, 'Full source/tool inventory');
  assert.deepEqual(record.packageAliases.map(value => value.name).sort(),
    ['@sharpforge/bcl-collections', '@sharpforge/bcl-core', '@sharpforge/bytecode', '@sharpforge/cil', '@sharpforge/framework']);
  for (const alias of record.packageAliases) assert.equal(alias.path, 'packages/' + alias.name.slice('@sharpforge/'.length));
  for (const name of ['Program.cs', 'FixtureWriter.cs', 'NativeRows.cs', 'NativeHeaps.cs', 'MetadataGenerations.csproj', 'NuGet.Config']) {
    assert.match(record.sourceHashes['tests/fixtures/metadata-generations/oracle/' + name], hashPattern, 'Observer source: ' + name);
  }
  for (const [path, expected] of Object.entries(record.sourceHashes)) {
    assert.ok(/^(packages|scripts|tests|planning)\//.test(path) && !path.split('/').includes('..'), 'Owned source path');
    assert.match(expected, hashPattern, path);
    if (strictSource) await hashedFile(join(root, path), expected, 'Current frozen source: ' + path);
  }
}

/** Validate retained native provenance without launching any compiler/runtime or importing the product. */
export async function verifyMetadataGenerationCapture(directory = join(fixtureRoot, 'reference'), { strictSource = false } = {}) {
  const record = JSON.parse(await readFile(join(directory, 'native.json'), 'utf8'));
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.status, 'native-and-node-replay-completed', 'A missing/failed native capture cannot qualify');
  assert.ok(Date.parse(record.startedAt) <= Date.parse(record.finishedAt), 'Native capture time span');
  assertPins(record.toolchain, undefined, record.environment.platform);
  assert.match(record.observerSHA256, hashPattern, 'Built observer SHA-256');
  await verifySources(record, strictSource);
  await verifyCommands(record, directory);
  const original = join(root, 'tests/fixtures/portable-pdb-generations');
  const manifestBytes = await hashedFile(join(original, 'reference.json'), record.originalManifestSHA256, 'Original manifest');
  const originalManifest = JSON.parse(manifestBytes);
  assert.equal(record.originalInputsVerifiedBefore, true);
  assert.equal(record.originalInputsVerifiedAfter, true);
  for (const [name, expected] of Object.entries(originalManifest.artifacts)) {
    await hashedFile(join(original, name), expected, 'Original artifact: ' + name);
  }
  assert.equal(record.mixedCreation.compilerSha256, originalManifest.compilerSha256);
  assert.deepEqual(record.mixedCreation, JSON.parse(record.commands.find(value => value.label === 'create-mixed').result.stdout),
    'Creation facts come from the retained native stdout');
  assert.equal(record.mixedCreation.compiler, originalManifest.compiler);
  assert.equal(record.mixedCreation.runtime, record.toolchain.runtime);
  assert.match(record.mixedCreation.referenceAssembly.sha256, hashPattern, 'Compilation reference hash');
  assert.deepEqual(record.mixedCreation.operations, ['update Old + insert Added + insert field', 'update Added + insert AddedAgain']);
  const artifactNames = ['baseline.cs', 'baseline.dll', 'baseline.pdb',
    ...[1, 2].flatMap(generation => ['cs', 'dmeta', 'dil', 'pdb'].map(extension => `delta${generation}.${extension}`))];
  assert.deepEqual(Object.keys(record.mixedCreation.artifacts).sort(), artifactNames.sort());
  for (const [name, expected] of Object.entries(record.mixedCreation.artifacts)) {
    assert.ok(/^(baseline|delta[12])\.(cs|dll|pdb|dmeta|dil)$/.test(name), 'Generated artifact name');
    await hashedFile(join(directory, 'mixed', name), expected, 'Mixed artifact: ' + name);
  }
  assert.deepEqual(Object.keys(record.corpora).sort(), ['mixed', 'original']);
  const inputs = {};
  for (const [name, corpus] of Object.entries(record.corpora)) {
    const { replay, ...observations } = corpus;
    assert.deepEqual(observations, JSON.parse(record.commands.find(value => value.label === 'observe-' + name).result.stdout),
      'Observation facts come from the retained native stdout');
    assert.equal(corpus.schemaVersion, 1);
    assert.equal(corpus.runtime, record.toolchain.runtime);
    assert.deepEqual(corpus.artifacts.map(value => value.name), inputNames);
    assert.deepEqual(corpus.generations.map(value => value.generation), [0, 1, 2]);
    assert.equal(replay.generations, 3);
    inputs[name] = [];
    for (const artifact of corpus.artifacts) {
      const base = name === 'original' ? original : join(directory, 'mixed');
      const bytes = await hashedFile(join(base, artifact.name), artifact.sha256, name + '/' + artifact.name);
      assert.equal(bytes.length, artifact.bytes);
      inputs[name].push(bytes);
    }
  }
  return { record, inputs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), strictSource = args.includes('--strict-source');
  const paths = args.filter(value => value !== '--strict-source');
  if (paths.length > 1) throw new Error('verify.mjs [capture-directory] [--strict-source]');
  const { record } = await verifyMetadataGenerationCapture(paths[0] ? resolve(paths[0]) : undefined, { strictSource });
  console.log(JSON.stringify({ verified: true, strictSource, sourceCommit: record.sourceCommit,
    corpora: Object.keys(record.corpora), runtime: record.toolchain.runtime }));
}
