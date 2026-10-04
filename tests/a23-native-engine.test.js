import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { BuildScheduler, parseWorkloadList, explainTargetAvailability } from '@sharpforge/msbuild/node';
import { shutdownBuildServers } from '../packages/msbuild/src/build-server.js';

test('queued user builds precede superseding design-time requests', async () => {
  const scheduler = new BuildScheduler(), order = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = scheduler.enqueue({ project: 'A' }, async () => { await gate; order.push('first'); return { status: 'succeeded' }; });
  await Promise.resolve();
  const old = scheduler.enqueue({ project: 'A' }, async () => { order.push('old'); }, { coalesceKey: 'A', priority: 0 });
  const latest = scheduler.enqueue({ project: 'A' }, async () => { order.push('latest'); return { status: 'succeeded' }; }, { coalesceKey: 'A', priority: 0 });
  const user = scheduler.enqueue({ project: 'B' }, async () => { order.push('user'); return { status: 'succeeded' }; }, { priority: 10 });
  release();
  await Promise.all([first, latest, user].map(id => scheduler.wait(id)));
  assert.deepEqual(order, ['first', 'user', 'latest']);
  assert.equal(scheduler.get(old).cancelReason, 'superseded');
  await scheduler.close();
});

test('workload preflight identifies missing Android and host-specific Windows target restrictions', () => {
  const workloads = parseWorkloadList('Installed Workload Id    Manifest Version    Installation Source\n---------------------\nandroid                   35.0.7/10.0.100     SDK 10.0.100\n');
  assert.equal(workloads[0].id, 'android');
  assert.equal(explainTargetAvailability('net10.0-android', { workloads: [], sdkVersion: '10.0.401' }).code, 'NETSDK1147');
  assert.equal(explainTargetAvailability('net10.0-windows', { platform: 'linux', sdkVersion: '10.0.401' }).code, 'NETSDK1100');
});

test('build server shutdown invokes the SDK command and reports an unsuccessful shutdown explicitly', async () => {
  for (const exitCode of [0, 3]) {
    const promise = shutdownBuildServers({ executable: 'selected-dotnet', cwd: process.cwd(),
      spawnProcess(executable, args, options) {
        assert.equal(executable, 'selected-dotnet');
        assert.deepEqual(args, ['build-server', 'shutdown']);
        return spawn(process.execPath, ['-e', 'process.stderr.write("shutdown fixture");process.exit(' + exitCode + ')'], options);
      } });
    if (exitCode) await assert.rejects(promise, { code: 'SFMSB_SERVER_SHUTDOWN' });
    else assert.equal((await promise).exitCode, 0);
  }
});
