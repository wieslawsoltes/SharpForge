import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {FORMAT_VERSION, Op, float, nativeInteger, decimalParse} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine, ManagedHeap, ManagedFault, isReference} from '@sharpforge/runtime';
import {visitFrameRoots, visitVMRoots} from '../packages/runtime/src/execution/frame-roots.js';
import {popPooledFrame} from '../packages/runtime/src/execution/frame-retirement.js';
import {flushFramePool} from '../packages/runtime/src/execution/frame-pool.js';
import {managedFixture} from './managed-fixtures.js';

const localTypes = ['object', 'int', 'double', 'object&'];
function make(engine, options = {}, types = localTypes) {
  if (engine === 'cil') return new CilVirtualMachine(managedFixture({methods: [{
    name: 'Main', result: 'int', locals: types, body: writer => writer.integer(0).op('ret'),
  }]}), options);
  return new VirtualMachine({
    formatVersion: FORMAT_VERSION, entryPoint: 0, constants: [0], types: [], statics: [], sequencePoints: [], sources: [],
    methods: [{id: 0, name: 'Main', qualifiedName: 'Main', owner: null, isStatic: true, returnType: 'int',
      parameters: [], handlers: [], locals: types.map((type, slot) => ({type, slot, name: 'local' + slot})),
      code: Int32Array.from([Op.CONST, 0, 0, Op.RET, 0, 0])}],
  }, options);
}

function alive(heap, reference) { assert.doesNotThrow(() => heap.get(reference)); }
function dead(heap, reference) { assert.throws(() => heap.get(reference), {name: 'InvalidReferenceException'}); }
const identity = reference => `${reference.h}:${reference.g}`;

test('heap collection accepts visitor and legacy iterable providers with pins, extras and handles', () => {
  const heap = new ManagedHeap();
  const provided = heap.object('object', []), pinned = heap.object('object', []), extra = heap.object('object', []);
  const strong = heap.object('object', []), weak = heap.object('object', []);
  const strongHandle = heap.createHandle(strong), weakHandle = heap.createHandle(weak, {weak: true});
  heap.rootProvider = visit => { visit(provided); };
  heap.pins.push(pinned);
  heap.collect([extra]);
  for (const reference of [provided, pinned, extra, strong]) alive(heap, reference);
  assert.equal(heap.getHandle(weakHandle), null);
  heap.rootProvider = function* () { yield provided; };
  heap.collect([extra]);
  alive(heap, provided);
  heap.pins.length = 0;
  heap.releaseHandle(strongHandle);
  heap.rootProvider = () => [];
  heap.collect();
  for (const reference of [provided, pinned, extra, strong]) dead(heap, reference);
});

test('the declared scalar proof never hides a handle or byref embedded in a numeric-looking carrier', () => {
  const vm = make('cil', {nativeIntBits: 64});
  const reference = vm.heap.object('object', []), owner = vm.heap.object('object', []);
  const candidates = [
    ['float', Object.freeze({...reference, float: 'r4', value: 0})],
    ['nint', Object.freeze({...reference, ...nativeInteger(0, 64)})],
    ['System.Decimal', Object.freeze({...reference, ...decimalParse('0')})],
    ['double', Object.freeze({byref: true, owner, float: 'r8', value: 0})],
  ];
  for (const [type, value] of candidates) {
    const seen = [];
    const frame = {method: {locals: [type], signature: {isStatic: true, parameters: []}}, locals: [value]};
    visitFrameRoots(vm, frame, root => seen.push(root));
    assert.deepEqual(seen, [value.byref ? owner : value]);
  }
});

for (const engine of ['source', 'cil']) {
  for (const preciseRoots of [true, false]) {
    test(`${engine} preciseRoots=${preciseRoots}: live slots, owned addresses and host edits retain the same graph`, () => {
      const vm = make(engine, {preciseRoots}), child = vm.heap.string('child');
      const aggregate = vm.heap.object('object', [child]), edited = vm.heap.object('object', []);
      const owner = vm.heap.object('object', []), unused = vm.heap.object('object', []);
      vm.top.locals[0] = aggregate;
      vm.top.locals[1] = edited; // A host write violates the declared Int32 type.
      vm.top.locals[2] = float(1.25);
      vm.top.locals[3] = {byref: true, kind: 'field', index: 0, owner};
      const weak = vm.heap.createHandle(aggregate, {weak: true});
      vm.heap.collect();
      for (const value of [aggregate, child, edited, owner]) alive(vm.heap, value);
      assert.equal(vm.heap.getHandle(weak), aggregate);
      dead(vm.heap, unused);
      assert.equal(vm.top.locals[0], aggregate, 'collection never clears locals using liveness');
      vm.top.locals.fill(null);
      vm.heap.collect();
      for (const value of [aggregate, child, edited, owner]) dead(vm.heap, value);
      assert.equal(vm.heap.getHandle(weak), null);
    });

    test(`${engine} preciseRoots=${preciseRoots}: parked contexts and resumed faults retain their references`, () => {
      const vm = make(engine, {preciseRoots});
      vm.scheduler.ensure();
      const values = Array.from({length: 8}, () => vm.heap.object('object', []));
      const frame = {...vm.top, id: 123, locals: [values[0]], args: [{byref: true, owner: values[1]}],
        stack: [values[2]], returnObject: values[3], caught: [], unwinds: []};
      const context = {id: 2, status: 'waiting', frames: [frame], stack: [], task: values[4],
        wait: {task: values[5]}, resumeFault: new ManagedFault('Exception', 'resumed', values[6]),
        pendingFault: new ManagedFault('Exception', 'pending', values[7])};
      vm.scheduler.contexts.set(2, context);
      vm.heap.collect();
      for (const value of values) alive(vm.heap, value);
      context.status = 'completed';
      vm.heap.collect();
      for (const value of values) dead(vm.heap, value);
    });

    test(`${engine} preciseRoots=${preciseRoots}: EH continuations and retired frames stay live until released`, () => {
      const vm = make(engine, {preciseRoots});
      const values = Array.from({length: 5}, () => vm.heap.object('object', []));
      vm.top.locals[0] = values[0];
      vm.top.exception = new ManagedFault('Exception', 'caught', values[1]);
      vm.top.caught.push({fault: new ManagedFault('Exception', 'outer', values[2])});
      vm.top.unwinds.push({value: values[3]});
      vm.top.pending = {error: new ManagedFault('Exception', 'pending', values[4])};
      const retired = popPooledFrame(vm);
      vm.heap.collect();
      for (const value of values) alive(vm.heap, value);
      assert.equal(retired.locals[0], values[0]);
      flushFramePool(vm);
      vm.heap.collect();
      for (const value of values) dead(vm.heap, value);
      assert.equal(retired.locals.length, 0);
    });

    test(`${engine} preciseRoots=${preciseRoots}: snapshot restore rebuilds live roots without storing visitor functions`, () => {
      const vm = make(engine, {preciseRoots}), reference = vm.heap.object('object', []);
      vm.top.locals[0] = reference;
      const saved = vm.snapshot();
      vm.top.locals[0] = null;
      vm.heap.collect();
      dead(vm.heap, reference);
      vm.restore(saved);
      vm.heap.collect();
      alive(vm.heap, reference);
      assert.equal(vm.top.locals[0], reference);
      assert.equal(vm.heap.retentionPath(reference).reachable, true);
      assert.equal(vm.run().state, 'terminated');
      vm.heap.collect();
      dead(vm.heap, reference);
    });
  }

  test(`${engine}: visitor and iterable wrappers preserve the same ordered managed-reference inventory`, () => {
    const vm = make(engine);
    vm.top.locals[0] = vm.heap.object('object', []);
    vm.top.locals[1] = 12;
    vm.top.locals[2] = float(1.25);
    vm.top.unwinds.push({value: vm.heap.object('object', [])});
    vm.fault = new ManagedFault('Exception', 'fault', vm.heap.object('object', []));
    const visited = [];
    visitVMRoots(vm, value => { if (isReference(value)) visited.push(identity(value)); });
    const iterable = [...vm.roots()].filter(isReference).map(identity);
    assert.deepEqual(visited, iterable);
    assert.equal(typeof vm.roots().next, 'function');
  });

  test(`${engine}: global platform, metadata, static, string and fault roots remain reachable`, () => {
    const vm = make(engine), references = [];
    const allocate = () => {
      const reference = vm.heap.object('object', []);
      references.push(reference);
      return reference;
    };
    const platformRoot = allocate();
    vm.platform.roots = function* () { yield platformRoot; };
    vm.returnValue = allocate();
    vm.fault = new ManagedFault('Exception', 'fault', allocate());
    vm.pendingFault = new ManagedFault('Exception', 'pending', allocate());
    vm.strings.set('literal', allocate());
    vm.typeObjects = new Map([['type', allocate()]]);
    if (engine === 'cil') {
      vm.statics.set(0, allocate());
      vm.initialized.set('initializing', {waitTask: allocate(), fault: new ManagedFault('Exception', 'init', allocate())});
      vm.top.stack.push(allocate());
    } else {
      vm.statics.push(allocate());
      vm.constantValues.set(0, allocate());
      vm.stack.push(allocate());
    }
    vm.heap.collect();
    for (const reference of references) alive(vm.heap, reference);
  });

  test(`${engine}: canonical scalar slots are omitted while the reference slot still survives collection`, () => {
    const vm = make(engine, {}, [...Array(500).fill('int'), 'object']);
    vm.top.locals.fill(42, 0, 500);
    const reference = vm.heap.object('object', []);
    vm.top.locals[500] = reference;
    vm.options.preciseRoots = false;
    vm.heap.collect();
    const generic = vm.heap.stats.rootsScanned;
    alive(vm.heap, reference);
    vm.options.preciseRoots = true;
    vm.heap.collect();
    assert.equal(generic - vm.heap.stats.rootsScanned, 500);
    alive(vm.heap, reference);
  });

  test(`${engine}: later host root overrides continue to participate in collection`, () => {
    const vm = make(engine), reference = vm.heap.object('object', []), original = vm.roots;
    vm.roots = function* () { yield* original.call(this); yield reference; };
    vm.heap.collect();
    alive(vm.heap, reference);
    delete vm.roots;
    vm.heap.collect();
    dead(vm.heap, reference);
  });
}

test('source, emitted CIL and reloaded source retain allocated strings through an explicit collection', () => {
  const result = compileToIL('string text = "root-" + 42; GC.Collect(); Console.WriteLine(text);');
  assert(result.success, JSON.stringify(result.diagnostics));
  for (const preciseRoots of [true, false]) {
    for (const vm of [new VirtualMachine(result.image, {preciseRoots}),
      new CilVirtualMachine(result.assembly, {preciseRoots}), new VirtualMachine(result.assembly, {preciseRoots})]) {
      const actual = vm.run();
      assert.equal(actual.state, 'terminated', actual.fault?.stack);
      assert.equal(actual.output, 'root-42\n');
    }
  }
});
