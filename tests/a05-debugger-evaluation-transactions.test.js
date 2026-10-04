import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {DebugSession, CilDebugSession} from '@sharpforge/debugger';

const source = `class Box {
 public int Value;
 public Box(int value) { Value=value; }
}
class P {
 static int total;
 public static int Read() { return total; }
 public static Box Change(int value) { total=value; Console.WriteLine("changed"); return new Box(value); }
 static void Main() {
 int x=1;
 Console.WriteLine(x);
 }
}`;
const consent = {allowSideEffects: true, timeBudgetMs: 2000};

function sessionFor(direct, options = {}) {
  const compiled = compileToIL(source);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const settings = {recordHistory: true, ...options};
  const session = direct ? new CilDebugSession(compiled.assembly, settings) : new DebugSession(compiled.image, settings);
  session.setBreakpoints('Program.cs', [{line: 11}]);
  session.start(false);
  session.runUntilStop();
  assert.equal(session.vm.state, 'paused');
  return session;
}

function queueOnAllocation(session, action, onAllocation = () => {}) {
  const {vm} = session, previous = vm.heap.allocationObserver;
  let queued = false;
  vm.heap.allocationObserver = {allocation() {
    if (queued) return;
    queued = true;
    assert.ok(vm.platform.transaction);
    for (let index = 1; index <= 3; index++) vm.platform.command({op: 'evaluation-test', index});
    onAllocation();
  }};
  try {
    return action();
  } finally {
    vm.heap.allocationObserver = previous;
  }
}

function controls(session) {
  const {vm} = session;
  return {onOutput: vm.onOutput, onWrite: vm.onWrite, onException: vm.onException,
    maximum: vm.options.maxInstructions, enabled: vm.scheduler.enabled, suppressed: vm.scheduler.suppressed, pins: vm.heap.pins.length};
}

function total(session) {
  return session.evaluateFunction('P.Read()', {...consent, commit: false}).value;
}

for (const direct of [false, true]) {
  const engine = direct ? 'CIL' : 'source';

  for (const schedulerEnabled of [false, true]) {
    test(`${engine}: evaluation commits history with scheduler ${schedulerEnabled ? 'enabled' : 'disabled'}`, () => {
      const commands = [], output = [], session = sessionFor(direct, {onOutput: text => output.push(text)});
      if (schedulerEnabled) session.vm.scheduler.ensure();
      const {vm} = session, before = controls(session), handles = vm.heap.handles.size;
      assert.equal(before.enabled, schedulerEnabled);
      vm.platform.options.onUICommand = command => {
        commands.push(command);
        assert.equal(vm.platform.transaction, null);
        assert.deepEqual(controls(session), {...before, pins: before.pins + 1});
        const capturedScheduler = session.history.at(-1).snapshot.scheduler;
        if (schedulerEnabled) assert.equal(capturedScheduler.suppressed, before.suppressed);
        else assert.equal(capturedScheduler, null);
        assert.equal(session.history.at(-1).snapshot.output.join(''), 'changed\n');
        vm.heap.collect();
      };
      const result = queueOnAllocation(session, () => session.evaluateFunction('P.Change(7)', consent));
      assert.equal(result.committed, true);
      assert.deepEqual(commands.map(command => command.index), [1, 2, 3]);
      assert.deepEqual(output, ['changed\n']);
      assert.equal(vm.heap.get(result.reference).data[0], 7);
      assert.equal(vm.heap.handles.size, handles + 1);
      assert.deepEqual(controls(session), before);
      const handle = session.evaluationHandles.at(-1);
      assert.equal(session.history.at(-1).snapshot.heap.handles.some(([id]) => id === handle.id), false);
      vm.platform.options.onUICommand = null;
      // Host collection follows capture, so the first reverse step restores the committed revision.
      session.stepBack();
      assert.equal(total(session), 7);
      assert.equal(vm.heap.get(result.reference).data[0], 7);
      assert.equal(vm.output.join(''), 'changed\n');
      session.stepBack();
      assert.equal(total(session), 0);
      assert.equal(vm.output.join(''), '');
      assert.equal(vm.scheduler.suppressed, before.suppressed);
      session.resume();
      assert.equal(session.evaluationHandles.length, 0);
      assert.equal(vm.heap.handles.size, handles);
    });
  }

  test(`${engine}: failed history preparation discards buffered effects and result leases`, () => {
    const commands = [], output = [];
    const session = sessionFor(direct, {onUICommand: command => commands.push(command), onOutput: text => output.push(text)});
    const retained = session.evaluateFunction('new Box(3)', consent);
    const {vm} = session, before = controls(session), history = [...session.history];
    const instructions = vm.instructions, handles = vm.heap.handles.size, bytes = session.historyBytes, dropped = session.historyDropped;
    const evaluationHandles = [...session.evaluationHandles];
    const remember = session.remember.bind(session);
    let captures = 0;
    session.remember = (...args) => {
      remember(...args);
      if (++captures === 2) throw new Error('history capture failed');
    };
    assert.throws(() => queueOnAllocation(session, () => session.evaluateFunction('P.Change(9)', consent)), /history capture failed/);
    session.remember = remember;
    assert.equal(vm.platform.transaction, null);
    assert.deepEqual(commands, []);
    assert.deepEqual(output, []);
    assert.equal(vm.output.join(''), '');
    assert.equal(vm.instructions, instructions);
    assert.equal(vm.heap.handles.size, handles);
    assert.deepEqual(session.evaluationHandles, evaluationHandles);
    vm.heap.collect();
    assert.equal(vm.heap.get(retained.reference).data[0], 3);
    assert.deepEqual(session.history, history);
    assert.equal(session.historyBytes, bytes);
    assert.equal(session.historyDropped, dropped);
    assert.deepEqual(controls(session), before);
    assert.equal(total(session), 0);
  });

  for (const failure of ['command', 'output']) {
    test(`${engine}: ${failure} delivery failure preserves the already observable evaluation commit`, () => {
      const commands = [], output = [], session = sessionFor(direct);
      const {vm} = session;
      vm.platform.options.onUICommand = command => {
        commands.push(command.index);
        if (failure === 'command' && command.index === 2) throw new Error('command delivery failed');
      };
      vm.onOutput = text => {
        output.push(text);
        if (failure === 'output') throw new Error('output delivery failed');
      };
      const before = controls(session), handles = vm.heap.handles.size;
      assert.throws(() => queueOnAllocation(session, () => session.evaluateFunction('P.Change(5)', consent)), /delivery failed/);
      assert.deepEqual(commands, failure === 'command' ? [1, 2] : [1, 2, 3]);
      assert.deepEqual(output, failure === 'command' ? [] : ['changed\n']);
      assert.equal(vm.platform.transaction, null);
      assert.equal(vm.output.join(''), 'changed\n');
      assert.equal(session.history.at(-1).snapshot.output.join(''), 'changed\n');
      assert.deepEqual(controls(session), before);
      assert.equal(total(session), 5);
      assert.equal(vm.heap.handles.size, handles + 1);
      vm.heap.collect();
      assert.equal(vm.heap.get(vm.heap.getHandle(session.evaluationHandles.at(-1))).data[0], 5);
      session.resume();
      assert.equal(session.evaluationHandles.length, 0);
      assert.equal(vm.heap.handles.size, handles);
    });
  }

  test(`${engine}: rollback and cancellation keep the active-transaction snapshot guard`, () => {
    const commands = [], output = [];
    const session = sessionFor(direct, {onUICommand: command => commands.push(command), onOutput: text => output.push(text)});
    const {vm} = session, before = controls(session), history = [...session.history], handles = vm.heap.handles.size;
    const transaction = vm.platform.beginTransaction();
    assert.throws(() => vm.snapshot(), /Cannot snapshot during an active platform transaction/);
    assert.throws(() => vm.platform.commitTransaction([], () => assert.fail('must not prepare')), /Invalid UI transaction/);
    assert.equal(vm.platform.transaction, transaction);
    vm.platform.rollbackTransaction(transaction);
    const result = queueOnAllocation(session, () => session.evaluateFunction('P.Change(8)', {...consent, commit: false}));
    assert.equal(result.reference, null);
    assert.equal(result.value, null);
    assert.equal(result.output, 'changed\n');
    assert.equal(vm.platform.transaction, null);
    const controller = new AbortController();
    controller.abort();
    assert.throws(() => session.evaluateFunction('P.Change(4)', {...consent, signal: controller.signal}), /cancelled/);
    const during = new AbortController();
    assert.throws(() => queueOnAllocation(session,
      () => session.evaluateFunction('P.Change(4)', {...consent, signal: during.signal}),
      () => during.abort()), /cancelled/);
    assert.deepEqual(commands, []);
    assert.deepEqual(output, []);
    assert.deepEqual(session.history, history);
    assert.equal(vm.heap.handles.size, handles);
    assert.deepEqual(controls(session), before);
    assert.equal(total(session), 0);
  });
}
