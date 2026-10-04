import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exceptionFixture } from '../../../tests/support/exception-encoding.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const destination = resolve(process.argv[2] ?? join(root, 'tests/fixtures/eh-encoding'));
const dotnet = process.env.DOTNET_PATH ?? 'dotnet';
const scratch = mkdtempSync(join(tmpdir(), 'sharpforge-eh-'));
const definitions = [
  ['FilterFat', { kind: 'filter', exceptionFormat: 'fat' }],
  ['FilterSmall', { kind: 'filter', exceptionFormat: 'small' }],
  ['FilterAuto', { kind: 'filter', exceptionFormat: 'auto' }],
  ['FaultFat', { kind: 'fault', exceptionFormat: 'fat' }],
  ['FaultSmall', { kind: 'fault', exceptionFormat: 'small' }],
  ['FaultChained', { kind: 'fault', exceptionFormat: 'small', nativeChained: true }],
];
const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' };
const run = args => execFileSync(dotnet, args, { cwd: scratch, env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
try {
  cpSync(join(destination, 'oracle'), join(scratch, 'oracle'), { recursive: true });
  mkdirSync(join(scratch, 'inputs'));
  for (const [id, options] of definitions) {
    writeFileSync(join(scratch, 'inputs', id + '.dll'), exceptionFixture({ ...options, name: id }).assembly);
  }
  run(['build', join(scratch, 'oracle/ExceptionOracle.csproj'), '-c', 'Release', '-o', join(scratch, 'output'),
    '-m:1', '--disable-build-servers', '-p:UseSharedCompilation=false', '--nologo']);
  const result = JSON.parse(run([join(scratch, 'output/ExceptionOracle.dll'), join(scratch, 'inputs')]));
  result.sdk = run(['--version']).trim();
  result.sourceSha256 = Object.fromEntries(['ExceptionOracle.csproj', 'Program.cs', 'NuGet.Config'].map(name =>
    [name, createHash('sha256').update(readFileSync(join(destination, 'oracle', name))).digest('hex')]));
  for (const item of result.cases) item.options = { ...definitions.find(([id]) => id === item.id)[1], name: item.id };
  writeFileSync(join(destination, 'native.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ sdk: result.sdk, runtime: result.runtime, cases: result.cases.length }));
  const failed = result.cases.filter(item => item.options.nativeChained
    ? item.error !== 'System.NullReferenceException' || item.result !== null || item.regions.length !== 1
    : item.error || item.result !== (item.options.kind === 'filter' ? 42 : 7));
  if (failed.length) throw new Error(JSON.stringify(failed));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
