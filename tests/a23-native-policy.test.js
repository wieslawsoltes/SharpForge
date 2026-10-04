import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuildEnvironment } from '../packages/msbuild/src/environment.js';
import { normalizeBuildRequest } from '../packages/msbuild/src/contract.js';
import { validateResponseFiles, splitCommandLine } from '../packages/msbuild/src/argument-policy.js';
import { WorkspaceTrustStore } from '../packages/msbuild/src/trust.js';
import { runNativeProcess } from '../packages/msbuild/src/process.js';

const request = extra => ({ project: 'App/App.csproj', trusted: true, ...extra });
test('native environment retains tool discovery but excludes host secrets and startup hooks', () => {
  const environment = createBuildEnvironment({ PATH: '/sdk', HOME: '/home/test', AWS_SECRET_ACCESS_KEY: 'secret',
    GITHUB_TOKEN: 'token', DOTNET_STARTUP_HOOKS: '/untrusted/hook.dll', MSBuildSDKsPath: '/untrusted/sdk' });
  assert.equal(environment.PATH, '/sdk');
  assert.equal(environment.HOME, '/home/test');
  for (const key of ['AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN', 'DOTNET_STARTUP_HOOKS', 'MSBuildSDKsPath']) assert.equal(environment[key], undefined);
  assert.throws(() => createBuildEnvironment({}, { DOTNET_STARTUP_HOOKS: 'anything' }), /not allowed/);
  assert.equal(createBuildEnvironment({}, { VSTEST_HOST_DEBUG: '1' }).VSTEST_HOST_DEBUG, '1');
});
for (const properties of [{ OutputPath: '../../x' }, { PublishDir: '/tmp/output' }, { BaseIntermediateOutputPath: 'C:\\temp' },
  { ArtifactsPath: '$(OtherPath)' }, { OutputPath: '%2e%2e/x' }]) {
  test('native output boundary rejects ' + JSON.stringify(properties), () => assert.throws(() => normalizeBuildRequest(request({ properties }))));
}
test('logger/response switch policy is explicit and rejects nested traversal', async () => {
  assert.throws(() => normalizeBuildRequest(request({ arguments: ['-logger:evil.dll'] })), /elevated/);
  assert.equal(normalizeBuildRequest(request({ elevated: true, arguments: ['-logger:approved.dll'] })).elevated, true);
  const files = new Map([['first.rsp', '@second.rsp'], ['second.rsp', '-p:OutputPath=../escape']]);
  await assert.rejects(() => validateResponseFiles(['@first.rsp'], path => files.get(path)), /escapes/);
  files.set('second.rsp', '@first.rsp');
  await assert.rejects(() => validateResponseFiles(['@first.rsp'], path => files.get(path)), /cycle/);
  await assert.rejects(() => validateResponseFiles(['@../../outside.rsp'], () => ''), /inside/);
  assert.deepEqual(splitCommandLine('/reference:"path with spaces/a.dll" /define:A;B'), ['/reference:path with spaces/a.dll', '/define:A;B']);
});
test('trust is stored per canonical root and revocation survives reopening the store', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sf-trust-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new WorkspaceTrustStore(join(root, 'trust.json'));
  assert.equal(await store.get(root), null);
  await store.grant(root, { elevated: true });
  assert.equal((await new WorkspaceTrustStore(store.path).get(root)).elevated, true);
  await store.revoke(root);
  assert.equal(await store.get(root), null);
});
test('native tool transport scrubs actual child environment and captures unicode lines', async () => {
  const lines = [];
  const result = await runNativeProcess({ executable: process.execPath,
    arguments: ['-e', 'process.stdout.write(JSON.stringify({secret:process.env.SF_SECRET,unicode:"😀 café"})+"\\n")'],
    timeoutMs: 5000, maxOutputBytes: 8192 }, { sourceEnvironment: { ...process.env, SF_SECRET: 'must-not-leak' },
    onLine: line => lines.push(line) });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), { unicode: '😀 café' });
  assert.equal(lines.length, 1);
});
test('native process timeout is distinct from successful completion', async () => {
  const result = await runNativeProcess({ executable: process.execPath, arguments: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 100, maxOutputBytes: 1024 });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
});

test('cancellation terminates children and grandchildren in the actual process tree', { timeout: 15000 }, async () => {
  const controller = new AbortController(), descendants = [];
  const grandchildSource = 'setInterval(()=>{},1000)';
  const childSource = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(grandchildSource)}],{stdio:'ignore'});console.log(process.pid+','+child.pid);setInterval(()=>{},1000);`;
  const parentSource = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(childSource)}],{stdio:['ignore','pipe','ignore']});child.stdout.pipe(process.stdout);setInterval(()=>{},1000);`;
  const result = await runNativeProcess({ executable: process.execPath, arguments: ['-e', parentSource], timeoutMs: 10000, maxOutputBytes: 8192 }, {
    signal: controller.signal, onLine: ({ text }) => {
      descendants.push(...text.split(',').map(Number));
      controller.abort();
    }
  });
  assert.equal(result.cancelled, true);
  assert.equal(descendants.length, 2);
  await new Promise(resolve => setTimeout(resolve, 100));
  for (const pid of descendants) {
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
    if (alive && process.platform === 'linux') {
      try { alive = !/\) Z /.test(await readFile('/proc/' + pid + '/stat', 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; alive = false; }
    }
    assert.equal(alive, false, 'Descendant remained running: ' + pid);
  }
});
