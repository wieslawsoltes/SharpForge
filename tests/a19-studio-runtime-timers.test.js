import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileProgram } from './a19-runtime-programs.js';
import { runtimeTimerWorkbench, waitForEvent, waitForRuntimeState } from './support/studio-runtime-timers.js';

const consoleSource = 'using System;\nclass Program {\n static void Main() {\n  int value = 41;\n  Console.WriteLine(value + 1);\n }\n}\n';
const windowSource = await readFile(new URL('./fixtures/a19/multi-session/WindowProgram.cs', import.meta.url), 'utf8');

function completedCapture(fixture, session) {
  return waitForEvent(fixture.timeline, () => {
    const history = fixture.timeline.histories.get(session.identity);
    return history?.executionActive === false && history.cpuSamples.length ? history : null;
  }, 'completed execution capture');
}

for (const managedIL of [false, true]) {
  const engine = managedIL ? 'direct CIL' : 'source VM';

  test(`Studio ${engine} launch delivers UI reset, breakpoint, step and capture with browser timer receivers`, async context => {
    const compiled = compileProgram(consoleSource, { includeDebug: true });
    const fixture = runtimeTimerWorkbench(context);
    const { services, state, capture, errors, events } = fixture;
    const session = services.sessions.create({ projectId: 'Console' });
    const uri = compiled.image.sources[0].uri;
    const result = await session.launch({ assembly: compiled.assembly, managedIL, debug: true, stopOnEntry: false,
      breakpoints: { [uri]: [{ line: 5, enabled: true }] } });
    const paused = await waitForRuntimeState(session, 'paused');
    assert.equal(result.sessionId, 1);
    assert.equal(paused.point.line, 5);
    assert.equal(state.debug.state, 'paused');
    assert.equal(state.debug.sessionId, session.identity);
    assert.equal(session.launchBusy, false);
    const resetIndex = events.findIndex(event => event.type === 'ui');
    assert.ok(resetIndex >= 0, 'The real worker publishes its initial UI reset');
    assert.ok(resetIndex < events.findIndex(event => event.type === 'loaded'));
    assert.ok(capture.timer !== null || capture.running || capture.cursors.has(session.id));

    const stepped = waitForEvent(session, () => {
      const debug = session.debug;
      return debug && debug !== paused && ['paused', 'terminated', 'faulted'].includes(debug.state) ? debug : null;
    }, 'step completion');
    await services.runtime.request('resume', { mode: 'next' });
    assert.notEqual((await stepped).state, 'faulted');
    if (session.state === 'paused') await services.runtime.request('resume', { mode: 'continue' });
    const terminated = await waitForRuntimeState(session, 'terminated');
    assert.equal(terminated.output, '42\n');
    assert.equal(terminated.fault ?? null, null);
    const history = await completedCapture(fixture, session);
    assert.equal(history.runtimeSession, result.sessionId);
    assert.ok(history.cpuSamples.every(sample => sample.identity === session.identity && sample.sessionId === result.sessionId));
    assert.ok(history.totalBusyMs > 0);
    capture.setPaused(true);
    assert.equal(capture.timer, null);
    capture.setPaused(false);
    assert.equal(capture.timer, null, 'Completed console captures do not restart an idle polling loop');
    assert.deepEqual(errors, []);
  });

  test(`Studio ${engine} timers preserve two live applications across targeted stop and restart`, async context => {
    const compiled = compileProgram(windowSource, { includeDebug: true });
    const fixture = runtimeTimerWorkbench(context);
    const { services, state, capture, errors } = fixture;
    const alpha = services.sessions.create({ projectId: 'Alpha' });
    const beta = services.sessions.create({ projectId: 'Beta' }, { activate: false });
    const options = value => ({ assembly: compiled.assembly, managedIL, debug: false,
      programArguments: [value], environment: { APP_ENV: value + ' environment' } });
    await alpha.launch(options('alpha'));
    await beta.launch(options('beta'));
    await waitForRuntimeState(alpha, 'terminated');
    await waitForRuntimeState(beta, 'terminated');
    for (const session of [alpha, beta]) {
      assert.equal(session.runtimeSession, 1);
      assert.equal(session.live, true);
      assert.equal(session.debug.uiActive, true);
      assert.equal(session.launchBusy, false);
    }
    assert.notEqual(alpha.identity, beta.identity);
    const betaIdentity = beta.identity;
    const betaOutput = beta.programOutput;
    const originalAlpha = alpha.identity;
    assert.ok(alpha.programOutput.endsWith('alpha environment\n'));
    assert.ok(betaOutput.endsWith('beta environment\n'));
    await alpha.stop();
    await completedCapture(fixture, alpha);
    assert.equal(alpha.live, false);
    assert.equal(services.sessions.active, beta);
    assert.equal(state.debug.sessionId, betaIdentity);
    assert.equal(beta.identity, betaIdentity);
    assert.equal(beta.debug.uiActive, true);
    assert.equal(beta.programOutput, betaOutput);
    capture.setPaused(true);
    assert.equal(capture.timer, null);
    await alpha.restart();
    await waitForRuntimeState(alpha, 'terminated');
    assert.notEqual(alpha.identity, originalAlpha);
    assert.equal(alpha.runtimeSession, 1, 'The replacement worker may reuse its local serial');
    assert.equal(alpha.debug.uiActive, true);
    assert.equal(services.sessions.active, beta, 'A background restart does not select its application');
    assert.equal(beta.programOutput, betaOutput);
    capture.setPaused(false);
    await waitForEvent(fixture.timeline, () => fixture.timeline.histories.get(alpha.identity), 'replacement capture identity');
    assert.ok(fixture.timeline.histories.has(originalAlpha));
    assert.deepEqual(errors, []);
  });
}
