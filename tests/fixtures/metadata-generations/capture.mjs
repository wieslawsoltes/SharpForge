import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveToolchain, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { runProcess } from '../../../scripts/conformance/oracle/process.js';
import { replayMetadataGenerations } from './replay.mjs';

const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const root = resolve(fixtureRoot, '../../..');
const destination = process.argv[2] ? resolve(process.argv[2]) : null;
if (!destination) throw new Error('Pass an explicit fresh native capture directory');
try { await mkdir(destination); } catch (error) { if (error.code !== 'EEXIST') throw error; }
if ((await readdir(destination)).length) throw new Error('Native capture directory must be empty');
const record = { schemaVersion: 1, status: 'prepared', startedAt: new Date().toISOString(), sourceCommit: null, sourceHashes: {},
  packageAliases: [], toolchain: null, environment: null, commands: [], corpora: {} };
const save = () => writeFile(join(destination, 'native.json'), JSON.stringify(record, null, 2) + '\n');

async function filesUnder(directory) {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error('Source inventory requires regular files/directories');
  }
  return files;
}

async function sourceManifest() {
  const packages = ['cil'], seen = new Set(), files = [];
  while (packages.length) {
    const name = packages.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const directory = join(root, 'packages', name), manifest = join(directory, 'package.json');
    const metadata = JSON.parse(await readFile(manifest, 'utf8'));
    files.push(manifest, ...await filesUnder(join(directory, 'src')));
    for (const dependency of Object.keys(metadata.dependencies ?? {})) {
      assert.ok(dependency.startsWith('@sharpforge/'), 'Only declared workspace runtime dependencies are admitted');
      packages.push(dependency.slice('@sharpforge/'.length));
    }
    const resolved = await realpath(join(root, 'node_modules/@sharpforge', name));
    assert.equal(resolved, await realpath(directory), 'Own public package alias: ' + name);
    record.packageAliases.push({ name: metadata.name, path: relative(root, resolved).replaceAll('\\', '/') });
  }
  files.push(...await filesUnder(join(fixtureRoot, 'oracle')),
    ...['capture.mjs', 'replay.mjs', 'verify.mjs', 'browser.mjs'].map(name => join(fixtureRoot, name)),
    ...['a03-24-reader-budgets.test.js', 'a03-24-metadata-generations.test.js',
      'a03-24-metadata-generation-boundaries.test.js', 'a03-24-metadata-generations-native.test.js',
      'a03-24-minimal-delta.test.js', 'support/cli-metadata-delta.js'].map(name => join(root, 'tests', name)),
    join(root, 'scripts/conformance/oracle/toolchain.js'), join(root, 'scripts/conformance/oracle/process.js'),
    join(root, 'planning/qualification/oracle-toolchain.json'), join(root, 'tests/conformance/oracle/global.json'));
  const tracked = await runProcess('git', ['ls-files', '--error-unmatch', '-z', '--', ...files.map(file => relative(root, file))],
    { cwd: root, maxOutputBytes: 2 * 1024 * 1024 });
  assert.equal(tracked.exitCode, 0, 'Every captured source/tool file belongs to the frozen commit');
  for (const file of files.sort()) record.sourceHashes[relative(root, file).replaceAll('\\', '/')] = sha256(await readFile(file));
}

let toolchain;
async function retainCommand(command) {
  record.commands.push(command);
  for (const stream of ['stdout', 'stderr']) {
    const bytes = command.result[stream] ?? '';
    command[stream + 'File'] = command.label + '.' + stream + '.log';
    command[stream + 'SHA256'] = sha256(bytes);
    await writeFile(join(destination, command[stream + 'File']), bytes);
  }
  await save();
}

async function run(label, args) {
  const command = { label, argv: [toolchain.dotnet, ...args], cwd: destination };
  try {
    command.result = await runProcess(toolchain.dotnet, args, { cwd: destination, timeoutMs: 120000, maxOutputBytes: 16 * 1024 * 1024 });
  } catch (error) {
    command.result = error.result ?? { error: error.message };
    await retainCommand(command);
    throw error;
  }
  await retainCommand(command);
  assert.equal(command.result.exitCode, 0, label + ' exit status');
  assert.equal(command.result.signal, null, label + ' signal');
  return command.result.stdout;
}

try {
  await save();
  const revision = await runProcess('git', ['rev-parse', 'HEAD'], { cwd: root });
  assert.equal(revision.exitCode, 0);
  record.sourceCommit = revision.stdout.trim();
  const status = await runProcess('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root });
  assert.equal(status.exitCode, 0);
  assert.equal(status.stdout, '', 'Capture requires a frozen tracked source tree');
  await sourceManifest();
  toolchain = await resolveToolchain();
  record.toolchain = toolchain.actual;
  record.environment = toolchain.environment;
  await save();
  const original = join(root, 'tests/fixtures/portable-pdb-generations');
  const originalManifest = JSON.parse(await readFile(join(original, 'reference.json'), 'utf8'));
  for (const [name, expected] of Object.entries(originalManifest.artifacts)) {
    assert.equal(sha256(await readFile(join(original, name))), expected, 'Retained original fixture: ' + name);
  }
  record.originalManifestSHA256 = sha256(await readFile(join(original, 'reference.json')));
  record.originalInputsVerifiedBefore = true;
  const project = join(destination, 'project'), output = join(destination, 'output'), mixed = join(destination, 'mixed');
  await cp(join(fixtureRoot, 'oracle'), project, { recursive: true });
  await cp(join(root, 'tests/conformance/oracle/global.json'), join(destination, 'global.json'));
  await run('build', ['build', join(project, 'MetadataGenerations.csproj'), '-o', output, '--nologo',
    '-m:1', '-p:UseSharedCompilation=false', '-nodeReuse:false']);
  const observer = join(output, 'MetadataGenerations.dll');
  record.observerSHA256 = sha256(await readFile(observer));
  const created = JSON.parse(await run('create-mixed', [observer, 'create', mixed]));
  record.mixedCreation = created;
  await save();
  assert.equal(created.compilerSha256, originalManifest.compilerSha256, 'Pinned SDK compiler assembly');
  assert.equal(created.runtime, toolchain.actual.runtime);
  for (const [name, expected] of Object.entries(created.artifacts)) {
    assert.equal(sha256(await readFile(join(mixed, name))), expected, 'Generated mixed fixture: ' + name);
  }
  for (const [name, directory] of [['original', original], ['mixed', mixed]]) {
    const names = ['baseline.dll', 'delta1.dmeta', 'delta2.dmeta'];
    const native = JSON.parse(await run('observe-' + name, [observer, 'observe', ...names.map(file => join(directory, file))]));
    record.corpora[name] = native;
    await save();
    assert.equal(native.runtime, toolchain.actual.runtime);
    const inputs = await Promise.all(names.map(file => readFile(join(directory, file))));
    native.artifacts.forEach((artifact, index) => assert.equal(sha256(inputs[index]), artifact.sha256));
    const replay = replayMetadataGenerations(native, inputs, assert.deepEqual);
    record.corpora[name].replay = replay.totals;
    replay.reader.dispose();
    await save();
  }
  for (const [name, expected] of Object.entries(originalManifest.artifacts)) {
    assert.equal(sha256(await readFile(join(original, name))), expected, 'Original fixture remains byte exact: ' + name);
  }
  record.originalInputsVerifiedAfter = true;
  record.status = 'native-and-node-replay-completed';
  record.finishedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ output: destination, sourceCommit: record.sourceCommit, status: record.status,
    corpora: Object.fromEntries(Object.entries(record.corpora).map(([name, corpus]) => [name, corpus.replay])) }, null, 2));
} catch (error) {
  record.status = 'failed';
  record.finishedAt = new Date().toISOString();
  record.failure = { name: error.name, message: error.message, stack: error.stack };
  await save();
  throw error;
}
