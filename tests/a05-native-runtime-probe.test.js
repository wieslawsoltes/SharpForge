import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {firstChancePolicy, probeNativeRuntime} from '../scripts/a05/native-runtime-probe.js';
import {nativeQualificationPlan} from '../scripts/a05/native-plan.js';

test('first-chance policy is an explicit target contract with independent authored traces', async () => {
  assert.equal(firstChancePolicy(), 'before-unwind');
  for (const value of ['before-unwind', 'after-unwind']) assert.equal(firstChancePolicy(value), value);
  for (const value of ['', 'auto', 'native', null]) assert.throws(() => firstChancePolicy(value), /policy/);
  for (const framework of ['net8.0', 'net10.0']) {
    const item = nativeQualificationPlan({output: 'artifacts', framework}).find(item => item.id === 'first-chance-policy');
    const after = framework === 'net10.0';
    assert.equal(item.args[item.args.indexOf('--first-chance-policy') + 1], after ? 'after-unwind' : 'before-unwind');
    assert.equal(item.args[item.args.indexOf('--expected') + 1],
      'tests/fixtures/a05/first-chance-policy/' + (after ? 'expected-after-unwind.txt' : 'expected.txt'));
  }
  const fixture = new URL('./fixtures/a05/first-chance-policy/', import.meta.url);
  const original = await readFile(new URL('expected.txt', fixture), 'utf8');
  assert.equal(original, 'first:original\nfirst:subscriber\nsecond:subscriber\n');
  assert.equal(await readFile(new URL('expected-after-unwind.txt', fixture), 'utf8'), original + 'cleanup\n');
});

async function fixture(action) {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-native-probe-'));
  const artifact = join(directory, 'evidence');
  const output = join(directory, 'bin', 'Release', 'net10.0');
  const assemblyPath = join(output, 'Qualification.dll');
  const configuration = JSON.stringify({runtimeOptions: {tfm: 'net10.0', framework: {name: 'Microsoft.NETCore.App', version: '10.0.0'}}});
  await mkdir(artifact);
  await mkdir(output, {recursive: true});
  await writeFile(join(output, 'Qualification.runtimeconfig.json'), configuration);
  try { await action({directory, artifact, assemblyPath, configuration}); }
  finally { await rm(directory, {recursive: true, force: true}); }
}

const fakeExecute = (directory, calls, output) => (command, args, options) => {
  calls.push({command, args, options});
  if (args[0] === 'build') {
    const bin = join(directory, 'runtime-probe', 'bin', 'Release', 'net10.0');
    mkdirSync(bin, {recursive: true});
    writeFileSync(join(bin, 'RuntimeProbe.dll'), 'test probe assembly');
  }
  return {exitCode: 0, signal: null, output: args[0] === 'exec' ? output : '', stderr: ''};
};

test('runtime probe binds the native identity to the exact fixture runtimeconfig and same host invocation', async () => {
  await fixture(async options => {
    const calls = [];
    const report = await probeNativeRuntime({...options, framework: 'net10.0', dotnet: '/selected/dotnet',
      execute: fakeExecute(options.directory, calls, '.NET 10.0.12\n10.0.12\nlinux-x64\n')});
    assert.equal(report.environmentVersion, '10.0.12', 'The selected patch comes from the native process, not SDK or installed inventory');
    assert.equal(report.runtimeConfig.content, options.configuration);
    assert.equal(report.runtimeConfig.sha256, createHash('sha256').update(options.configuration).digest('hex'));
    assert.equal(report.probe.assemblySha256, createHash('sha256').update('test probe assembly').digest('hex'));
    assert(calls.every(call => call.command === '/selected/dotnet'));
    const execution = calls.find(call => call.args[0] === 'exec');
    assert.equal(execution.options.cwd, options.directory);
    assert.equal(execution.args[1], '--runtimeconfig');
    assert.equal(execution.args[2], join(options.directory, 'bin', 'Release', 'net10.0', 'Qualification.runtimeconfig.json'));
    assert.equal(report.command.arguments[2], join('<temporary-project>', 'bin', 'Release', 'net10.0', 'Qualification.runtimeconfig.json'));
    assert.match(await readFile(join(options.artifact, 'RuntimeProbe.cs'), 'utf8'), /Environment.Version/);
    assert.equal(await readFile(join(options.artifact, 'RuntimeProbe.dll'), 'utf8'), 'test probe assembly');
  });
});

test('runtime provenance cannot pass with an unexpected runtime major or malformed probe identity', async () => {
  for (const output of ['.NET 8.0.31\n8.0.31\nlinux-x64\n', '10.0.12\n', '.NET 10.0.12\ninvalid\nlinux-x64\n']) {
    await fixture(async options => {
      await assert.rejects(probeNativeRuntime({...options, framework: 'net10.0', dotnet: 'dotnet',
        execute: fakeExecute(options.directory, [], output)}));
    });
  }
});

test('optional native ABI observation reports actual pointer size and process architecture', async () => {
  for (const [size, architecture] of [[4, 'X86'], [8, 'X64'], [8, 'Arm64']]) {
    await fixture(async options => {
      const report = await probeNativeRuntime({...options, framework: 'net10.0', dotnet: 'dotnet', includePointerWidth: true,
        execute: fakeExecute(options.directory, [], `.NET 10.0.12\n10.0.12\nlinux-x64\n${size}\n${architecture}\n`)});
      assert.equal(report.nativeIntBits, size * 8);
      assert.equal(report.processArchitecture, architecture);
      assert.match(await readFile(join(options.artifact, 'RuntimeProbe.cs'), 'utf8'), /IntPtr.Size/);
    });
  }
  for (const tail of ['\n', '16\nX64\n', '8\n\n']) {
    await fixture(async options => {
      await assert.rejects(probeNativeRuntime({...options, framework: 'net10.0', dotnet: 'dotnet', includePointerWidth: true,
        execute: fakeExecute(options.directory, [], '.NET 10.0.12\n10.0.12\nlinux-x64\n' + tail)}));
    });
  }
});
