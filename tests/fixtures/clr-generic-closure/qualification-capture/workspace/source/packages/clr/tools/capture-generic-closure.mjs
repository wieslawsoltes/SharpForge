import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sourcePath = 'packages/clr/interop/GenericClosure';
const driverPath = 'packages/clr/tools/capture-generic-closure.mjs';
const ownedFiles = ['CaseObservations.cs', 'MetadataImage.cs', 'MetadataInventory.cs', 'NativeTypes.cs',
  'Program.cs', 'RequestBindings.cs', 'images.json', 'matrix.json', 'oracle-toolchain.json'];
const reusedFiles = ['TypeObservations.cs', 'SignatureObservations.cs']
  .map(name => 'packages/clr/interop/GenericInstantiation/' + name);
const sourceInputs = [...ownedFiles.map(name => sourcePath + '/' + name), ...reusedFiles, driverPath].sort();
const processLimits = { timeoutMilliseconds: 120000, maximumBufferedBytes: 32 * 1024 * 1024 };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = path => sha256(readFileSync(path));
const json = (path, value, flag = 'w') => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag });
const identity = path => ({ path: realpathSync(path), bytes: statSync(path).size, sha256: digest(path) });
const driverStartSha256 = digest(join(root, driverPath));

function destination(path) {
  const suffix = [];
  let ancestor = resolve(path);
  while (!existsSync(ancestor)) {
    suffix.unshift(basename(ancestor));
    ancestor = dirname(ancestor);
  }
  return join(realpathSync(ancestor), ...suffix);
}

function optionsOf(arguments_) {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    if (!['--dotnet', '--output', '--evidence'].includes(key) || !arguments_[index + 1] || Object.hasOwn(values, key)) {
      throw new Error('Usage: capture-generic-closure.mjs --dotnet /absolute/dotnet --output /fresh/dir --evidence /fresh/dir');
    }
    values[key] = arguments_[index + 1];
  }
  for (const key of ['--dotnet', '--output', '--evidence']) {
    if (!values[key] || !isAbsolute(values[key])) throw new Error(key + ' requires an explicit absolute path');
  }
  const output = destination(values['--output']);
  const evidence = destination(values['--evidence']);
  if (output === evidence || output.startsWith(evidence + sep) || evidence.startsWith(output + sep)) {
    throw new Error('Output and evidence must be separate directories without an ancestor relationship');
  }
  return { dotnet: realpathSync(values['--dotnet']), output, evidence };
}

const options = optionsOf(process.argv.slice(2));
for (const directory of [options.output, options.evidence]) {
  if (existsSync(directory)) throw new Error('Refusing to reuse a capture directory: ' + directory);
}
mkdirSync(dirname(options.evidence), { recursive: true });
mkdirSync(options.evidence);
const workspace = join(options.evidence, 'workspace');
const staged = join(workspace, 'source');
const stagedInterop = join(staged, sourcePath);
const imagesDirectory = join(workspace, 'images');
const progressDirectory = join(workspace, 'progress');
const runtimeConfig = join(workspace, 'pinned.runtimeconfig.json');
const statusPath = join(options.evidence, 'capture-status.json');
const inheritedKeys = ['PATH', 'SystemRoot', 'WINDIR', 'TMP', 'TEMP', 'TMPDIR', 'LANG', 'LC_ALL'];
const environment = Object.fromEntries(inheritedKeys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
Object.assign(environment, { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_NOLOGO: '1',
  DOTNET_MULTILEVEL_LOOKUP: '0', DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: '1', DOTNET_CLI_HOME: join(workspace, 'cli-home') });
const capture = { schemaVersion: 1, status: 'started', startedUtc: new Date().toISOString(), argv: process.argv,
  cwd: process.cwd(), workspace, output: options.output, evidence: options.evidence, node: process.version,
  nodeArguments: process.execArgv, nodeExecutable: identity(process.execPath), platform: process.platform,
  architecture: process.arch, hostKind: 'local-process', steps: [] };
json(statusPath, capture, 'wx');

function run(label, arguments_) {
  const stem = String(capture.steps.length + 1).padStart(2, '0') + '-' + label;
  const record = { label, argv: [options.dotnet, ...arguments_], cwd: workspace, environment,
    startedUtc: new Date().toISOString(), limits: processLimits, status: 'started' };
  capture.steps.push(record);
  json(statusPath, capture);
  const result = spawnSync(options.dotnet, arguments_, { cwd: workspace, env: environment,
    timeout: processLimits.timeoutMilliseconds, maxBuffer: processLimits.maximumBufferedBytes, windowsHide: true });
  const stdout = join(options.evidence, stem + '.stdout');
  const stderr = join(options.evidence, stem + '.stderr');
  writeFileSync(stdout, result.stdout ?? Buffer.alloc(0), { flag: 'wx' });
  writeFileSync(stderr, result.stderr ?? Buffer.alloc(0), { flag: 'wx' });
  Object.assign(record, {
    finishedUtc: new Date().toISOString(), exitCode: result.status, signal: result.signal,
    error: result.error ? { name: result.error.name, code: result.error.code, message: result.error.message } : null,
    status: result.error || result.signal ? 'process-failure' : 'exited', stdout: identity(stdout), stderr: identity(stderr) });
  json(join(options.evidence, stem + '-execution.json'), record, 'wx');
  json(statusPath, capture);
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(label + ' did not complete normally; raw process and progress evidence is retained in ' + options.evidence);
  }
  return (result.stdout ?? Buffer.alloc(0)).toString('utf8');
}

function pathsUnder(directory, depth = 0) {
  assert.ok(depth <= 16, 'Capture source inventory exceeds 16 directory levels');
  const paths = [];
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const item of entries) {
    const path = join(directory, item.name);
    if (item.isDirectory()) paths.push(...pathsUnder(path, depth + 1));
    else if (item.isFile()) paths.push(path);
    else throw new Error('Capture input inventory contains a non-regular entry: ' + path);
    assert.ok(paths.length <= 10000, 'Capture inventory exceeds 10,000 files');
  }
  return paths;
}

function sourceRecords(paths, sourceRoot = root) {
  return paths.map(path => ({ path, bytes: statSync(join(sourceRoot, path)).size, sha256: digest(join(sourceRoot, path)) }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function productRecords() {
  const paths = pathsUnder(join(root, 'packages/clr/src')).filter(path => path.endsWith('.js'))
    .map(path => relative(root, path).split(sep).join('/'));
  return sourceRecords(paths);
}

function ownInventory() {
  return pathsUnder(join(root, sourcePath)).map(path => relative(join(root, sourcePath), path).split(sep).join('/')).sort();
}

function prepare() {
  assert.deepEqual(ownInventory(), [...ownedFiles].sort(), 'The authored observer source inventory must match exactly');
  mkdirSync(staged, { recursive: true });
  mkdirSync(imagesDirectory);
  mkdirSync(progressDirectory);
  for (const path of sourceInputs) {
    const target = join(staged, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, path), target, constants.COPYFILE_EXCL);
  }
  capture.sources = sourceRecords(sourceInputs, staged);
  assert.equal(digest(join(staged, driverPath)), driverStartSha256, 'Driver changed after this process started');
  assert.deepEqual(capture.sources, sourceRecords(sourceInputs), 'Live sources changed while staging');
  capture.productSources = productRecords();
  const pin = JSON.parse(readFileSync(join(stagedInterop, 'oracle-toolchain.json'), 'utf8'));
  assert.deepEqual([pin.sdk, pin.runtime, pin.referencePack, pin.targetFramework], ['10.0.201', '10.0.5', '10.0.5', 'net10.0']);
  json(join(workspace, 'global.json'), { sdk: { version: pin.sdk, rollForward: 'disable', allowPrerelease: false } }, 'wx');
  writeFileSync(join(workspace, 'NuGet.Config'), '<configuration><packageSources><clear /></packageSources></configuration>', { flag: 'wx' });
  json(runtimeConfig, { runtimeOptions: { tfm: pin.targetFramework,
    framework: { name: 'Microsoft.NETCore.App', version: pin.runtime }, rollForward: 'Disable' } }, 'wx');
  const matrix = JSON.parse(readFileSync(join(stagedInterop, 'matrix.json'), 'utf8'));
  const images = JSON.parse(readFileSync(join(stagedInterop, 'images.json'), 'utf8'));
  assert.equal(matrix.schemaVersion, 1);
  assert.equal(images.schemaVersion, 1);
  const operations = matrix.cases.reduce((sum, item) => sum + 2 + (item.companions?.length ?? 0), 0);
  const identities = matrix.cases.reduce((sum, item) => sum + 1 + (item.identities?.length ?? 0), 0);
  assert.deepEqual([matrix.cases.length, operations, identities, images.images.length], [34, 71, 38, 14]);
  for (const ids of [matrix.cases.map(item => item.id), images.images.map(item => item.id), images.images.map(item => item.assemblyName)]) {
    assert.equal(new Set(ids).size, ids.length, 'Authored IDs and assembly names must be unique within their kind');
    assert.ok(ids.every(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)), 'IDs must be safe file labels');
  }
  capture.pin = pin;
  capture.dotnet = identity(options.dotnet);
  capture.caseIds = matrix.cases.map(item => item.id);
  capture.imageIds = images.images.map(item => item.id);
  capture.counts = { cases: matrix.cases.length, operations, identities, images: images.images.length };
  json(join(options.evidence, 'capture-inputs.json'), capture, 'wx');
  json(statusPath, capture);
  return { pin, matrix, images, files: sourceInputs.filter(path => path.endsWith('.cs')).map(path => join(staged, path)) };
}

function toolchain(pin) {
  assert.equal(run('sdk-version', ['--version']).trim(), pin.sdk, 'global.json must select the exact pinned SDK');
  const sdkLine = run('sdk-inventory', ['--list-sdks']).split(/\r?\n/).find(line => line.startsWith(pin.sdk + ' ['));
  const sdkRoot = sdkLine?.match(/\[(.*)\]$/)?.[1];
  assert.ok(sdkRoot, 'Pinned SDK installation must be observable');
  const compiler = join(sdkRoot, pin.sdk, 'Roslyn/bincore/csc.dll');
  const platform = process.platform + '-' + process.arch;
  assert.ok(pin.roslyn.platformHashes[platform], 'The compiler pin must explicitly cover this platform');
  assert.equal(digest(compiler), pin.roslyn.platformHashes[platform], 'csc.dll SHA-256 must match the exact platform pin');
  const runtimeLine = run('runtime-inventory', ['--list-runtimes']).split(/\r?\n/)
    .find(line => line.startsWith('Microsoft.NETCore.App ' + pin.runtime + ' ['));
  const runtimeRoot = runtimeLine?.match(/\[(.*)\]$/)?.[1];
  assert.ok(runtimeRoot, 'Pinned CoreCLR runtime must be installed');
  const runtime = join(runtimeRoot, pin.runtime);
  const referenceRoot = join(dirname(sdkRoot), 'packs/Microsoft.NETCore.App.Ref', pin.referencePack, 'ref', pin.targetFramework);
  const references = readdirSync(referenceRoot).filter(name => name.endsWith('.dll')).sort();
  const referenceHashes = references.map(name => ({ name, sha256: digest(join(referenceRoot, name)) }));
  assert.equal(referenceHashes.length, pin.referenceAssemblies.count);
  assert.equal(sha256(JSON.stringify(referenceHashes)), pin.referenceAssemblies.sha256, 'Exact reference-pack aggregate must match');
  const compilerPrefix = ['exec', '--runtimeconfig', runtimeConfig, compiler];
  assert.equal(run('compiler-version', [...compilerPrefix, '-version']).trim(), pin.roslyn.version);
  const coreNames = ['System.Private.CoreLib.dll', 'System.Reflection.Metadata.dll', 'System.Runtime.dll',
    process.platform === 'win32' ? 'coreclr.dll' : process.platform === 'darwin' ? 'libcoreclr.dylib' : 'libcoreclr.so'];
  capture.toolchain = { sdk: pin.sdk, runtime: pin.runtime, compiler: identity(compiler),
    compilerDependencies: ['Microsoft.CodeAnalysis.dll', 'Microsoft.CodeAnalysis.CSharp.dll']
      .map(name => identity(join(dirname(compiler), name))),
    runtimeFiles: coreNames.map(name => identity(join(runtime, name))), referencePack: pin.referencePack,
    referenceAssemblies: referenceHashes, runtimeConfig: identity(runtimeConfig) };
  json(statusPath, capture);
  return [...compilerPrefix, '-nologo', '-noconfig', '-nostdlib+', '-langversion:14.0', '-nullable:enable',
    '-deterministic+', '-optimize+', '-debug-', '-pathmap:' + workspace + '=/src/GenericClosure',
    ...references.map(name => '-r:' + join(referenceRoot, name))];
}

function observe(label, observer, arguments_, pin) {
  const stdout = run(label, ['exec', '--runtimeconfig', runtimeConfig, observer, ...arguments_]);
  const value = JSON.parse(stdout);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.runtime, pin.runtime);
  assert.equal(value.framework, '.NET ' + pin.runtime);
  assert.equal(value.architecture, process.arch === 'ia32' ? 'x86' : process.arch);
  return value.observations;
}

function verifyImages(prepared, source) {
  assert.deepEqual(prepared.images.map(item => item.id), source.images.map(item => item.id));
  assert.deepEqual(prepared.metadata.map(item => item.image), prepared.images.map(item => item.id));
  assert.equal(new Set(prepared.images.map(item => item.file)).size, prepared.images.length);
  for (let index = 0; index < prepared.images.length; index++) {
    const image = prepared.images[index];
    const authored = source.images[index];
    assert.equal(image.assemblyName, authored.assemblyName);
    assert.equal(image.file, image.assemblyName + '.dll');
    assert.equal(basename(image.file), image.file);
    assert.deepEqual(Object.keys(image.definitions), authored.definitions.map(item => item.id));
    assert.deepEqual(Object.values(image.definitions), authored.definitions.map((_, row) => 0x02000002 + row));
    assert.deepEqual(Object.keys(image.specifications), authored.specifications.map(item => item.id));
    const records = prepared.metadata[index].records;
    assert.equal(records.source, 'System.Reflection.Metadata');
    assert.equal(records.assembly.name, authored.assemblyName);
    assert.equal(records.typeDefinitions.length, authored.definitions.length + 1);
    assert.equal(records.genericParameters.length, authored.definitions.reduce((sum, item) => sum + item.arity, 0));
  }
}

function definition(source, images, key = 'definition') {
  return { kind: 'definition', image: source.image, context: source.context ?? 'default', token: images[source.image].definitions[source[key]] };
}

function argument(source, images) {
  if (source.kind === 'intrinsic') return { kind: source.kind, name: source.name };
  if (source.kind === 'parameter') return { kind: source.kind, image: source.image, context: source.context ?? 'default',
    ownerToken: images[source.image].definitions[source.owner], scope: source.scope, index: source.index };
  if (source.kind === 'definition') return definition(source, images);
  if (source.kind === 'szarray') return { kind: source.kind, element: argument(source.element, images) };
  if (source.kind === 'generic') return { kind: source.kind, definition: definition(source.definition, images),
    arguments: source.arguments.map(item => argument(item, images)) };
  throw new Error('Unknown authored argument kind: ' + source.kind);
}

function request(source, images) {
  const token = source.specification === undefined
    ? images[source.image].definitions[source.definition] : images[source.image].specifications[source.specification];
  assert.ok(Number.isInteger(token), 'Every request must resolve to an observed SRM token');
  const result = { op: source.op, image: source.image, context: source.context ?? 'default', token };
  if (source.op === 'instantiate') Object.assign(result, { definition: definition(source, images),
    arguments: source.arguments.map(item => argument(item, images)) });
  else assert.equal(source.op, 'resolve');
  return result;
}

function verifyOperations(actual, expected, images) {
  assert.deepEqual(actual.map(item => item.id), expected.map(item => item.id));
  for (let index = 0; index < actual.length; index++) {
    const item = actual[index];
    assert.deepEqual(item.request, request(expected[index], images), 'Observed request must retain the exact authored binding');
    assert.ok(Object.hasOwn(item, 'result') && Object.hasOwn(item, 'error'));
    assert.notEqual(item.result === null, item.error === null, 'Every native operation records a result or an actual native exception');
    if (item.error === null) {
      assert.ok(item.result && typeof item.result === 'object');
      assert.equal(item.stage, 'complete');
      assert.equal(item.nativeReturned, true);
      assert.equal(item.descriptionCompleted, true);
    } else {
      assert.equal(item.nativeReturned, false);
      assert.equal(item.descriptionCompleted, false);
      assert.ok(['resolveDefinition', 'resolveArguments', 'makeGenericType', 'resolveModule', 'resolveType'].includes(item.stage));
      assert.equal(typeof item.error.managedType, 'string');
      assert.equal(typeof item.error.message, 'string');
      assert.ok(Number.isInteger(item.error.hresult));
    }
  }
}

function verifyCase(actual, expected, images) {
  assert.deepEqual([actual.id, actual.group, actual.comparison], [expected.id, expected.group, expected.comparison]);
  const operations = [{ ...expected.request, id: 'primary' }, { ...expected.request, id: 'repeat' }, ...(expected.companions ?? [])];
  verifyOperations(actual.operations, operations, images);
  const identities = [{ id: 'primary-repeat', left: { operation: 'primary', selection: 'type' },
    right: { operation: 'repeat', selection: 'type' } }, ...(expected.identities ?? [])];
  assert.deepEqual(actual.identities.map(item => item.id), identities.map(item => item.id));
  const outcomes = Object.fromEntries(actual.operations.map(item => [item.id, item]));
  for (let index = 0; index < identities.length; index++) {
    const identity = actual.identities[index];
    for (const side of ['left', 'right']) {
      const endpoint = identity[side];
      assert.deepEqual(endpoint.request, identities[index][side]);
      assert.equal(endpoint.available, outcomes[endpoint.request.operation].error === null);
      assert.equal(endpoint.unavailableBecause, endpoint.available ? null : 'native-operation-exception');
      if (endpoint.available) assert.ok(endpoint.shape && typeof endpoint.shape === 'object');
      else assert.equal(endpoint.shape, null);
    }
    if (identity.left.available && identity.right.available) assert.equal(typeof identity.sameReference, 'boolean');
    else assert.equal(identity.sameReference, null, 'Unavailable endpoints cannot produce a ReferenceEquals result');
  }
}

function preserveInputs() {
  if (!existsSync(workspace)) return;
  capture.retainedFiles = pathsUnder(workspace).map(path => identity(path));
  json(join(options.evidence, 'retained-files.json'), capture.retainedFiles, 'wx');
}

try {
  const { pin, matrix, images: authoredImages, files } = prepare();
  const common = toolchain(pin);
  const observer = join(imagesDirectory, 'GenericClosureOracle.dll');
  run('compile-observer', [...common, '-target:exe', '-out:' + observer, ...files]);
  capture.observer = identity(observer);
  const prepared = observe('prepare-images', observer, ['prepare', imagesDirectory, stagedInterop], pin);
  verifyImages(prepared, authoredImages);
  capture.preparedImages = prepared.images.map(item => ({ id: item.id, file: item.file, ...identity(join(imagesDirectory, item.file)) }));
  json(statusPath, capture);
  const imageMap = Object.fromEntries(prepared.images.map(item => [item.id, item]));
  const cases = [];
  for (const item of matrix.cases) {
    const journal = join(progressDirectory, item.id + '.jsonl');
    const value = observe(item.id, observer, ['observe', imagesDirectory, stagedInterop, item.id, journal], pin);
    verifyCase(value, item, imageMap);
    cases.push(value);
  }
  assert.equal(capture.steps.length, 40, 'Four probes, one observer compile, one SRM prepare and 34 isolated cases must complete');
  assert.deepEqual(ownInventory(), [...ownedFiles].sort(), 'Observer source inventory changed during capture');
  assert.deepEqual(capture.sources, sourceRecords(sourceInputs), 'Live source changed during capture');
  assert.deepEqual(capture.sources, sourceRecords(sourceInputs, staged), 'Staged source changed during capture');
  assert.deepEqual(capture.productSources, productRecords(), 'Product source changed during capture');
  assert.deepEqual(capture.observer, identity(observer), 'Compiled observer changed during capture');
  for (const image of capture.preparedImages) {
    assert.deepEqual(identity(join(imagesDirectory, image.file)), { path: image.path, bytes: image.bytes, sha256: image.sha256 },
      'An observed image changed after metadata preparation: ' + image.id);
  }
  mkdirSync(dirname(options.output), { recursive: true });
  mkdirSync(options.output);
  const images = prepared.images.map(item => {
    const path = join(imagesDirectory, item.file);
    const target = join(options.output, item.file);
    copyFileSync(path, target, constants.COPYFILE_EXCL);
    assert.equal(digest(target), digest(path), 'Output fixture bytes must match the observed image');
    return { ...item, bytes: statSync(path).size, sha256: digest(path) };
  });
  const result = { schemaVersion: 1, sdk: pin.sdk, runtime: pin.runtime, platform: process.platform, architecture: process.arch,
    sources: capture.sources, productSources: capture.productSources, toolchain: capture.toolchain,
    captureInputsSha256: digest(join(options.evidence, 'capture-inputs.json')), counts: capture.counts, images,
    metadata: prepared.metadata, cases, observer: capture.observer, runtimeConfig: identity(runtimeConfig) };
  const resultPath = join(options.output, 'native-closure.json');
  json(resultPath, result, 'wx');
  capture.result = identity(resultPath);
  capture.status = 'completed';
} catch (error) {
  capture.status = 'failed';
  capture.error = { name: error.name, message: error.message, stack: error.stack };
  throw error;
} finally {
  capture.finishedUtc = new Date().toISOString();
  let retentionError;
  try { preserveInputs(); }
  catch (error) {
    retentionError = error;
    capture.status = 'failed';
    capture.retentionError = { name: error.name, message: error.message };
  }
  json(statusPath, capture);
  if (retentionError) throw retentionError;
}

console.log(JSON.stringify({ status: capture.status, output: options.output, evidence: options.evidence, counts: capture.counts }, null, 2));
