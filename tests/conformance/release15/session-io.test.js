import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionIOPhases, requireCompletedBuild, validateSessionIO } from '../../../scripts/conformance/release15/session-io-report.js';
import { finishSessionIOBrowser, validateSessionIOBrowserClose } from '../../../scripts/conformance/release15/session-io-adapter.js';

// Synthetic records verify the evidence policy only; no product/provider/browser qualification is asserted by these tests.
function fixture() {
  const commit = 'a'.repeat(40), sourceSha256 = 'b'.repeat(64);
  const assets = ['studio.js', 'compiler.worker.js', 'runtime.worker.js'].map(path => ({ path, sha256: 'c'.repeat(64) }));
  const sessions = ['alpha', 'beta', 'alpha-copy'].map((tag, index) => ({
    id: `app-${index}`, tag, identity: `app-${index}:1:1`, project: tag === 'beta' ? 'Beta/Beta.csproj' : 'Alpha/Alpha.csproj',
    workerUrl: 'http://127.0.0.1:8000/runtime.worker.js', engine: 'source-vm',
  }));
  const runtime = (network = {}) => ({
    compute: { completed: 1, slots: [{ backend: 'scalar' }] }, pendingExternal: 0,
    network: { requests: 0, active: 0, ...network },
  });
  const checks = sessionIOPhases.map(name => ({ name, status: 'passed', screenshot: `session-io-${name}.png` }));
  Object.assign(checks[0], { productionRuntimeWorkers: true, productionCompilerWorkers: true, runtimeWorkers: 3, compilerWorkers: 2,
    distinctWorkerRoles: true, sessions, source: 'session-io-source.json', sourceSha256,
    servedAssets: Object.fromEntries(assets.map(row => [row.path, row.sha256])) });
  Object.assign(checks[1], { sessionId: 'app-0', endpointRequests: 0, runtime: runtime() });
  Object.assign(checks[2], { endpoint: 'http://127.0.0.1:9000', sessions: sessions.map(row => ({
    ...row, activeGrants: { network: { allowedOrigins: ['http://127.0.0.1:9000'] } },
  })) });
  Object.assign(checks[3], { runtimes: Object.fromEntries(sessions.map(row => [row.id, {
    ...runtime({ requests: 1, active: 1 }), pendingExternal: 1,
  }])) });
  Object.assign(checks[4], { sessionId: 'app-0', runtime: runtime({ requests: 1, canceled: 1 }) });
  Object.assign(checks[5], { revokedSession: 'app-1', activeDebugger: 'app-2', revokedRuntime: runtime({ requests: 1 }),
    survivingRuntime: runtime({ requests: 1, completed: 1 }) });
  Object.assign(checks[6], { deniedRuntime: runtime() });
  const endpointEvents = sessions.map((row, index) => ({ event: 'received', tag: row.tag, milliseconds: index,
    cookiePresent: false, authorizationPresent: false })).concat(sessions.map((row, index) => ({
    event: 'responded', tag: row.tag, milliseconds: 10 + index,
  })));
  return { context: { commit, assets, sourceSha256 }, observation: {
    schemaVersion: 1, kind: 'release15-session-io', componentStatus: 'passed', source: { commit },
    browser: { name: 'chromium', version: 'recorded-by-browser' }, checks, endpointEvents, unexecutedPhases: [],
    cleanup: { status: 'passed', liveApplications: 0, endpointStopped: true },
  } };
}

test('session I/O evidence keeps broader release obligations blocked after complete component records', () => {
  const { observation, context } = fixture();
  const result = validateSessionIO(observation, context);
  assert.equal(result.componentStatus, 'passed');
  assert.equal(result.status, 'blocked');
  assert.equal(result.requirement, 'numeric-network');
  assert.deepEqual(result.blockers.map(row => row.id), ['FAIR-SESSION-IO']);
  assert.match(result.limits.join(' '), /WebSocket.*provider.*HTML export.*native.*physical GPU/s);
});

test('session I/O rejects incomplete, reordered, duplicated and failed product phases', () => {
  for (const mutate of [
    value => value.checks.pop(),
    value => value.checks.reverse(),
    value => value.checks.splice(3, 1, value.checks[2]),
    value => { value.checks[2].status = 'blocked'; },
    value => { value.unexecutedPhases = ['revoked-session-restart']; },
    value => { value.cleanup.endpointStopped = false; },
    value => { value.failure = { message: 'late teardown error' }; },
    value => { value.componentStatus = 'failed'; },
  ]) {
    const { observation, context } = fixture();
    mutate(observation);
    assert.throws(() => validateSessionIO(observation, context), /Invalid session I\/O evidence/);
  }
});

test('session I/O rejects absent worker provenance, stale builds and changed fixture bytes', () => {
  for (const mutate of [
    value => { value.source.commit = 'd'.repeat(40); },
    value => { value.browser.name = 'simulator'; },
    value => { value.checks[0].productionRuntimeWorkers = false; },
    value => { value.checks[0].distinctWorkerRoles = false; },
    value => { value.checks[0].compilerWorkers = 1; },
    value => { value.checks[0].sessions[2].identity = value.checks[0].sessions[0].identity; },
    value => { value.checks[0].sessions[0].workerUrl = 'blob:pretend-worker'; },
    value => { value.checks[0].servedAssets['runtime.worker.js'] = 'changed'; },
    value => { value.checks[0].sourceSha256 = 'changed'; },
    value => { value.checks[0].screenshot = '../unrelated.png'; },
  ]) {
    const { observation, context } = fixture();
    mutate(observation);
    assert.throws(() => validateSessionIO(observation, context));
  }
});

test('session I/O rejects credential leakage, sequential HTTP, wrong targets and incomplete cancellation', () => {
  for (const mutate of [
    value => { value.endpointEvents[0].cookiePresent = true; },
    value => { value.endpointEvents[0].authorizationPresent = true; },
    value => { value.endpointEvents[3].milliseconds = 0.5; },
    value => { value.endpointEvents[3].event = 'deadline'; },
    value => { value.checks[2].endpoint = 'https://provider.example'; },
    value => { value.checks[3].runtimes['app-2'].compute.slots[0].backend = 'mock'; },
    value => { value.checks[4].runtime.pendingExternal = 1; },
    value => { value.checks[5].revokedSession = 'app-0'; },
    value => { value.checks[5].survivingRuntime.network.completed = 0; },
    value => { value.checks[6].deniedRuntime.network.requests = 1; },
  ]) {
    const { observation, context } = fixture();
    mutate(observation);
    assert.throws(() => validateSessionIO(observation, context));
  }
});

test('production build qualification requires an unchanged clean source revision', () => {
  const commit = 'a'.repeat(40);
  const build = { format: 'sharpforge-build-identity', version: 1, stable: true, source: { commit, clean: true } };
  requireCompletedBuild(build, commit);
  assert.throws(() => requireCompletedBuild({ ...build, stable: false }, commit), /stable production build/);
  assert.throws(() => requireCompletedBuild({ ...build, source: { commit, clean: false } }, commit), /dirty revision/);
  assert.throws(() => requireCompletedBuild(build, 'b'.repeat(40)), /another or dirty revision/);
});

function adapterChild({ exitCode = 0, failure, hang = false } = {}) {
  const events = [];
  let finish;
  const child = {
    failure, stderr: 'retained browser diagnostics', child: { exitCode: null, signalCode: null },
    closed: new Promise(resolve => { finish = resolve; }),
    async request(command) {
      events.push(command);
      if (!hang) queueMicrotask(exit);
      return { closed: true };
    },
    async close() { events.push('cleanup'); },
  };
  function exit() {
    child.child.exitCode = exitCode;
    events.push('process-closed');
    finish();
  }
  return { child, events, exit };
}

test('session I/O waits for browser teardown after the close acknowledgement', async () => {
  const { child, events, exit } = adapterChild({ hang: true });
  const finishing = finishSessionIOBrowser(child);
  await Promise.resolve();
  assert.deepEqual(events, ['close']);
  exit();
  await finishing;
  assert.deepEqual(events, ['close', 'process-closed', 'cleanup']);
});

test('session I/O preserves missing-browser, teardown-exit and timeout failures', async () => {
  const missing = new Error("BrowserType.launch: Executable doesn't exist at the pinned browser path");
  const unavailable = adapterChild({ failure: missing });
  await assert.rejects(finishSessionIOBrowser(unavailable.child), error => error === missing);
  assert.deepEqual(unavailable.events, ['cleanup']);
  const failed = adapterChild({ exitCode: 1 });
  await assert.rejects(finishSessionIOBrowser(failed.child), /Browser teardown exited 1; retained browser diagnostics/);
  assert.equal(failed.events.at(-1), 'cleanup');
  const timedOut = adapterChild({ hang: true });
  await assert.rejects(finishSessionIOBrowser(timedOut.child, { timeoutMs: 5 }), /teardown did not finish/);
  assert.deepEqual(timedOut.events, ['close', 'cleanup']);
});

test('session I/O requires the retained final browser identity and clean CSP/teardown record', () => {
  const observation = { browser: { name: 'chromium', version: '153.0' } };
  const session = { suite: 'studio-driver', passed: true, mode: 'http', engine: 'chromium', browser: '153.0',
    cspViolations: [], diagnosticErrors: [] };
  validateSessionIOBrowserClose(session, observation);
  for (const patch of [
    { passed: false }, { engine: 'firefox' }, { browser: 'different' }, { mode: 'in-memory' },
    { cspViolations: [{ directive: 'connect-src' }] }, { diagnosticErrors: ['context close failed'] },
  ]) {
    assert.throws(() => validateSessionIOBrowserClose({ ...session, ...patch }, observation), /browser teardown, CSP/);
  }
  assert.throws(() => validateSessionIOBrowserClose(null, observation), /browser teardown, CSP/);
});
