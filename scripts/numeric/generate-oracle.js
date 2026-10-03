/** Native oracle generation is an explicit full-scope validation step, never an import side effect. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {numericPairCount, numericSeed, int64Operations, int64OracleSource, uint32OracleSource, smallStorageOracleSource, numericFamilies}
  from '../../tests/support/numeric-oracle-spec.js';
import {conversionMatrixCases} from '../../tests/support/numeric-conversion-matrix.js';
import {smallStorageTypes, smallStorageLocations, smallStorageFixture}
  from '../../tests/support/numeric-storage-fixtures.js';

const execute = promisify(execFile);
const dotnet = process.env.DOTNET_PATH ?? 'dotnet';
const output = resolve(process.argv[2] ?? 'tests/fixtures/a05/numeric-oracle');
const temporary = await mkdtemp(join(tmpdir(), 'sharpforge-numeric-oracle-'));
const options = {encoding: 'utf8', timeout: 600000, maxBuffer: 256 * 1024 * 1024,
  env: {...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1'}};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const normalize = text => text.replaceAll('\r\n', '\n');
const files = {};

async function save(name, contents, extra = {}) {
  const bytes = name.endsWith('.gz') ? gzipSync(contents, {level: 9}) : Buffer.from(contents);
  await writeFile(join(output, name), bytes);
  files[name] = {sha256: digest(bytes), bytes: bytes.length, ...extra};
}

async function build(source, languageVersion = '9.0') {
  const project = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType>' +
    '<TargetFramework>net10.0</TargetFramework><LangVersion>' + languageVersion + '</LangVersion>' +
    '<NuGetAudit>false</NuGetAudit><Optimize>false</Optimize><CheckForOverflowUnderflow>false</CheckForOverflowUnderflow>' +
    '</PropertyGroup></Project>';
  await writeFile(join(temporary, 'Oracle.csproj'), project);
  await writeFile(join(temporary, 'Program.cs'), source);
  await execute(dotnet, ['build', join(temporary, 'Oracle.csproj'), '-c', 'Release', '--nologo',
    '-p:RestoreIgnoreFailedSources=true'], options);
  return join(temporary, 'bin', 'Release', 'net10.0', 'Oracle.dll');
}

async function executeSource(source, languageVersion) {
  const assembly = await build(source, languageVersion);
  return normalize((await execute(dotnet, [assembly], options)).stdout);
}

try {
  await mkdir(output, {recursive: true});
  const sdk = (await execute(dotnet, ['--version'], options)).stdout.trim();
  if (!sdk.startsWith('10.')) throw new Error('Native numeric fixtures pin the .NET 10 SDK');
  const runtime = (await execute(dotnet, ['--info'], options)).stdout;
  const widthSource = 'using System;class Program{static void Main(){Console.WriteLine(IntPtr.Size);}}';
  const nativeIntBits = Number((await executeSource(widthSource)).trim()) * 8;
  const wideSource = 'using System;\n' + int64OracleSource();
  await save('int64.cs', wideSource);
  await save('int64.txt.gz', await executeSource(wideSource), {
    pairs: numericPairCount, operationsPerPair: int64Operations.length, seed: String(numericSeed), languageVersion: '9.0',
  });
  await save('uint32-matrix.cs', 'using System;\n' + uint32OracleSource());
  await save('uint32-matrix.txt', await executeSource('using System;\n' + uint32OracleSource()), {pairs: 25});
  for (const family of numericFamilies) {
    const source = 'using System;class Program{static void Main(){' + family.source + '}}';
    await save(family.name + '.cs', source);
    await save(family.name + '.txt', await executeSource(source, family.languageVersion),
      {languageVersion: family.languageVersion ?? '9.0'});
  }
  await save('small-storage.cs', 'using System;\n' + smallStorageOracleSource());
  await save('small-storage.txt', await executeSource('using System;\n' + smallStorageOracleSource()));
  const conversions = conversionMatrixCases(nativeIntBits);
  await writeFile(join(temporary, 'conversions.json'), JSON.stringify(conversions));
  const conversionSource = await readFile(new URL('./ConversionOracle.cs', import.meta.url), 'utf8');
  const conversionAssembly = await build(conversionSource, '11.0');
  const conversionOutput = normalize((await execute(dotnet, [conversionAssembly, join(temporary, 'conversions.json')], options)).stdout);
  await save('conversions.json', JSON.stringify(conversions, null, 2) + '\n');
  await save('conversions.txt.gz', conversionOutput, {cases: conversions.length, sourceSha256: digest(conversionSource)});
  const runtimeConfig = await readFile(join(temporary, 'bin', 'Release', 'net10.0', 'Oracle.runtimeconfig.json'));
  const runner = 'using System;using System.Reflection;class Program{static void Main(string[] args){' +
          'var method=Assembly.LoadFile(args[0]).GetType("Program").GetMethod("Main");' +
          'var values=new object[method.GetParameters().Length];for(int i=0;i<values.Length;i++)' +
          'values[i]=Activator.CreateInstance(method.GetParameters()[i].ParameterType);Console.WriteLine(method.Invoke(null,values));}}';
  const runnerAssembly = await build(runner);
  const storage = [];
  for (const {type, suffix, minimum, maximum} of smallStorageTypes) {
    for (const input of [minimum, maximum, minimum - 1, maximum + 1, -1, 0x12345]) {
      for (const location of smallStorageLocations) {
        const bytes = smallStorageFixture(type, suffix, location, input);
        const path = join(temporary, 'Storage.dll');
        await writeFile(path, bytes);
        await writeFile(join(temporary, 'Storage.runtimeconfig.json'), runtimeConfig);
        // These authored methods return int and argument methods have a nonstandard Main signature.
        // Invoke through Reflection so the same bytes, arguments and return values are observed.
        const result = normalize((await execute(dotnet, [runnerAssembly, path], options)).stdout).trim();
        storage.push({type, suffix, location, input, expected: Number(result), assemblySha256: digest(bytes)});
      }
    }
  }
  await save('storage.json', JSON.stringify(storage, null, 2) + '\n');
  const commit = (await execute('git', ['rev-parse', 'HEAD'], {cwd: fileURLToPath(new URL('../..', import.meta.url))})).stdout.trim();
  const provenance = {format: 'SharpForge.NativeNumericOracle/1', sdk, runtime, node: process.version,
    platform: process.platform, architecture: process.arch, nativeIntBits, globalization: 'invariant', commit,
    conversionTargetEncodings: 13, concreteTargetsAcrossAbis: 15,
    unqualifiedNativeWidths: [32, 64].filter(bits => bits !== nativeIntBits), files};
  await writeFile(join(output, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  console.log(JSON.stringify(provenance, null, 2));
} finally {
  await rm(temporary, {recursive: true, force: true});
}
