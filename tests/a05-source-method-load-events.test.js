import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, RuntimeEventName} from '@sharpforge/runtime';

const program = `class Program {
  static int Child(int value) { return value + 1; }
  static void Uncalled() {}
  static void Main() { Console.WriteLine(Child(Child(40))); }
}`;
const cache = new Map();
function make(engine, source = program, options = {}) {
  let artifact = cache.get(source);
  if (!artifact) {
    artifact = compileToIL(source);
    assert.equal(artifact.success, true, JSON.stringify(artifact.diagnostics));
    cache.set(source, artifact);
  }
  return new VirtualMachine(engine === 'source' ? artifact.image : artifact.assembly, {runtimeEvents: true, ...options});
}
const loads = vm => vm.runtimeEvents.read().filter(event => event.name === RuntimeEventName.MethodLoad);
const method = (vm, name) => vm.image.methods.find(item => item.name === name);

for (const engine of ['source', 'reload']) {
  test(`${engine}: first successful admission loads each metadata method once before entry`, () => {
    const vm = make(engine), delivered = [];
    const unsubscribe = vm.runtimeEvents.subscribe(event => delivered.push(event), {replay: true});
    try {
      assert.deepEqual(delivered, []);
      assert.deepEqual(vm.runtimeEvents.read().map(event => event.name), ['MethodLoad', 'MethodEnter']);
      const entry = vm.image.methods[vm.top.methodId], first = loads(vm)[0];
      assert.equal(first.instruction, 0);
      assert.deepEqual(first.payload, {method: entry.id, name: entry.qualifiedName ?? entry.owner + '::' + entry.name});
      assert.equal(vm.run().output, '42\n');
      const child = method(vm, 'Child'), childLoads = loads(vm).filter(event => event.payload.method === child.id);
      assert.equal(childLoads.length, 1);
      const events = vm.runtimeEvents.read();
      const childEntries = events.filter(event => event.name === 'MethodEnter' && event.payload.method === child.id);
      assert.equal(childEntries.length, 2);
      assert.equal(childEntries[0].sequence, childLoads[0].sequence + 1);
      assert.equal(childEntries[0].instruction, childLoads[0].instruction);
      assert.equal(loads(vm).some(event => event.payload.method === method(vm, 'Uncalled').id), false);
      assert(loads(vm).every(event => Object.isFrozen(event.payload) &&
        Object.keys(event.payload).sort().join(',') === 'method,name'));
      assert.deepEqual(delivered, events);
    } finally { unsubscribe(); vm.stop(); }
  });

  test(`${engine}: snapshot replay and subscriber replay preserve one load per observed metadata object`, () => {
    const vm = make(engine);
    let unsubscribe = () => {};
    try {
      const snapshot = vm.snapshot();
      assert.equal(vm.run().output, '42\n');
      const history = loads(vm), cursor = vm.runtimeEvents.sequence;
      vm.restore(snapshot);
      assert.deepEqual(loads(vm), history);
      assert.equal(vm.run().output, '42\n');
      assert.deepEqual(loads(vm), history);
      assert.equal(vm.runtimeEvents.read({after: cursor}).some(event => event.name === 'MethodLoad'), false);
      const replay = [];
      unsubscribe = vm.runtimeEvents.subscribe(event => {
        if (event.name === 'MethodLoad') replay.push(event);
      }, {replay: true});
      vm.runtimeEvents.flush();
      assert.deepEqual(replay, history);
      vm.runtimeEvents.flush();
      assert.deepEqual(replay, history, 'Subscriber replay does not recreate or duplicate load records');
    } finally { unsubscribe(); vm.stop(); }
  });

  test(`${engine}: a replaced method object keeps its ID but has an independent load boundary`, () => {
    const source = `class Program {
      static void Child() {}
      static void Main() { Child(); Console.Write("replace"); Child(); Child(); }
    }`;
    const vm = make(engine, source, {onOutput: text => {
      if (text !== 'replace') return;
      const original = method(vm, 'Child');
      const replacement = {...original, qualifiedName: 'Updated.Program.Child'};
      vm.image = {...vm.image, methods: vm.image.methods.map(item => item === original ? replacement : item)};
    }});
    try {
      assert.equal(vm.run().state, 'terminated', vm.fault?.message);
      const child = method(vm, 'Child'), observed = loads(vm).filter(event => event.payload.method === child.id);
      assert.equal(observed.length, 2);
      assert.notEqual(observed[0].payload.name, observed[1].payload.name);
      assert.equal(observed[1].payload.name, 'Updated.Program.Child');
      const entries = vm.runtimeEvents.read().filter(event => event.name === 'MethodEnter' && event.payload.method === child.id);
      assert.equal(entries.length, 3);
      assert.equal(entries[1].sequence, observed[1].sequence + 1);
    } finally { vm.stop(); }
  });

  test(`${engine}: rejected admission never reports an unseen method as loaded`, () => {
    const vm = make(engine);
    try {
      const target = method(vm, 'Uncalled'), history = vm.runtimeEvents.export();
      vm.options.maxFrames = vm.frames.length;
      assert.throws(() => vm.call(target.id, []), {name: 'StackOverflowException'});
      assert.deepEqual(vm.runtimeEvents.export(), history);
      assert.equal(loads(vm).some(event => event.payload.method === target.id), false);
    } finally { vm.stop(); }
  });

  test(`${engine}: load names retain the CIL observer's 4096-character bound`, () => {
    const vm = make(engine);
    try {
      const child = method(vm, 'Child'), name = 'Long.' + 'Name'.repeat(1100);
      vm.image = {...vm.image, methods: vm.image.methods.map(item => item === child ? {...item, qualifiedName: name} : item)};
      assert.equal(vm.run().output, '42\n');
      const event = loads(vm).find(event => event.payload.method === child.id);
      assert.equal(event.payload.name, name.slice(0, 4096));
      assert.equal(event.payload.name.length, 4096);
    } finally { vm.stop(); }
  });

  test(`${engine}: dropping a load record does not reload an unchanged method; disabled observation stays off`, () => {
    const vm = make(engine, program, {runtimeEvents: {capacity: 1}});
    const plain = make(engine, program, {runtimeEvents: false});
    try {
      assert.equal(vm.runtimeEvents.read()[0].name, 'MethodEnter');
      assert.equal(vm.runtimeEvents.dropped, 1, 'Entry admission records load followed by enter even with capacity one');
      const target = method(vm, 'Uncalled'), before = vm.runtimeEvents.sequence;
      vm.call(target.id, []);
      assert.equal(vm.runtimeEvents.sequence, before + 2);
      assert.equal(vm.runtimeEvents.read()[0].name, 'MethodEnter', 'The load was already evicted');
      vm.call(target.id, []);
      assert.equal(vm.runtimeEvents.sequence, before + 3, 'Unchanged metadata emits only another enter');
      assert.equal(vm.runtimeEvents.dropped, vm.runtimeEvents.sequence - 1);
      assert.equal(plain.runtimeEvents, null);
      assert.equal(plain.run().output, '42\n');
    } finally { vm.stop(); plain.stop(); }
  });
}
