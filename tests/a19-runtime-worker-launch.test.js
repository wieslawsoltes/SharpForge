import test from 'node:test';
import assert from 'node:assert/strict';
import { LaunchProfiles } from '../apps/studio/workbench/launch-profiles.js';
import { compileProgram } from './a19-runtime-programs.js';
import { connectRuntimeWorker } from './a19-runtime-worker-client.js';

const source = `using System;
class Program {
  static void Main(string[] args) {
    Console.WriteLine(args[0]);
    Console.WriteLine(Environment.GetEnvironmentVariable("VALUE") ?? "missing");
  }
}`;
async function state(worker, launch, value) {
  const event = await worker.wait(event => event.event === 'state' && event.sessionId === launch.sessionId &&
    (event.state === value || event.state === 'faulted'));
  assert.equal(event.state, value, JSON.stringify(event.fault ?? event.reason));
  return event;
}

for (const managedIL of [false, true]) {
  const engine = managedIL ? 'direct CIL' : 'source';

  test('real ' + engine + ' worker consumes a complete launch profile', async test => {
    const compiled = compileProgram(source, { includeDebug: true });
    const profiles = new LaunchProfiles();
    profiles.set('App', { arguments: ['profile 雪😀'], environment: { VALUE: 'application value' } });
    const worker = connectRuntimeWorker(test);
    await worker.ready();
    const launch = await worker.request('launch', {
      assembly: compiled.assembly, managedIL, debug: false, ...profiles.launchOptions('App')
    });
    assert.deepEqual(launch.capabilities, { arguments: true, environment: true, environmentMutation: false });
    assert.equal((await state(worker, launch, 'terminated')).output, 'profile 雪😀\napplication value\n');
    profiles.dispose();
  });

  test('real ' + engine + ' workers isolate argv, environment and stop commands despite equal local serials', async test => {
    const compiled = compileProgram(source, { includeDebug: true });
    const first = connectRuntimeWorker(test);
    const second = connectRuntimeWorker(test);
    await Promise.all([first.ready(), second.ready()]);
    const launchOptions = value => ({
      assembly: compiled.assembly, managedIL, debug: true, stopOnEntry: true,
      programArguments: [value], environment: { VALUE: value + ' environment' }
    });
    const alpha = await first.request('launch', launchOptions('alpha'));
    const beta = await second.request('launch', launchOptions('beta'));
    await Promise.all([state(first, alpha, 'paused'), state(second, beta, 'paused')]);
    assert.equal(alpha.sessionId, 1);
    assert.equal(beta.sessionId, 1);
    await first.request('stop', { sessionId: alpha.sessionId });
    assert.equal((await first.request('state', { sessionId: alpha.sessionId })).state, 'terminated');
    assert.equal((await second.request('state', { sessionId: beta.sessionId })).state, 'paused');
    await second.request('resume', { sessionId: beta.sessionId, mode: 'continue' });
    assert.equal((await state(second, beta, 'terminated')).output, 'beta\nbeta environment\n');
  });

  test('real ' + engine + ' worker rejects malformed replacement settings without retiring its paused session', async test => {
    const compiled = compileProgram(source, { includeDebug: true });
    const worker = connectRuntimeWorker(test);
    await worker.ready();
    const options = {
      assembly: compiled.assembly, managedIL, debug: true, stopOnEntry: true,
      programArguments: ['preserved'], environment: { VALUE: 'preserved environment' }
    };
    const launch = await worker.request('launch', options);
    await state(worker, launch, 'paused');
    for (const [changes, code] of [
      [{ programArguments: [1] }, 'PROGRAM_ARGUMENTS'],
      [{ programArguments: ['a\0b'] }, 'PROGRAM_ARGUMENTS'],
      [{ environment: { BAD: 'a\0b' } }, 'LAUNCH_ENVIRONMENT'],
      [{ environment: { BAD: 'x'.repeat(65_537) } }, 'LAUNCH_ENVIRONMENT']
    ]) {
      await assert.rejects(worker.request('launch', { ...options, ...changes }), { code });
      assert.equal((await worker.request('state', { sessionId: launch.sessionId })).state, 'paused');
    }
    await worker.request('resume', { sessionId: launch.sessionId, mode: 'continue' });
    assert.equal((await state(worker, launch, 'terminated')).output, 'preserved\npreserved environment\n');
  });
}
