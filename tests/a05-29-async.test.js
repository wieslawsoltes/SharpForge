import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Writer,
  verifyCilAssembly,
  AssemblyInspector
} from '@sharpforge/cil';
import {
  CilVirtualMachine,
  ManagedFault
} from '@sharpforge/runtime';
import {
  asyncMethodDefinition,
  reachableAsyncMethods,
  asyncTypeDefinition
} from '../packages/cil/src/async-profile.js';
import {
  invokeAsyncIntrinsic,
  asyncRoots
} from '../packages/runtime/src/execution/async-runtime.js';
import {
  validateAsyncSnapshot
} from '../packages/runtime/src/execution/async-snapshot-validation.js';
import {
  address
} from '../packages/runtime/src/execution/control-pointers.js';
import {
  createValue as defaultValue,
  createValueFromFields
} from '../packages/runtime/src/execution/value-types.js';
const createValue = (vm, type, fields) => fields === undefined ? defaultValue(vm, vm.typeSystem.table(type)) : createValueFromFields(vm, vm.typeSystem
  .table(type), fields);
import {
  controlFixture
} from './support/control-fixture.js';
import {
  asyncFixture,
  BUILDER,
  AWAITER,
  RESULT_AWAITER,
  TASK,
  asyncSignatureType
} from './support/async-fixture.js';
const descriptor = (owner, name, result, parameters = [], isStatic = false) => ({
  kind: 'method',
  owner,
  name,
  signature: {
    kind: 'method',
    returnType: result,
    parameters,
    isStatic
  }
});
const builderTask = vm => [...vm.scheduler.tasks.values()].find(task => task.asyncState?.builderType.includes('AsyncTaskMethodBuilder'));

function waitingVm() {
  const vm = new CilVirtualMachine(asyncFixture(), {
    virtualTime: true
  });
  const result = vm.run();
  assert.equal(result.state, 'waiting', result.fault?.stack);
  assert.equal(builderTask(vm).asyncState.phase, 'awaiting');
  return vm;
}

test('A05 T29 two real MoveNext suspensions resume through finally and return a result', async () => {
  const vm = waitingVm();
  assert.equal(vm.statics.get(0x04000001), 0);
  vm.scheduler.advance(5);
  assert.equal(vm.run().state, 'waiting');
  assert.equal(vm.statics.get(0x04000001), 0);
  const result = await vm.runAsync();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.output, '42\n');
  assert.equal(vm.statics.get(0x04000001), 1);
  assert.equal(builderTask(vm).status, 'completed');
  assert.equal(builderTask(vm).asyncState.machine, null);
});
test('A05 T29 paused await snapshots preserve boxed machine, waiter and builder identities', async () => {
  const vm = waitingVm(),
    task = builderTask(vm),
    machine = task.asyncState.machine;
  assert.equal(vm.heap.get(machine).kind, 'box');
  assert([...asyncRoots(vm)].some(ref => ref?.h === machine.h));
  const first = vm.snapshot();
  vm.scheduler.advance(5);
  assert.equal(vm.run().state, 'waiting');
  const second = vm.snapshot();
  assert.equal((await vm.runAsync()).output, '42\n');
  for (const snapshot of [first, second]) {
    vm.restore(snapshot);
    vm.heap.collect();
    const result = await vm.runAsync();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, '42\n');
    assert.equal(vm.statics.get(0x04000001), 1);
  }
});
test('A05 T29 awaiter raises a task fault inside MoveNext and cleanup executes once', async () => {
  const vm = waitingVm(),
    pending = vm.scheduler.taskRecord(builderTask(vm).asyncState.awaitedTask);
  const message = vm.heap.string('awaited failure'),
    reference = vm.heap.allocate('exception', 'System.Exception', [message], [message]),
    fault = new ManagedFault('System.Exception', 'awaited failure', reference);
  vm.scheduler.complete(pending, null, fault);
  const result = await vm.runAsync();
  assert.equal(result.state, 'faulted');
  assert.equal(result.fault.message, 'awaited failure');
  assert.equal(vm.statics.get(0x04000001), 1);
  assert.equal(builderTask(vm).status, 'faulted');
  assert.equal(vm.platform.get(builderTask(vm).ref, '$exception').h, reference.h);
});
test('A05 T29 cancellation during an await drops all pending continuations', () => {
  const vm = waitingVm();
  vm.stop();
  vm.heap.collect();
  assert.equal(vm.state, 'terminated');
  assert.equal(vm.frames.length, 0);
  assert.equal([...asyncRoots(vm)].length, 0);
  assert([...vm.scheduler.tasks.values()].every(task => ['completed', 'faulted', 'canceled'].includes(task.status)));
  assert.equal(vm.statics.get(0x04000001), 0);
});
test('A05 T29 constructor root enumeration precedes scheduler creation', () => {
  assert.deepEqual([...asyncRoots({})], []);
});
test('A05 T29 async descriptors validate closed signatures and reachable compiler methods', () => {
  const good = descriptor(TASK + '`1<int>', 'GetAwaiter', RESULT_AWAITER);
  assert.equal(asyncMethodDefinition(good).operation, 'task-awaiter');
  assert.equal(asyncMethodDefinition({
    ...good,
    signature: {
      ...good.signature,
      returnType: AWAITER
    }
  }), null);
  assert.equal(asyncMethodDefinition({
    ...good,
    signature: {
      ...good.signature,
      isStatic: true
    }
  }), null);
  assert.equal(asyncMethodDefinition({
    ...good,
    signature: {
      ...good.signature,
      callingConvention: 1
    }
  }), null);
  const custom = {
    ...descriptor(BUILDER, 'AwaitUnsafeOnCompleted', 'void', ['CustomAwaiter&', 'Machine&']),
    methodArguments: ['CustomAwaiter', 'Machine']
  };
  custom.signature.genericArity = 2;
  assert.equal(asyncMethodDefinition(custom), null);
  const inspector = new AssemblyInspector(asyncFixture()),
    start = {
      ...descriptor(BUILDER, 'Start', 'void', ['Machine&']),
      genericArguments: ['Machine'],
      signature: {
        ...descriptor(BUILDER, 'Start', 'void', ['Machine&']).signature,
        genericArity: 1
      }
    };
  assert.deepEqual([...reachableAsyncMethods(inspector, start)], [0x06000002]);
  assert(verifyCilAssembly(inspector).success);
  assert.equal(asyncTypeDefinition('System.Runtime.CompilerServices.ValueTaskAwaiter'), null);
});

function builderVm() {
  return new CilVirtualMachine(controlFixture([{
    name: 'Program',
    methods: [{
      name: 'Main',
      localBytes: c => {
        const w = new Writer().u8(7).u8(4);
        for (const name of [BUILDER, BUILDER, 'System.Runtime.CompilerServices.AsyncVoidMethodBuilder', AWAITER]) asyncSignatureType(w,
          name, c);
        return w.finish();
      },
      body: w => w.op('ret')
    }]
  }]), {
    virtualTime: true
  });
}
test('A05 T29 builder default copies materialize distinct task identities and reject double completion', () => {
  const vm = builderVm(),
    first = address(vm, 'local', 0),
    second = address(vm, 'local', 1),
    get = descriptor(BUILDER, 'get_Task', TASK + '`1<int>');
  const a = invokeAsyncIntrinsic(vm, get, [first]).value,
    b = invokeAsyncIntrinsic(vm, get, [second]).value;
  assert.notEqual(a.h, b.h);
  invokeAsyncIntrinsic(vm, descriptor(BUILDER, 'SetResult', 'void', ['int']), [first, 42]);
  assert.equal(vm.scheduler.taskRecord(a).result, 42);
  assert.throws(() => invokeAsyncIntrinsic(vm, descriptor(BUILDER, 'SetResult', 'void', ['int']), [first, 43]), error => error.name ===
    'InvalidOperationException');
  assert.throws(() => invokeAsyncIntrinsic(vm, descriptor(BUILDER, 'SetException', 'void', ['System.Exception']), [second, null]), error => error
    .name === 'ArgumentNullException');
  assert.throws(() => invokeAsyncIntrinsic(vm, get, [Object.freeze({
    ...second,
    readonly: true
  })]), error => error.name === 'InvalidProgramException');
  assert.throws(() => invokeAsyncIntrinsic(builderVm(), get, [second]), error => error.name === 'InvalidProgramException');
});
test('A05 T29 default and wrong-task awaiters fail deterministically', () => {
  const vm = builderVm(),
    empty = address(vm, 'local', 3),
    getResult = descriptor(AWAITER, 'GetResult', 'void');
  assert.throws(() => invokeAsyncIntrinsic(vm, getResult, [empty]), error => error.name === 'NullReferenceException');
  const task = vm.scheduler.createTask('int');
  vm.dereference(empty, true, createValue(vm, AWAITER, [task.ref]));
  assert.throws(() => invokeAsyncIntrinsic(vm, getResult, [empty]), error => error.name === 'InvalidProgramException');
});
test('A05 T29 default YieldAwaiter is valid and always asynchronous', () => {
  const vm = builderVm(),
    owner = 'System.Runtime.CompilerServices.YieldAwaitable+YieldAwaiter',
    value = createValue(vm, owner);
  assert.equal(invokeAsyncIntrinsic(vm, descriptor(owner, 'get_IsCompleted', 'bool'), [value]).value, 0);
  assert.equal(invokeAsyncIntrinsic(vm, descriptor(owner, 'GetResult', 'void'), [value]).value, null);
  assert.throws(() => invokeAsyncIntrinsic(vm, descriptor(owner, 'OnCompleted', 'void', ['System.Action']), [value, null]), error => error
    .name === 'ArgumentNullException');
});
test('A05 T29 TaskAwaiter.OnCompleted resumes a verified managed delegate', async () => {
  const bytes = controlFixture([{
    name: 'Program',
    methods: [{
        name: 'Main',
        localBytes: c => asyncSignatureType(new Writer().u8(7).u8(1), AWAITER, c).finish(),
        body: (w, c) => {
          w.op('ldc.i4.5').op('call', c.member(TASK, 'Delay', TASK, ['int'])).op('callvirt', c.member(TASK, 'GetAwaiter', AWAITER, [],
              false)).op('stloc.0')
            .op('ldloca.s', 0).op('ldnull').op('ldftn', c.methods.get('Program.Callback')).op('newobj', c.member('System.Action',
              '.ctor', 'void', ['object', 'nint'], false))
            .op('call', c.member(AWAITER, 'OnCompleted', 'void', ['System.Action'], false)).op('ret');
        }
      },
      {
        name: 'Callback',
        body: (w, c) => w.op('ldc.i4', 42).op('call', c.member('System.Console', 'WriteLine', 'void', ['int'])).op('ret')
      }
    ]
  }]);
  const vm = new CilVirtualMachine(bytes, {
    virtualTime: true
  });
  assert.equal(vm.run().state, 'waiting');
  const snapshot = vm.snapshot();
  const result = await vm.runAsync();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.output, '42\n');
  vm.restore(snapshot);
  vm.heap.collect();
  assert.equal((await vm.runAsync()).output, result.output);
});
test('A05 T29 async void faults are posted outside the synchronous caller and snapshotted', () => {
  const vm = builderVm(),
    pointer = address(vm, 'local', 2),
    message = vm.heap.string('async void'),
    ref = vm.heap.allocate('exception', 'System.Exception', [message], [message]);
  invokeAsyncIntrinsic(vm, descriptor('System.Runtime.CompilerServices.AsyncVoidMethodBuilder', 'SetException', 'void', ['System.Exception']), [
    pointer, ref
  ]);
  assert.notEqual(vm.state, 'faulted');
  const snapshot = vm.snapshot();
  vm.scheduler.beforeSlice();
  assert.equal(vm.state, 'faulted');
  assert.equal(vm.fault.message, 'async void');
  vm.restore(snapshot);
  vm.scheduler.beforeSlice();
  assert.equal(vm.state, 'faulted');
  assert.equal(vm.fault.message, 'async void');
});
test('A05 T29 malformed async snapshots reject before live execution changes', () => {
  const vm = waitingVm(),
    foreign = waitingVm(),
    foreignTask = builderTask(foreign),
    live = {
      heap: vm.heap.records,
      frames: vm.frames,
      tasks: vm.scheduler.tasks,
      contexts: vm.scheduler.contexts,
      output: vm.output,
      instructions: vm.instructions,
      revision: vm.heap.mutationRevision,
      types: vm.heap.methodTables.nextToken
    };
  const corruptions = [
    (s, t) => {
      t.asyncState = null;
    },
    (s, t) => {
      t.asyncState.phase = 'resuming';
    },
    (s, t) => {
      t.asyncState.phase = 'created';
    },
    (s, t) => {
      t.asyncState.builderType = AWAITER;
    },
    (s, t) => {
      t.asyncState.kind = 'void';
    },
    (s, t) => {
      t.resultType = 'string';
    },
    (s, t) => {
      t.asyncState.machine = t.ref;
    },
    (s, t) => {
      t.asyncState.machine = foreignTask.asyncState.machine;
    },
    (s, t) => {
      t.asyncState.awaitedTask = foreignTask.asyncState.awaitedTask;
    },
    (s, t) => {
      t.asyncState.awaitedTask = t.ref;
    },
    (s, t) => {
      t.asyncState.moveNext = 0x06000001;
    },
    (s, t) => {
      t.asyncState.moveNext = 0x060000ff;
    },
    (s, t) => {
      t.asyncState.contextId = s.scheduler.nextId;
    },
    (s, t) => {
      t.contextId = 1;
    },
    (s, t, c) => {
      c.wait.propagateFault = true;
    },
    (s, t, c) => {
      c.wait = null;
    },
    (s, t, c) => {
      c.frames[0].asyncBuilderTask = t.asyncState.awaitedTask;
    },
    (s, t, c) => {
      c.frames[0].asyncBuilderTask = foreignTask.ref;
    },
    (s, t, c) => {
      c.frames[0].args[0] = Object.freeze({
        ...c.frames[0].args[0],
        vmOwner: foreign.snapshotOwner
      });
    },
    (s, t, c) => {
      c.frames[0].args[0] = Object.freeze({
        ...c.frames[0].args[0],
        owner: t.ref
      });
    },
    (s, t) => {
      const record = s.heap.records[t.ref.h],
        data = [...record.data];
      data[data.indexOf('Id') + 1]++;
      s.heap.records[t.ref.h] = {
        ...record,
        data
      };
    },
    (s, t) => {
      const record = s.heap.records[t.ref.h],
        data = [...record.data];
      data[data.indexOf('$status') + 1] = 'completed';
      s.heap.records[t.ref.h] = {
        ...record,
        data
      };
    }
  ];
  for (const corrupt of corruptions) {
    const snapshot = vm.snapshot(),
      task = snapshot.scheduler.tasks.find(([, task]) => task.asyncState)[1],
      context = snapshot.scheduler.contexts.find(([id]) => id === task.asyncState.contextId)[1];
    corrupt(snapshot, task, context);
    assert.throws(() => vm.restore(snapshot), TypeError);
    assert.equal(vm.heap.records, live.heap);
    assert.equal(vm.frames, live.frames);
    assert.equal(vm.scheduler.tasks, live.tasks);
    assert.equal(vm.scheduler.contexts, live.contexts);
    assert.equal(vm.output, live.output);
    assert.equal(vm.instructions, live.instructions);
    assert.equal(vm.heap.mutationRevision, live.revision);
    assert.equal(vm.heap.methodTables.nextToken, live.types);
  }
});
test('A05 T29 awaiting snapshots accept the wake-up boundary before GetResult', async () => {
  const vm = waitingVm();
  vm.scheduler.advance(5);
  const task = builderTask(vm);
  assert.equal(task.asyncState.phase, 'awaiting');
  assert.equal(vm.scheduler.contexts.get(task.asyncState.contextId).wait, null);
  const snapshot = vm.snapshot();
  assert.equal(validateAsyncSnapshot(vm, snapshot), snapshot);
  vm.restore(snapshot);
  const result = await vm.runAsync();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.output, '42\n');
});
test('A05 T29 snapshot validation uses saved roots after the live machine is collected', async () => {
  const vm = waitingVm(),
    saved = vm.snapshot(),
    machine = builderTask(vm).asyncState.machine;
  vm.stop();
  vm.heap.collect();
  assert.throws(() => vm.heap.get(machine));
  assert.equal(validateAsyncSnapshot(vm, saved), saved);
  vm.restore(saved);
  const result = await vm.runAsync();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.output, '42\n');
});
test('A05 T29 canceled task history remains restorable after its machine is collected', () => {
  const vm = waitingVm(),
    task = builderTask(vm),
    machine = task.asyncState.machine;
  vm.stop();
  vm.heap.collect();
  assert.throws(() => vm.heap.get(machine));
  assert.equal(task.asyncState.phase, 'awaiting');
  assert.equal(task.status, 'canceled');
  const saved = vm.snapshot();
  assert.equal(validateAsyncSnapshot(vm, saved), saved);
  vm.restore(saved);
  assert.equal(vm.state, 'terminated');
  assert.equal([...asyncRoots(vm)].length, 0);
});
