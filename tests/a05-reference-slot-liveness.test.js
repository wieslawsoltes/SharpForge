import test from 'node:test';
import assert from 'node:assert/strict';
import {FORMAT_VERSION, Op} from '@sharpforge/bytecode';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {slotLiveness, liveSlot} from '../packages/runtime/src/execution/slot-liveness.js';
import {captureFrameSlot} from '../packages/runtime/src/execution/frame-root-liveness.js';
import {managedFixture} from './managed-fixtures.js';

function make(engine, options = {}) {
  options = {preciseRootLiveness: true, ...options};
  if (engine === 'cil') return new CilVirtualMachine(managedFixture({methods: [{
    name: 'Main', result: 'int', locals: ['object', 'int'],
    body: writer => writer.op('ldloc.0').op('pop').op('nop').op('ldc.i4.0').op('ret'),
  }]}), options);
  return new VirtualMachine({
    formatVersion: FORMAT_VERSION, entryPoint: 0, constants: [0], types: [], statics: [], sequencePoints: [], sources: [],
    methods: [{id: 0, name: 'Main', qualifiedName: 'Main', isStatic: true, returnType: 'int', parameters: [], handlers: [],
      locals: [{slot: 0, name: 'value', type: 'object'}, {slot: 1, name: 'numeric', type: 'int'}],
      code: Int32Array.from([Op.LDLOC, 0, 0, Op.POP, 0, 0, Op.NOP, 0, 0, Op.CONST, 0, 0, Op.RET, 0, 0])}],
  }, options);
}
const alive = (vm, value) => assert.doesNotThrow(() => vm.heap.get(value));
const dead = (vm, value) => assert.throws(() => vm.heap.get(value), {name: 'InvalidReferenceException'});
const advance = (vm, count = 2) => vm.runSlice({instructionBudget: count, timeBudgetMs: 1000});

for (const engine of ['source', 'cil']) {
  test(`${engine}: validated last-use pruning clears a dead handle before snapshot capture`, () => {
    const vm = make(engine), value = vm.heap.object('object', []), weak = vm.heap.createHandle(value, {weak: true});
    vm.top.locals[0] = value;
    try {
      advance(vm, 1);
      vm.heap.collect();
      alive(vm, value);
      assert.equal(vm.top.locals[0], value, 'the current/previous instruction input remains conservative');
      advance(vm, 1);
      vm.heap.collect();
      dead(vm, value);
      assert.equal(vm.heap.getHandle(weak), null);
      assert.equal(vm.top.locals[0], undefined);
      const saved = vm.snapshot();
      vm.restore(saved);
      assert.equal(vm.top.locals[0], undefined);
      assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    } finally { vm.stop(); }
  });

  test(`${engine}: conservative modes retain local visibility after last use`, () => {
    for (const options of [{preciseRootLiveness: false}, {preciseRoots: false}]) {
      const vm = make(engine, options), value = vm.heap.object('object', []);
      vm.top.locals[0] = value;
      try {
        advance(vm);
        vm.heap.collect();
        alive(vm, value);
        assert.equal(vm.top.locals[0], value);
      } finally { vm.stop(); }
    }
  });

  test(`${engine}: captured local metadata survives snapshot and prevents premature collection`, () => {
    const vm = make(engine), value = vm.heap.object('object', []);
    vm.top.locals[0] = value;
    captureFrameSlot(vm.top, 'local', 0);
    try {
      advance(vm);
      const saved = vm.snapshot();
      vm.heap.collect();
      alive(vm, value);
      vm.restore(saved);
      assert(vm.top.rootCaptures.locals.has(0));
      vm.state = 'running';
      vm.heap.collect();
      alive(vm, value);
      assert.equal(vm.top.locals[0], value);
    } finally { vm.stop(); }
  });

  test(`${engine}: parked and debugger-inspected frames retain their reference locals`, () => {
    const vm = make(engine), value = vm.heap.object('object', []);
    vm.top.locals[0] = value;
    try {
      advance(vm);
      vm.state = 'paused';
      vm.heap.collect();
      alive(vm, value);
      vm.state = 'running';
      vm.scheduler.freeze(1);
      vm.runSlice();
      assert.equal(vm.scheduler.parked, true);
      vm.heap.collect();
      alive(vm, value);
      const context = vm.scheduler.current;
      vm.scheduler.freeze(1, false);
      vm.scheduler.load(context);
      vm.heap.collect();
      dead(vm, value);
      assert.equal(vm.top.locals[0], undefined);
    } finally { vm.stop(); }
  });

  test(`${engine}: host metadata edits and noncanonical handles cannot authorize pruning`, () => {
    const vm = make(engine), first = vm.heap.object('object', []), second = vm.heap.object('object', []);
    vm.top.locals[0] = Object.freeze({...first});
    vm.top.locals[1] = second;
    try {
      advance(vm);
      vm.heap.collect();
      alive(vm, first);
      alive(vm, second);
      const method = vm.top.method ?? vm.image.methods[vm.top.methodId];
      if (engine === 'cil') method.locals[0] = 'int';
      else method.locals[0].type = 'int';
      vm.top.locals[0] = first;
      vm.heap.collect();
      alive(vm, first);
      assert.equal(vm.top.locals[0], first);
    } finally { vm.stop(); }
  });

  test(`${engine}: exact body proof invalidates cached pruning after an in-place code edit`, () => {
    const vm = make(engine), value = vm.heap.object('object', []);
    vm.top.locals[0] = value;
    try {
      vm.heap.collect();
      alive(vm, value);
      advance(vm);
      const method = vm.top.method ?? vm.image.methods[vm.top.methodId];
      if (engine === 'cil') method.instructions[0].name = 'nop';
      else method.code[0] = Op.NOP;
      vm.heap.collect();
      alive(vm, value);
      if (engine === 'cil') method.instructions[0].name = 'ldloc.0';
      else method.code[0] = Op.LDLOC;
      vm.heap.collect();
      dead(vm, value);
    } finally { vm.stop(); }
  });

  test(`${engine}: pending filters, delegates and array continuations keep locals conservative`, () => {
    const vm = make(engine), value = vm.heap.object('object', []);
    vm.top.locals[0] = value;
    try {
      advance(vm);
      for (const property of ['filterSearch', 'delegateContinuation', 'intrinsicContinuation', 'exceptionEventContinuation']) {
        vm.top[property] = {};
        vm.heap.collect();
        alive(vm, value);
        vm.top[property] = null;
      }
      vm.heap.collect();
      dead(vm, value);
    } finally { vm.stop(); }
  });
}

test('CIL addresses created by a host preserve slots absent any ldloca in the method body', () => {
  const vm = make('cil'), value = vm.heap.object('object', []);
  vm.top.locals[0] = value;
  const address = vm.address('local', 0);
  try {
    advance(vm);
    vm.heap.collect();
    alive(vm, value);
    assert.equal(vm.dereference(address), value);
    vm.run();
    vm.heap.collect();
    dead(vm, value);
    assert.throws(() => vm.dereference(address), {name: 'InvalidProgramException'});
  } finally { vm.stop(); }
});

function cilMethod(instructions, options = {}) {
  return {signature: {isStatic: true, parameters: []}, locals: ['object'], handlers: [],
    instructions: instructions.map((instruction, offset) => ({offset, ...instruction})), ...options};
}

test('normal CFG liveness follows loop backedges, switch edges and explicit overwrites', () => {
  const loop = cilMethod([{name: 'ldloc.0'}, {name: 'pop'}, {name: 'br.s', operand: 0}]);
  assert.equal(liveSlot(slotLiveness(loop), 2, 0), true);
  const branch = cilMethod([{name: 'switch', operand: [2, 4]}, {name: 'ret'}, {name: 'ldloc.0'},
    {name: 'pop'}, {name: 'ret'}]);
  const plan = slotLiveness(branch);
  assert.equal(liveSlot(plan, 0, 0), true);
  assert.equal(liveSlot(plan, 1, 0), false);
  assert.equal(liveSlot(plan, 4, 0), false);
  const overwritten = cilMethod([{name: 'ldnull'}, {name: 'stloc.0'}, {name: 'ldloc.0'}, {name: 'pop'}, {name: 'ret'}]);
  assert.equal(liveSlot(slotLiveness(overwritten), 0, 0), false);
  assert.equal(liveSlot(slotLiveness(overwritten), 2, 0), true);
});

test('address-taken slots and implicit jmp arguments remain live throughout the method', () => {
  const address = cilMethod([{name: 'ldloca.s', operand: 0}, {name: 'pop'}, {name: 'nop'}, {name: 'ret'}]);
  assert.equal(liveSlot(slotLiveness(address), 3, 0), true);
  const jump = cilMethod([{name: 'nop'}, {name: 'jmp', operand: 0x06000002}],
    {signature: {isStatic: true, parameters: ['object']}, locals: []});
  assert.equal(liveSlot(slotLiveness(jump), 0, 0), true);
  assert.equal(liveSlot(slotLiveness(jump), 1, 0), true);
});

test('malformed and bounded-out liveness plans retain all slots', () => {
  const methods = [
    null,
    {},
    cilMethod([null]),
    cilMethod([{name: 'ldloc.s', operand: -1}, {name: 'ret'}]),
    cilMethod([{name: 'ldloc.s', operand: 1}, {name: 'ret'}]),
    cilMethod([{name: 'br', operand: 42}]),
    cilMethod([{name: 'unknown'}]),
    cilMethod([{name: 'ret'}], {handlers: [{start: 0, end: 1}]}),
    cilMethod([{name: 'ret'}], {locals: Array(4097).fill('object')}),
    {locals: [{type: 'object'}], handlers: [], code: new Int32Array(65537 * 3)},
  ];
  for (const method of methods) {
    const plan = slotLiveness(method);
    assert.equal(plan, null);
    assert.equal(liveSlot(plan, 0, 0), true);
  }
  const plan = slotLiveness(cilMethod([{name: 'ret'}]));
  for (const pc of [-1, 1, NaN, 0.5]) assert.equal(liveSlot(plan, pc, 0), true);
});

test('compiled source, reloaded source and CIL preserve output with liveness enabled', () => {
  const result = compileToIL('object value = new RootValue(); Console.WriteLine(value); GC.Collect(); Console.WriteLine(7); ' +
    'class RootValue { public RootValue() {} }');
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  for (const engine of ['source', 'reload', 'cil']) {
    const create = preciseRootLiveness => engine === 'cil'
      ? new CilVirtualMachine(result.assembly, {preciseRootLiveness})
      : new VirtualMachine(engine === 'source' ? result.image : result.assembly, {preciseRootLiveness});
    const conservative = create(false), precise = create(true);
    try {
      const expected = conservative.run(), actual = precise.run();
      assert.equal(expected.state, 'terminated', expected.fault?.message);
      assert.equal(actual.state, 'terminated', actual.fault?.message);
      assert.equal(actual.output, expected.output);
    } finally { conservative.stop(); precise.stop(); }
  }
});
