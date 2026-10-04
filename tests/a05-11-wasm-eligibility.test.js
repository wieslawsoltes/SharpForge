import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, wasmEligibility, lowerWasmIR} from '@sharpforge/runtime';
import {float} from '@sharpforge/bytecode';
import {interpretWasmInstruction} from '../packages/runtime/src/execution/wasm/interpret-ir.js';
import {cilHandlers} from '../packages/runtime/src/execution/handlers/index.js';
import {managedFixture} from './managed-fixtures.js';
import {genericCallFixture} from './support/generic-call-fixture.js';

function make(method = {}) {
  return new CilVirtualMachine(managedFixture({methods: [{name: 'Main', result: 'int',
    body: writer => writer.op('ldc.i4.2').op('ldc.i4.3').op('mul').op('ret'), ...method}]}));
}
const codes = report => report.reasons.map(reason => reason.code);

test('typed lowering reuses verified CIL and returns immutable indexed operations', () => {
  const vm = make();
  const frames = vm.frames, heapRevision = vm.heap.mutationRevision;
  const report = wasmEligibility(vm, vm.top.method);
  assert.equal(report.eligible, true, JSON.stringify(report.reasons));
  assert.equal(report.ir.nativeInstructions, 3);
  const multiply = report.ir.instructions[2];
  assert.deepEqual(multiply.inputs, ['i32', 'i32']);
  assert.equal(multiply.type, 'i32');
  assert.equal(multiply.depth, 2);
  assert.equal(multiply.requiresOperandGuards, true);
  for (const value of [report, report.reasons, report.ir, report.ir.instructions, multiply, multiply.inputs, multiply.targets]) {
    assert(Object.isFrozen(value));
  }
  assert.equal(vm.frames, frames);
  assert.equal(vm.top.pc, 0);
  assert.equal(vm.heap.mutationRevision, heapRevision);
  assert.deepEqual(lowerWasmIR(vm, vm.top.method), report.ir);
});

test('byref instructions and native-width storage report explicit fallback reasons', () => {
  const address = make({locals: ['int'], body: writer => writer.op('ldloca.s', 0).op('pop').op('ldc.i4.1').op('ret')});
  const report = wasmEligibility(address, address.top.method);
  assert(codes(report).includes('WASM_OPCODE'));
  assert.equal(report.reasons.find(reason => reason.code === 'WASM_OPCODE').offset, 0);
  assert.equal(report.ir, null);
  const native = make({locals: ['nint']});
  assert(codes(wasmEligibility(native, native.top.method)).includes('WASM_STORAGE'));
  assert.throws(() => lowerWasmIR(address, address.top.method), error =>
    error instanceof TypeError && error.reasons.some(reason => reason.code === 'WASM_OPCODE'));
});

test('exception regions and empty numeric work remain interpreted', () => {
  const vm = make({body(writer) {
    writer.mark('try').op('nop').op('leave.s', 'done');
    writer.mark('catch').op('pop').op('leave.s', 'done');
    writer.mark('done').op('ldc.i4.1').op('ret');
  }, handlers(labels, context) {
    return [{start: labels.get('try'), end: labels.get('catch'), target: labels.get('catch'),
      handlerEnd: labels.get('done'), catchType: context.resolve('System.Exception')}];
  }});
  assert(codes(wasmEligibility(vm, vm.top.method)).includes('WASM_EH'));
  const empty = make({result: 'void', body: writer => writer.op('ret')});
  assert.deepEqual(codes(wasmEligibility(empty, empty.top.method)), ['WASM_NO_NATIVE_WORK']);
});

test('exact proof rejects copied reports, replaced bodies and modified operands', () => {
  for (const mutate of [
    vm => { vm.report = {...vm.report}; },
    vm => { vm.top.method.instructions = [...vm.top.method.instructions]; },
    vm => { vm.top.method.instructions[0].name = 'ldc.i4.4'; }
  ]) {
    const vm = make();
    mutate(vm);
    assert.deepEqual(codes(wasmEligibility(vm, vm.top.method)), ['WASM_UNVERIFIED']);
  }
  assert.deepEqual(codes(wasmEligibility(make(), null)), ['WASM_NO_BODY']);
});

test('instruction and analysis-slot bounds are checked before building flow states', () => {
  const vm = make();
  assert.deepEqual(codes(wasmEligibility(vm, vm.top.method, {maxMethodInstructions: 3})), ['WASM_SIZE']);
  assert.deepEqual(codes(wasmEligibility(vm, vm.top.method, {maxAnalysisSlots: 7})), ['WASM_ANALYSIS_LIMIT']);
  assert.equal(wasmEligibility(vm, vm.top.method, {maxMethodInstructions: 4, maxAnalysisSlots: 8}).eligible, true);
  const inflated = make({maxStack: 65535, body: writer => writer.op('ldc.i4.1').op('ret')});
  assert.equal(wasmEligibility(inflated, inflated.top.method, {maxAnalysisSlots: 2}).eligible, true);
  for (const options of [{maxMethodInstructions: 0}, {maxMethodInstructions: 65537}, {maxAnalysisSlots: Infinity},
    {maxAnalysisSlots: 0.5}, {maxAnalysisSlots: 16777217}]) {
    assert.throws(() => wasmEligibility(vm, vm.top.method, options), RangeError);
  }
  assert.throws(() => wasmEligibility(vm, vm.top.method, {compile: true}), /Unknown Wasm analysis option/);
});

test('calls remain host operations and unproved return categories do not authorize native arithmetic', () => {
  const bytes = managedFixture({methods: [
    {name: 'Main', result: 'int', body: (writer, context) => writer.op('call', context.methods.Value)
      .op('ldc.i4.2').op('add').op('ret')},
    {name: 'Value', result: 'int', body: writer => writer.op('ldc.i4', 40).op('ret')}
  ]});
  const vm = new CilVirtualMachine(bytes);
  const ir = lowerWasmIR(vm, vm.top.method);
  assert.equal(ir.instructions[0].kind, 'host');
  assert.deepEqual(ir.instructions[2].inputs, ['unknown', 'i32']);
  assert.equal(ir.instructions[2].kind, 'host');
});

test('switch metadata is indexed and charged against the analysis work budget', () => {
  const vm = make({body: writer => writer.op('ldc.i4.0').op('switch', Array(64).fill('done'))
    .mark('done').op('ldc.i4.1').op('ret')});
  const ir = lowerWasmIR(vm, vm.top.method);
  assert.deepEqual(ir.instructions[1].targets, Array(64).fill(2));
  assert.deepEqual(codes(wasmEligibility(vm, vm.top.method, {maxAnalysisSlots: 4})), ['WASM_ANALYSIS_LIMIT']);
  const flow = make({body: writer => writer.op('ldc.i4.0').op('switch', Array(8).fill('done'))
    .mark('done').op('ldc.i4.1').op('ret')});
  assert.deepEqual(codes(wasmEligibility(flow, flow.top.method, {maxAnalysisSlots: 4})), ['WASM_ANALYSIS_LIMIT']);
});

test('array lengths retain native-width facts and cannot authorize i32 arithmetic', () => {
  const vm = make({body: (writer, context) => writer.op('ldc.i4.1').op('newarr', context.resolve('System.Int32'))
    .op('ldlen').op('ldc.i4.1').op('add').op('pop').op('ldc.i4.1').op('ret')});
  const add = lowerWasmIR(vm, vm.top.method).instructions[4];
  assert.deepEqual(add.inputs, ['unknown', 'i32']);
  assert.equal(add.kind, 'host');
});

test('closed generic frames share body proof while eligibility uses concrete storage', () => {
  const bytes = genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', body: (writer, context) => writer.op('ldc.i4.3')
      .op('call', context.methodSpec(context.methods.get('Program.Scale'), ['int'])).op('ret')},
    {name: 'Scale', result: 'int', parameters: ['int'], locals: ['!!0'], genericParameters: [{}],
      body: writer => writer.op('ldarg.0').op('ldc.i4.2').op('mul').op('ret')}
  ]}]);
  const vm = new CilVirtualMachine(bytes);
  try {
    for (let steps = 0; vm.top.method.name !== 'Scale' && steps < 10; steps++) vm.step();
    assert.equal(vm.top.method.name, 'Scale');
    assert.deepEqual(vm.top.method.locals, ['int']);
    const original = vm.inspector.getMethod(vm.top.method.token);
    assert.equal(original.instructions, vm.top.method.instructions);
    assert(codes(wasmEligibility(vm, original)).includes('WASM_STORAGE'));
    assert.equal(lowerWasmIR(vm, vm.top.method).instructions[2].kind, 'binary');
  } finally { vm.stop(); }
});

function runIR(vm) {
  const step = vm.step.bind(vm), reports = new WeakMap();
  vm.step = () => {
    const frame = vm.top;
    if (frame.needsInitialization) return step();
    let ir = reports.get(frame.method);
    if (!ir) reports.set(frame.method, ir = lowerWasmIR(vm, frame.method));
    const instruction = ir.instructions[frame.pc];
    if (instruction.kind === 'host') return step();
    frame.pc++;
    frame.lastOffset = instruction.offset;
    interpretWasmInstruction(vm, frame, instruction, cilHandlers.get(instruction.name));
  };
  return vm.run();
}

const loop = writer => writer.op('ldc.i4.0').op('stloc.0').mark('loop').op('ldloc.0').op('ldc.i4.1')
  .op('add').op('stloc.0').op('ldloc.0').op('ldc.i4.8').op('blt.s', 'loop').op('ldloc.0').op('ret');
for (const [name, method] of [
  ['loop', {result: 'int', locals: ['int'], body: loop}],
  ['Int64', {result: 'long', body: writer => writer.op('ldc.i8', 9007199254740993n).op('ldc.i8', 2n).op('add').op('ret')}],
  ['Single', {result: 'float', body: writer => writer.op('ldc.r4', 1.25).op('ldc.r4', 2.5).op('mul').op('ret')}],
  ['negative zero', {result: 'double', body: writer => writer.op('ldc.r8', 0).op('neg').op('ret')}],
  ['division fault', {result: 'int', body: writer => writer.op('ldc.i4.1').op('ldc.i4.0').op('div').op('ret')}]
]) {
  test(`IR reference execution preserves CIL result/fault: ${name}`, () => {
    const reference = make(method), interpreted = make(method);
    try {
      if (name === 'loop') assert.deepEqual(lowerWasmIR(interpreted, interpreted.top.method).instructions[8].targets, [2]);
      const expected = reference.run(), actual = runIR(interpreted);
      assert.equal(actual.state, expected.state);
      assert.equal(actual.fault?.name, expected.fault?.name);
      assert.deepEqual(interpreted.returnValue, reference.returnValue);
      assert.equal(actual.output, expected.output);
    } finally { reference.stop(); interpreted.stop(); }
  });
}

test('reference executor enforces operand guards before using a typed candidate', () => {
  const vm = make();
  const multiply = lowerWasmIR(vm, vm.top.method).instructions[2];
  vm.top.stack.push(float(1.5), float(2));
  let fallback = false;
  interpretWasmInstruction(vm, vm.top, multiply, (machine, frame, instruction) => {
    fallback = true;
    cilHandlers.get(instruction.name)(machine, frame, instruction);
  });
  assert.equal(fallback, true);
  assert.deepEqual(vm.top.stack, [float(3)]);
});
