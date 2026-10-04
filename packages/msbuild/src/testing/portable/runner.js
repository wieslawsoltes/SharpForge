import {createTestResult, TestOutcome} from '../model.js';
import {TestRunSession} from '../session.js';
import {discoverPortableTests} from './discovery.js';
import {createManagedTestRuntime} from './managed-runtime.js';

function mappedFailure(fault) {
  const message = fault?.message ?? String(fault);
  if (message.startsWith('SFT_SKIP:')) return TestOutcome.Skipped;
  if (message.startsWith('SFT_NOTRUNNABLE:') || /NotSupported|InvalidProgram|MissingMethod|TypeLoad/.test(fault?.name ?? '')) {
    return TestOutcome.NotRunnable;
  }
  if (/InstructionLimit|ExecutionLimit/.test(fault?.name ?? '')) return TestOutcome.TimedOut;
  return TestOutcome.Failed;
}

function sourceOf(result, fallback) {
  const point = result.source;
  if (!point || point.uri?.startsWith('sharpforge://')) return fallback;
  return {path: point.uri ?? point.source ?? fallback?.path, line: point.line ?? point.startLine ?? fallback?.line,
    column: point.column ?? point.startColumn ?? 1, start: point.start, end: point.end, origin: 'managed-sequence-point'};
}

async function timedInvocation(invoke, timeoutMs, parentSignal) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) throw new Error('Test timeout must be 1–3600000 ms');
  const controller = new AbortController();
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort('test-timeout'), timeoutMs);
  try {
    const result = await invoke({signal});
    return {...result, timedOut: controller.signal.aborted};
  } catch (fault) {
    return {fault, value: null, stdout: '', durationMs: 0, timedOut: controller.signal.aborted, cancelled: parentSignal?.aborted};
  } finally { clearTimeout(timer); }
}

/** Execute framework lifecycle methods on an isolated managed session and preserve explicit fail/skip/not-runnable boundaries. */
export async function runPortableTests(discovery, options = {}) {
  const {signal, timeoutMs = 30_000, createRuntime = createManagedTestRuntime, includeExplicit = false} = options;
  const runtime = await createRuntime(discovery, options);
  const diagnostics = [...runtime.diagnostics];
  const results = [];
  const completed = new Set();
  const testsById = new Map(discovery.tests.map(test => [test.id, test]));
  const emit = (test, input) => {
    const result = createTestResult(test, {backend: 'portable-' + runtime.backend, ...input});
    results.push(result);
    completed.add(test.id);
    options.onEvent?.({kind: 'test-completed', result});
  };
  let interrupted = false;
  const summary = () => ({results, diagnostics, cancelled: interrupted || !!signal?.aborted,
    success: !interrupted && !signal?.aborted && !diagnostics.some(value => value.severity === 'error') &&
      results.every(result => [TestOutcome.Passed, TestOutcome.Skipped].includes(result.outcome))});
  try {
    for (const test of discovery.tests) {
      if (signal?.aborted) { interrupted = true; break; }
      if (test.skipReason || test.explicit && !includeExplicit) {
        emit(test, {outcome: TestOutcome.Skipped, message: test.skipReason ?? 'Explicit test was not selected'});
      } else if (test.notRunnableReason || runtime.unavailable.has(test.id)) {
        const diagnostics = runtime.unavailable.get(test.id) ?? [];
        emit(test, {outcome: TestOutcome.NotRunnable, message: test.notRunnableReason ?? diagnostics.map(value => value.message).join('\n'), diagnostics});
      }
    }
    if (!runtime.hasRunnableTests || interrupted) return summary();
    const setup = await timedInvocation(value => runtime.initialize(value), timeoutMs, signal);
    if (setup.fault || setup.timedOut) {
      for (const test of discovery.tests) if (!completed.has(test.id)) emit(test, {outcome: setup.timedOut ? TestOutcome.TimedOut : mappedFailure(setup.fault),
        message: 'Suite initialization failed: ' + setup.fault?.message});
      return summary();
    }
    for (const group of runtime.groups) {
      if (signal?.aborted || interrupted) { interrupted = true; break; }
      const groupTests = group.testIds.map(id => testsById.get(id)).filter(test => !completed.has(test.id));
      if (!groupTests.length) continue;
      const initialization = await timedInvocation(value => runtime.initializeGroup(group, value), timeoutMs, signal);
      if (initialization.fault || initialization.timedOut) {
        for (const test of groupTests) emit(test, {outcome: initialization.timedOut ? TestOutcome.TimedOut : mappedFailure(initialization.fault),
          message: 'Fixture initialization failed: ' + initialization.fault?.message, stdout: initialization.stdout});
        interrupted = initialization.timedOut || !!signal?.aborted;
      } else {
        for (const test of groupTests) {
          if (signal?.aborted) { interrupted = true; break; }
          options.onEvent?.({kind: 'test-started', testId: test.id});
          const value = await timedInvocation(value => runtime.execute(test, value), test.timeoutMs || timeoutMs, signal);
          const outcome = value.cancelled ? TestOutcome.Cancelled : value.timedOut ? TestOutcome.TimedOut :
            value.fault ? mappedFailure(value.fault) : TestOutcome.Passed;
          emit(test, {outcome, durationMs: value.durationMs, stdout: value.stdout, message: value.fault?.message,
            stackTrace: value.fault?.stack ?? '', source: sourceOf(value, test.source)});
          if (outcome === TestOutcome.TimedOut || value.cancelled) { interrupted = true; break; }
        }
      }
      if (!interrupted) {
        const cleanup = await timedInvocation(value => runtime.cleanupGroup(group, value), timeoutMs, signal);
        if (cleanup.fault) {
          for (let index = 0; index < results.length; index++) {
            const result = results[index];
            if (!group.testIds.includes(result.testId)) continue;
            results[index] = createTestResult(testsById.get(result.testId), {...result, outcome: TestOutcome.Failed,
              message: result.message + '\nFixture cleanup failed: ' + cleanup.fault.message});
            options.onEvent?.({kind: 'test-result-updated', result: results[index]});
          }
        }
      }
    }
    if (!interrupted) {
      const cleanup = await timedInvocation(value => runtime.cleanup(value), timeoutMs, signal);
      if (cleanup.fault) diagnostics.push({code: 'SFT2403', severity: 'error', message: 'Suite cleanup failed: ' + cleanup.fault.message});
    }
  } finally {
    runtime.dispose();
    for (const test of discovery.tests) if (!completed.has(test.id)) emit(test, {outcome: TestOutcome.NotRun,
      message: 'The isolated run ended before this test executed'});
  }
  return summary();
}

/** Public portable provider; each run owns its own heap, cancellation scope and replayable progress stream. */
export class PortableTestAdapter {
  constructor(options = {}) {
    this.id = 'portable-managed';
    this.options = options;
    this.sessions = new Map();
    this.sequence = 0;
    this.closed = false;
  }
  async discover(input, options = {}) {
    if (this.closed) throw new Error('Portable test adapter is disposed');
    return discoverPortableTests(input, {...this.options, ...options});
  }
  async run(discovery, options = {}) {
    if (this.closed) throw new Error('Portable test adapter is disposed');
    const limit = this.options.maxSessions ?? 32;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1024) throw new Error('Invalid portable session limit');
    if (this.sessions.size >= limit) {
      const expired = [...this.sessions.values()].find(session => ['completed', 'cancelled', 'disposed'].includes(session.state));
      if (!expired) throw new Error('Portable test session limit exceeded');
      expired.dispose();
      this.sessions.delete(expired.id);
    }
    const session = new TestRunSession({id: 'portable-' + ++this.sequence, tests: discovery.tests, onEvent: options.onEvent});
    this.sessions.set(session.id, session);
    session.start();
    options.onSession?.({id: session.id});
    const signal = options.signal ? AbortSignal.any([options.signal, session.controller.signal]) : session.controller.signal;
    try {
      const result = await runPortableTests(discovery, {...this.options, ...options, signal,
        onEvent: event => session.emit(event.kind, event)});
      session.results = result.results;
      session.state = result.cancelled ? 'cancelled' : 'completed';
      session.emit('run-completed', {state: session.state, resultCount: result.results.length});
      return {...session.snapshot(), ...result};
    } catch (error) { session.dispose(); throw error; }
  }
  cancel(id) { this.sessions.get(id)?.cancel(); }
  snapshot(id, after = 0) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Unknown portable test session');
    return session.snapshot(after);
  }
  close() { this.closed = true; for (const session of this.sessions.values()) session.dispose(); }
}
