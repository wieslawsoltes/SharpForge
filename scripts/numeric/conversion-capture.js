import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {probeNativeRuntime} from '../a05/native-runtime-probe.js';
import {conversionMatrixCases} from '../../tests/support/numeric-conversion-matrix.js';
import {conversionDigest, verifyConversionCapture} from './conversion-proof.js';

export const conversionRepository = fileURLToPath(new URL('../../', import.meta.url));
const framework = 'net10.0';
const project = `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType>
<TargetFramework>net10.0</TargetFramework><LangVersion>11.0</LangVersion><NuGetAudit>false</NuGetAudit>
<Optimize>false</Optimize><CheckForOverflowUnderflow>false</CheckForOverflowUnderflow>
</PropertyGroup></Project>\n`;

/** Record tracked tree identity and the exact workflow-created SDK selector, never ignore other dirt. */
export function conversionSourceIdentity(sdk) {
  const git = args => {
    const result = spawnSync('git', args, {cwd: conversionRepository, encoding: 'utf8', timeout: 10000});
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  assert(['', '?? global.json'].includes(status), 'Qualification requires unchanged product sources');
  let sdkSelector = null;
  if (status) {
    const bytes = readFileSync(join(conversionRepository, 'global.json'));
    assert.deepEqual(JSON.parse(bytes), {sdk: {version: sdk, rollForward: 'disable'}});
    sdkSelector = {path: 'global.json', sha256: conversionDigest(bytes), content: bytes.toString('utf8')};
  }
  return {revision: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']), status, sdkSelector};
}

function recorder(directory, journal) {
  return (executable, args, options = {}) => {
    const index = journal.commands.length;
    const command = {executable, args, cwd: options.cwd ?? directory, startedAt: new Date().toISOString()};
    journal.commands.push(command);
    writeFileSync(join(directory, 'journal.json'), JSON.stringify(journal, null, 2) + '\n');
    const result = spawnSync(executable, args, {cwd: command.cwd, encoding: 'utf8', timeout: 600000,
      maxBuffer: 16 * 1024 * 1024, env: {...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1',
        DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1'}});
    const stdout = result.stdout ?? '', stderr = result.stderr ?? '';
    writeFileSync(join(directory, `command-${index}.stdout.txt`), stdout);
    writeFileSync(join(directory, `command-${index}.stderr.txt`), stderr);
    Object.assign(command, {completedAt: new Date().toISOString(), exitCode: result.status, signal: result.signal,
      error: result.error?.message, stdoutSha256: conversionDigest(stdout), stderrSha256: conversionDigest(stderr)});
    writeFileSync(join(directory, 'journal.json'), JSON.stringify(journal, null, 2) + '\n');
    assert.equal(result.status, 0, `Native command ${index} failed: ${result.error?.message ?? stderr}`);
    assert.equal(result.signal, null);
    return {exitCode: result.status, signal: result.signal, output: stdout.replaceAll('\r\n', '\n'), stderr};
  };
}

/** Capture only the existing conversion matrix, preserving actual IL, native stdout and runtime identity. */
export async function captureConversions(options, journal) {
  const directory = options.output;
  const execute = recorder(directory, journal);
  const sdk = execute(options.dotnet, ['--version']).output.trim();
  assert.equal(sdk, options.sdk, 'The exact requested SDK must compile the conversion oracle');
  assert.match(sdk, /^10\./);
  execute(options.dotnet, ['--info']);
  writeFileSync(join(directory, 'global.json'), JSON.stringify({sdk: {version: sdk, rollForward: 'disable'}}) + '\n');
  writeFileSync(join(directory, 'NuGet.Config'), '<configuration><packageSources><clear /></packageSources></configuration>\n');
  const source = readFileSync(new URL('./ConversionOracle.cs', import.meta.url));
  writeFileSync(join(directory, 'ConversionOracle.cs'), source);
  writeFileSync(join(directory, 'Qualification.csproj'), project);
  execute(options.dotnet, ['build', 'Qualification.csproj', '-c', 'Release', '--nologo',
    '-p:RestoreIgnoreFailedSources=true']);
  const assemblyPath = join(directory, 'bin', 'Release', framework, 'Qualification.dll');
  const nativeRuntime = await probeNativeRuntime({directory, assemblyPath, artifact: directory, framework,
    dotnet: options.dotnet, execute, includePointerWidth: true});
  assert.equal(nativeRuntime.nativeIntBits, options.bits, 'Actual CLR width must be checked before generating operands');
  const cases = conversionMatrixCases(nativeRuntime.nativeIntBits);
  const serialized = JSON.stringify(cases, null, 2) + '\n';
  writeFileSync(join(directory, 'conversions.json'), serialized);
  const native = execute(options.dotnet, [assemblyPath, join(directory, 'conversions.json')]);
  writeFileSync(join(directory, 'conversions.txt'), native.output);
  const compressed = gzipSync(native.output, {level: 9});
  writeFileSync(join(directory, 'conversions.txt.gz'), compressed);
  const capture = {sdk, nativeRuntime, native, cases, output: native.output};
  const inventory = verifyConversionCapture(capture, options);
  const files = {};
  for (const name of ['ConversionOracle.cs', 'conversions.json', 'conversions.txt.gz']) {
    const bytes = readFileSync(join(directory, name));
    files[name] = {bytes: bytes.length, sha256: conversionDigest(bytes)};
  }
  const provenance = {format: 'SharpForge.NativeNumericOracle/1', scope: 'conversion-only', sdk,
    nativeIntBits: options.bits, nativeRuntime, conversionTargetEncodings: 13, concreteTargetsAcrossAbis: 15,
    unqualifiedNativeWidths: [32, 64].filter(bits => bits !== options.bits), files,
    sourceRevision: journal.sourceBefore.revision, conversionAssemblySha256: conversionDigest(readFileSync(assemblyPath))};
  writeFileSync(join(directory, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  return {capture, inventory};
}

export function saveConversionChunk(directory, row, artifacts) {
  const target = join(directory, 'replay');
  mkdirSync(target, {recursive: true});
  const stem = join(target, String(row.offset).padStart(4, '0'));
  writeFileSync(stem + '.cs', artifacts.source);
  if (artifacts.assembly) writeFileSync(stem + '.dll', artifacts.assembly);
  writeFileSync(stem + '.txt', artifacts.expected);
  writeFileSync(stem + '.json', JSON.stringify(row, null, 2) + '\n');
}

export function parseConversionOptions(args) {
  const options = {bits: 32, sdk: '10.0.201', dotnet: process.env.DOTNET_PATH ?? 'dotnet', finalize: false};
  while (args.length) {
    const key = args.shift();
    if (key === '--finalize') { options.finalize = true; continue; }
    assert(['--output', '--dotnet', '--sdk', '--native-bits'].includes(key), 'Unknown option: ' + key);
    const value = args.shift();
    assert(value && !value.startsWith('--'), 'Missing option value: ' + key);
    options[key === '--native-bits' ? 'bits' : key.slice(2)] = key === '--native-bits' ? Number(value) : value;
  }
  assert(options.output, '--output is required');
  assert([32, 64].includes(options.bits));
  assert.match(options.sdk, /^10\.\d+\.\d+$/);
  options.output = resolve(options.output);
  return options;
}
