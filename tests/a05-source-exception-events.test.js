import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {Op} from '@sharpforge/bytecode';
import {VirtualMachine, ManagedFault, RuntimeEventName} from '@sharpforge/runtime';

const caught = `class Program {
  static void Fail() { try { throw new Exception("private message"); } finally { Console.Write("finally"); } }
  static void Main() { try { Fail(); } catch (Exception) { Console.Write("caught"); } }
}`;
const propagated = body => `class Program {
  static void Fail() { try { throw new Exception("bad"); } catch (Exception error) { ${body} } }
  static void Main() { try { Fail(); } catch (Exception) { Console.Write("caught"); } }
}`;
const cache = new Map();
function make(engine, source = caught, options = {}) {
  let artifact = cache.get(source);
  if (!artifact) {
    artifact = compileToIL(source);
    assert.equal(artifact.success, true, JSON.stringify(artifact.diagnostics));
    cache.set(source, artifact);
  }
  return new VirtualMachine(engine === 'source' ? artifact.image : artifact.assembly, {runtimeEvents: true, ...options});
}
const origins = vm => vm.runtimeEvents.read().filter(event => event.name === RuntimeEventName.ExceptionThrown);
const opcodeAt = (vm, event) => vm.image.methods[event.payload.method].code[event.payload.instructionIndex * 3];

function beforeRethrow(vm) {
  for (let step = 0; step < 500; step++) {
    const frame = vm.top;
    if (frame && vm.image.methods[frame.methodId].code[frame.pc * 3] === Op.RETHROW) return frame;
    assert(['ready', 'running'].includes(vm.state));
    vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
  }
  assert.fail('Did not reach a live caught rethrow');
}

for (const engine of ['source', 'reload']) {
  test(`${engine}: one origin precedes debugger notification, catch and finally without retaining the fault`, () => {
    const vm = make(engine), delivered = [];
    let notified = 0;
    const unsubscribe = vm.runtimeEvents.subscribe(event => {
      if (event.name === 'ExceptionThrown') delivered.push(event);
    });
    vm.onException = fault => {
      notified++;
      assert.deepEqual(delivered, []);
      assert.equal(origins(vm).length, 1);
      assert.equal(origins(vm)[0].payload.name, fault.name);
      return false;
    };
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, 'finallycaught');
      assert.equal(notified, 1);
      assert.deepEqual(delivered, origins(vm));
      const event = delivered[0];
      assert.equal(vm.image.methods[event.payload.method].name, 'Fail');
      assert.equal(opcodeAt(vm, event), Op.THROW);
      assert.equal(event.payload.exceptionType, 'System.Exception');
      assert.equal(event.payload.fatal, false);
      assert.equal(Object.isFrozen(event.payload), true);
      assert.deepEqual(Object.keys(event.payload).sort(), ['exceptionType', 'fatal', 'frame', 'instructionIndex', 'method', 'name']);
      assert(Number.isSafeInteger(event.payload.frame));
      assert(event.instruction > 0);
      assert.equal(JSON.stringify(event).includes('private message'), false);
    } finally { unsubscribe(); vm.stop(); }
  });

  test(`${engine}: valid rethrow and restored catch state reuse the existing origin`, () => {
    const vm = make(engine, propagated('throw;'));
    try {
      const frame = beforeRethrow(vm);
      assert(frame.caught.length > 0);
      assert.equal(origins(vm).length, 1);
      const snapshot = vm.snapshot(), history = origins(vm);
      assert.equal(vm.run().output, 'caught');
      assert.deepEqual(origins(vm), history);
      vm.restore(snapshot);
      assert(vm.top.caught.some(entry => entry.fault === vm.top.exception));
      assert.equal(vm.run().output, 'caught');
      assert.deepEqual(origins(vm), history);
    } finally { vm.stop(); }
  });

  test(`${engine}: debugger pending-fault resume and restore do not invent another throw`, () => {
    const vm = make(engine);
    vm.onException = () => true;
    try {
      assert.equal(vm.run().state, 'paused');
      assert(vm.pendingFault);
      const snapshot = vm.snapshot(), history = origins(vm);
      assert.equal(history.length, 1);
      vm.onException = null;
      assert.equal(vm.run().output, 'finallycaught');
      assert.deepEqual(origins(vm), history);
      vm.restore(snapshot);
      assert(vm.pendingFault);
      assert.equal(vm.run().output, 'finallycaught');
      assert.deepEqual(origins(vm), history);
    } finally { vm.stop(); }
  });

  test(`${engine}: explicit throw of the same object is a new origin`, () => {
    const vm = make(engine, propagated('throw error;')), references = [];
    vm.onException = fault => { references.push(fault.reference); return false; };
    try {
      assert.equal(vm.run().output, 'caught');
      const events = origins(vm);
      assert.equal(events.length, 2);
      assert.deepEqual(events.map(event => opcodeAt(vm, event)), [Op.THROW, Op.THROW]);
      assert.equal(references.length, 2);
      assert.equal(references[0], references[1]);
      assert.notEqual(events[0].payload.instructionIndex, events[1].payload.instructionIndex);
      assert(events[1].sequence > events[0].sequence);
    } finally { vm.stop(); }
  });

  test(`${engine}: invalid rethrow reports its new fault rather than suppressing by opcode alone`, () => {
    const vm = make(engine, propagated('throw;'));
    try {
      const frame = beforeRethrow(vm);
      frame.caught = []; // Model a corrupted/expired catch context without changing verified bytecode.
      vm.run();
      const events = origins(vm);
      assert.equal(events.length, 2);
      assert.equal(events[1].payload.name, 'InvalidOperationException');
      assert.equal(events[1].payload.exceptionType, 'System.InvalidOperationException');
      assert.equal(opcodeAt(vm, events[1]), Op.RETHROW);
    } finally { vm.stop(); }
  });

  test(`${engine}: replaying the originating instruction creates a new chronological event`, () => {
    const vm = make(engine);
    try {
      const snapshot = vm.snapshot();
      assert.equal(vm.run().output, 'finallycaught');
      const first = origins(vm)[0];
      vm.restore(snapshot);
      assert.equal(vm.run().output, 'finallycaught');
      const events = origins(vm);
      assert.equal(events.length, 2);
      assert.equal(events[1].payload.name, first.payload.name);
      assert.equal(events[1].payload.instructionIndex, first.payload.instructionIndex);
      assert(events[1].sequence > first.sequence);
    } finally { vm.stop(); }
  });

  test(`${engine}: runtime instruction quota and pre-dispatch stack quota each emit one fatal origin`, () => {
    for (const kind of ['instructions', 'stack']) {
      const vm = make(engine, 'class Program { static void Main() { int[] value = new int[1]; Console.WriteLine(value.Length); } }');
      try {
        const frame = {id: vm.top.id, method: vm.top.methodId, pc: vm.top.pc};
        if (kind === 'instructions') vm.options.maxInstructions = 0;
        else vm.options.maxStackBytes = 16;
        assert.equal(vm.run().state, 'faulted');
        const event = origins(vm)[0];
        assert.equal(origins(vm).length, 1);
        assert.equal(event.payload.fatal, true);
        assert.equal(event.payload.name, vm.fault.name);
        assert.equal(event.payload.method, frame.method);
        assert.equal(event.payload.frame, frame.id);
        assert.equal(event.payload.instructionIndex, frame.pc);
        assert.equal(event.instruction, kind === 'stack' ? 0 : 1);
        if (kind === 'instructions') {
          assert.equal(event.payload.name, 'InstructionLimitException');
          assert.equal(event.payload.exceptionType, 'System.ExecutionEngineException');
        }
        vm.runSlice();
        assert.equal(origins(vm).length, 1);
      } finally { vm.stop(); }
    }
  });

  test(`${engine}: captured attempted location survives a host callback stopping and retiring its frame`, () => {
    const failure = new ManagedFault('InvalidOperationException', 'host callback failed');
    let location;
    const vm = make(engine, 'class Program { static void Main() { Console.Write("stop"); } }', {onOutput: () => {
      location = {method: vm.top.methodId, frame: vm.top.id, instructionIndex: vm.top.pc - 1};
      vm.stop();
      throw failure;
    }});
    try {
      assert.equal(vm.run().state, 'faulted');
      const event = origins(vm)[0];
      assert.equal(origins(vm).length, 1);
      for (const key of Object.keys(location)) assert.equal(event.payload[key], location[key]);
      assert.equal(event.payload.name, 'InvalidOperationException');
      assert.equal(vm.frames.length, 0);
    } finally { vm.stop(); }
  });

  test(`${engine}: subscriber failures escape after guest handlers and never become managed origins`, () => {
    const vm = make(engine), failure = new Error('exception subscriber');
    const unsubscribe = vm.runtimeEvents.subscribe(event => {
      if (event.name === 'ExceptionThrown') throw failure;
    });
    try {
      assert.throws(() => vm.run(), error => error === failure);
      assert.equal(vm.state, 'terminated');
      assert.equal(vm.output.join(''), 'finallycaught');
      assert.equal(vm.fault, null);
      assert.equal(origins(vm).length, 1);
    } finally { unsubscribe(); vm.stop(); }
  });

  test(`${engine}: host handleFault stays outside the origin boundary and disabled observation stays off`, () => {
    const vm = make(engine, 'class Program { static void Main() {} }');
    const plain = make(engine, caught, {runtimeEvents: false});
    try {
      vm.handleFault(new ManagedFault('InvalidOperationException', 'host delivery'));
      assert.equal(vm.state, 'faulted');
      assert.deepEqual(origins(vm), []);
      assert.equal(plain.runtimeEvents, null);
      assert.equal(plain.run().output, 'finallycaught');
    } finally { vm.stop(); plain.stop(); }
  });
}
