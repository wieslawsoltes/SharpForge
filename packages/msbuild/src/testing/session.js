import {createTestResult, TestOutcome} from './model.js';

/** A cancellable run session with bounded replayable progress and a debugger PID handoff. */
export class TestRunSession {
  constructor({id, tests = [], maxEvents = 10_000, onEvent = null} = {}) {
    if (typeof id !== 'string' || !id) throw new Error('Test session requires an id');
    if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 100_000) throw new Error('Invalid test event budget');
    if (!Array.isArray(tests) || tests.length > 100_000 || tests.some(test => !test?.id || !test.fqn)) {
      throw new Error('Test sessions require bounded TestCase records');
    }
    this.id = id;
    this.tests = [...tests];
    this.maxEvents = maxEvents;
    this.onEvent = onEvent;
    this.controller = new AbortController();
    this.events = [];
    this.results = [];
    this.sequence = 0;
    this.state = 'created';
    this.debuggerHandoff = null;
  }

  emit(kind, data = {}) {
    const event = {sequence: ++this.sequence, sessionId: this.id, kind, ...data};
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.shift();
    this.onEvent?.(event);
    return event;
  }

  start() {
    if (this.state !== 'created') throw new Error('Test session already started');
    this.state = 'running';
    this.emit('run-started', {testCount: this.tests.length});
  }

  line({stream, text}) {
    this.emit('output', {stream, text});
    const debug = /(?:Process Id|Process ID|testhost pid)\s*[:=]\s*(\d+)/i.exec(text);
    if (debug) {
      this.debuggerHandoff = {pid: Number(debug[1]), protocol: 'managed-testhost', waitingForDebugger: true};
      this.emit('debugger-handoff', this.debuggerHandoff);
    }
    const progress = /^\s*(Passed|Failed|Skipped)\s+(.+?)(?:\s+\[[^\]]+\])?\s*$/.exec(text);
    if (progress) this.emit('test-progress', {nativeOutcome: progress[1], displayName: progress[2]});
  }

  complete(results, backend = 'native-vstest') {
    this.results = [...results];
    if (this.controller.signal.aborted) {
      const completed = new Set(this.results.map(result => result.testId));
      for (const test of this.tests) if (!completed.has(test.id)) {
        this.results.push(createTestResult(test, {outcome: TestOutcome.NotRun, message: 'Run cancelled before a result was produced', backend}));
      }
    }
    for (const result of this.results) this.emit('test-completed', {result});
    this.state = this.controller.signal.aborted ? 'cancelled' : 'completed';
    this.emit('run-completed', {state: this.state, resultCount: this.results.length});
    return this.snapshot();
  }

  cancel(reason = 'user') {
    if (['completed', 'cancelled', 'cancelling', 'failed', 'disposed'].includes(this.state)) return;
    this.controller.abort(reason);
    this.state = 'cancelling';
    this.emit('cancelling', {reason: String(reason)});
  }

  snapshot(after = 0) {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid test progress cursor');
    return {id: this.id, state: this.state, events: this.events.filter(event => event.sequence > after),
      nextCursor: this.sequence, truncated: !!this.events.length && after < this.events[0].sequence - 1,
      results: [...this.results], debuggerHandoff: this.debuggerHandoff};
  }

  dispose() {
    this.cancel('dispose');
    this.onEvent = null;
    this.state = 'disposed';
  }
}
