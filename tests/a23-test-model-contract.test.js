import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEST_MODEL_VERSION, TestOutcome, createTestCase, createTestResult, createTestTree,
  defineTestAdapter, testCaseId, TestRunSession
} from '@sharpforge/msbuild';

const input = {project: 'Tests/Tests.csproj', fqn: 'Demo.Checks.Value', displayName: 'Value(1)', rowKey: 'row:1'};

test('A23 T35 public test identity survives provider enrichment and normalizes project separators', () => {
  const original = createTestCase(input);
  const enriched = createTestCase({...input, project: 'Tests\\Tests.csproj', framework: 'xunit',
    displayName: 'friendly label', nativeId: 'native-guid', source: {path: 'Checks.cs', line: 2}});
  assert.equal(original.schemaVersion, TEST_MODEL_VERSION);
  assert.equal(original.id, enriched.id);
  assert.equal(original.id, testCaseId(input));
  for (const changes of [{project: 'Other.csproj'}, {fqn: 'Demo.Checks.Other'}, {rowKey: 'row:2'}]) {
    assert.notEqual(createTestCase({...input, ...changes}).id, original.id);
  }
});

test('A23 T35 public discovery records copy containers and preserve explicit unsupported and skip reasons', () => {
  const source = {path: 'Checks.cs', line: 1};
  const values = ['fast', 'fast', 'unit'];
  const rows = [{arguments: [1]}];
  const record = createTestCase({...input, source, traits: {Category: values}, dataRows: rows,
    skipReason: 'disabled', notRunnableReason: 'unsupported provider'});
  source.line = 99;
  values.push('later');
  rows.push({arguments: [2]});
  assert.equal(record.source.line, 1);
  assert.deepEqual(record.traits.Category, ['fast', 'unit']);
  assert.equal(record.dataRows.length, 1);
  assert.equal(record.skipReason, 'disabled');
  assert.equal(record.notRunnableReason, 'unsupported provider');
  for (const value of [record, record.source, record.traits, record.traits.Category, record.dataRows]) {
    assert.equal(Object.isFrozen(value), true);
  }
});

test('A23 T35 discovery identifiers, traits, rows and source spans enforce their public bounds', () => {
  const accepted = createTestCase({...input, displayName: 'x'.repeat(16_384),
    traits: {Category: Array.from({length: 256}, (_, index) => String(index))}, dataRows: Array(10_000).fill(null)});
  assert.equal(accepted.displayName.length, 16_384);
  for (const changes of [
    {project: ''}, {fqn: 'bad\0name'}, {fqn: 'x'.repeat(4097)}, {displayName: 'x'.repeat(16_385)},
    {traits: {Category: Array(257).fill('value')}}, {dataRows: Array(10_001).fill(null)},
    {source: {path: 'Checks.cs', line: 0}}
  ]) assert.throws(() => createTestCase({...input, ...changes}), /Invalid test|limit exceeded/);
  assert.throws(() => createTestCase(null), /TestCase input/);
});

test('A23 T35 result outcomes remain explicit and durations are nonnegative finite milliseconds', () => {
  const record = createTestCase(input);
  for (const outcome of Object.values(TestOutcome)) {
    const result = createTestResult(record, {outcome, durationMs: 0, stdout: 'Passed output is only text'});
    assert.equal(result.testId, record.id);
    assert.equal(result.outcome, outcome);
    assert.equal(result.durationMs, 0);
    assert.equal(Object.isFrozen(result), true);
  }
  assert.throws(() => createTestResult(record, {outcome: 'success'}), /Unknown test outcome/);
  for (const durationMs of [-1, NaN, Infinity]) {
    assert.throws(() => createTestResult(record, {outcome: TestOutcome.Passed, durationMs}), /Invalid test duration/);
  }
});

test('A23 T35 public explorer projection groups and sorts records and rejects duplicate identities', () => {
  const records = [
    createTestCase({...input, project: 'B.csproj'}),
    createTestCase({...input, project: 'A.csproj', fqn: 'Demo.Zeta.Value'}),
    createTestCase({...input, project: 'A.csproj', fqn: 'Demo.Alpha.Value', rowKey: 'two', displayName: 'Z'}),
    createTestCase({...input, project: 'A.csproj', fqn: 'Demo.Alpha.Value', rowKey: 'one', displayName: 'A'})
  ];
  const tree = createTestTree(records);
  assert.deepEqual(tree.map(project => project.label), ['A.csproj', 'B.csproj']);
  assert.deepEqual(tree[0].children.map(type => type.label), ['Demo.Alpha', 'Demo.Zeta']);
  assert.deepEqual(tree[0].children[0].children.map(row => row.label), ['A', 'Z']);
  assert.throws(() => createTestTree([records[0], records[0]]), /Duplicate TestCase/);
  assert.throws(() => createTestTree(Array(100_001)), /size limit/);
  assert.throws(() => createTestTree(null), /size limit/);
});

test('A23 T35 adapter contracts require discovery, execution, cancellation and close methods', () => {
  const adapter = {id: 'example', async discover() {}, async run() {}, cancel() {}, close() {}};
  assert.equal(defineTestAdapter(adapter), adapter);
  for (const method of ['discover', 'run', 'cancel', 'close']) {
    assert.throws(() => defineTestAdapter({...adapter, [method]: undefined}), new RegExp('requires ' + method));
  }
  assert.throws(() => defineTestAdapter({...adapter, id: ''}), /adapter id/);
});

test('A23 T35 session cursors report bounded replay loss and console progress never creates a result', () => {
  const observed = [];
  const session = new TestRunSession({id: 'run', tests: [createTestCase(input)], maxEvents: 2,
    onEvent: event => observed.push(event)});
  session.start();
  session.line({stream: 'stdout', text: 'Passed Value(1) [3 ms]'});
  assert.equal(session.results.length, 0);
  assert.deepEqual(session.snapshot().events.map(event => event.sequence), [2, 3]);
  assert.equal(session.snapshot().truncated, true);
  assert.deepEqual(session.snapshot(2).events.map(event => event.kind), ['test-progress']);
  assert.equal(session.snapshot(2).truncated, false);
  session.line({stream: 'stderr', text: 'testhost pid: 321'});
  assert.deepEqual(session.snapshot().debuggerHandoff, {pid: 321, protocol: 'managed-testhost', waitingForDebugger: true});
  assert.equal(session.snapshot().nextCursor, 5);
  assert.equal(observed.length, 5);
  assert.throws(() => session.start(), /already started/);
  session.dispose();
});

test('A23 T35 cancellation preserves completed results and marks unfinished tests not run', () => {
  const first = createTestCase(input);
  const second = createTestCase({...input, rowKey: 'row:2'});
  const session = new TestRunSession({id: 'cancelled', tests: [first, second]});
  session.start();
  session.cancel('user');
  assert.equal(session.controller.signal.aborted, true);
  const completed = createTestResult(first, {outcome: TestOutcome.Passed});
  const snapshot = session.complete([completed], 'test-backend');
  assert.equal(snapshot.state, 'cancelled');
  assert.equal(snapshot.results[0], completed);
  assert.equal(snapshot.results[1].testId, second.id);
  assert.equal(snapshot.results[1].outcome, TestOutcome.NotRun);
  assert.equal(snapshot.results[1].backend, 'test-backend');
  session.dispose();
});

test('A23 T35 sessions reject invalid budgets and cursors, and disposal releases the event observer', () => {
  for (const maxEvents of [0, -1, 1.5, 100_001]) {
    assert.throws(() => new TestRunSession({id: 'run', maxEvents}), /event budget/);
  }
  assert.throws(() => new TestRunSession({id: 'run', tests: [{}]}), /TestCase records/);
  assert.throws(() => new TestRunSession(), /requires an id/);
  const session = new TestRunSession({id: 'run', onEvent() {}});
  for (const cursor of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => session.snapshot(cursor), /cursor/);
  session.dispose();
  assert.equal(session.state, 'disposed');
  assert.equal(session.controller.signal.aborted, true);
  assert.equal(session.onEvent, null);
  session.dispose();
});
