import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Binary, BuiltinMap, Op, deserializeImage, serializeImage, verifyImage } from '@sharpforge/bytecode';
import { ManagedFault, VirtualMachine } from '@sharpforge/runtime';
import { target } from '../../../scripts/conformance/fuzz/targets/bytecode-image.js';
import {
  boundedBytecodeProfile, bytecodeExecutionOutcome, bytecodeLimits, executeBoundedBytecode,
} from '../../../scripts/conformance/fuzz/targets/binary-bytecode-profile.js';

const context = Object.freeze({ maxInputBytes: 65536, maxOutputBytes: 65536 });
const encode = value => new TextEncoder().encode(serializeImage(value));
const expectedExits = new Map([
  ['return-constant', 40], ['add-two-integers', 42], ['call-two-integers', 42], ['four-static-call-frames', 40],
  ['static-read-write', 42], ['fixed-object-field', 42], ['int-array-store-load-length', 42],
  ['empty-int-array', 0], ['int-array-at-heap-budget', 1020],
]);

function image(name = 'return-constant') {
  const seed = target.createSeeds().find(item => item.name === name);
  assert(seed, 'An owned seed is required');
  return deserializeImage(new TextDecoder().decode(seed.input));
}

function run(value) {
  return target.run(encode(value), context);
}

function accepted(value) {
  assert.deepEqual(verifyImage(value), []);
  assert.equal(boundedBytecodeProfile(value), true);
  const result = run(value);
  assert.equal(result.status, 'accepted');
  assert.equal(result.code, 'BYTECODE_VERIFIED_BOUNDED_EXECUTED');
  const proof = JSON.parse(result.detail);
  assert.equal(proof.profile, 'bounded-managed-int-v1');
  assert.equal(proof.maxFrames, 4);
  assert.equal(proof.maxStackBytes, 4096);
  assert.equal(proof.maxBytes, 8192);
  assert.equal(proof.maxInstructions, 1024);
  assert(proof.instructions <= 1024);
  assert(proof.heapPeakBytes <= 8192);
  assert.equal(proof.externalOperations, 0);
  assert.equal(proof.disposed, true);
  return proof;
}

function unsupported(value) {
  assert.deepEqual(verifyImage(value), [], 'The verifier alone admits this excluded profile');
  assert.equal(boundedBytecodeProfile(value), false);
  assert.equal(run(value).code, 'BYTECODE_EXECUTION_PROFILE');
}

test('bytecode profile: original scalar seed bytes are preserved', () => {
  const expectedHashes = [
    'ee505e3b7a3b7d136a826a96fe29d566177a60c277c7673df27ffdbf53775be3',
    '4b7d7f4a7c5cc2eaa4ca1df3c9d1c7d03fed7ebf176a4d16493d830095f23687',
  ];
  for (const [index, hash] of expectedHashes.entries()) {
    assert.equal(createHash('sha256').update(target.createSeeds()[index].input).digest('hex'), hash);
  }
});

test('bytecode profile: owned seeds exercise actual managed calls, storage, objects and arrays', () => {
  const first = target.createSeeds(), second = target.createSeeds();
  assert.deepEqual(first, second);
  assert.equal(first.length, expectedExits.size);
  assert(first.reduce((total, seed) => total + seed.input.length, 0) <= context.maxInputBytes);
  for (const seed of first) {
    const before = seed.input.slice();
    const proof = accepted(deserializeImage(new TextDecoder().decode(seed.input)));
    assert.equal(proof.exitCode, expectedExits.get(seed.name), seed.name);
    assert.deepEqual(seed.input, before);
    if (seed.name === 'fixed-object-field' || seed.name.includes('array')) assert.equal(proof.heapAllocations, 1);
  }
  assert.equal(accepted(image('static-read-write')).exitCode, 42, 'Each VM owns fresh static storage');
});

test('bytecode profile: four helper arguments, sixteen locals and combined code admission boundaries', () => {
  const value = image('call-two-integers');
  const helper = value.methods[1];
  helper.parameters = Array.from({ length: 4 }, () => ({ type: 'int' }));
  helper.locals = Array.from({ length: 16 }, () => ({ type: 'int' }));
  helper.code = Int32Array.from([Op.LDLOC, 0, 0, Op.LDLOC, 3, 0, Op.BINARY, Binary['+'], 1, Op.RET, 0, 0]);
  value.methods[0].code = Int32Array.from([
    Op.CONST, 0, 0, Op.CONST, 1, 0, Op.CONST, 0, 0, Op.CONST, 1, 0, Op.CALL, 1, 4, Op.RET, 0, 0,
  ]);
  assert.equal(accepted(value).exitCode, 42);
  helper.locals.push({ type: 'int' });
  unsupported(value);
  helper.locals.pop();
  helper.parameters.push({ type: 'int' });
  assert.equal(boundedBytecodeProfile(value), false);

  const codeBoundary = image('four-static-call-frames');
  const padding = Array.from({ length: 248 }, () => [Op.NOP, 0, 0]).flat();
  codeBoundary.methods[3].code = Int32Array.from([...padding, ...codeBoundary.methods[3].code]);
  assert.equal(accepted(codeBoundary).instructions, 256);
  codeBoundary.methods[3].code = Int32Array.from([Op.NOP, 0, 0, ...codeBoundary.methods[3].code]);
  unsupported(codeBoundary);
});

test('bytecode profile: method and constant counts cannot exceed the closed metadata budgets', () => {
  const methods = image('four-static-call-frames');
  methods.methods.push({ ...methods.methods[3], id: 4, name: 'Extra', qualifiedName: 'Extra' });
  unsupported(methods);
  const constants = image();
  constants.constants = Array.from({ length: 32 }, () => 40);
  assert.equal(accepted(constants).exitCode, 40);
  constants.constants.push(40);
  unsupported(constants);
  const types = image('fixed-object-field');
  types.types.push({ id: 1, name: 'AnotherBox', fields: [] });
  unsupported(types);
});

test('bytecode profile: the fourth int static and fourth fixed field are executable; extra slots are excluded', () => {
  const statics = image('static-read-write');
  statics.statics = Array.from({ length: 4 }, () => ({ type: 'int', value: 40 }));
  for (let offset = 0; offset < statics.methods[0].code.length; offset += 3) {
    if ([Op.LDSTATIC, Op.STSTATIC].includes(statics.methods[0].code[offset])) statics.methods[0].code[offset + 1] = 3;
  }
  assert.equal(accepted(statics).exitCode, 42);
  statics.statics[3].value = null;
  assert.equal(accepted(statics).exitCode, 2, 'A null int initializer selects the integer default');
  statics.statics.push({ type: 'int', value: 0 });
  unsupported(statics);

  const object = image('fixed-object-field');
  object.types[0].fields = Array.from({ length: 4 }, (_, index) => ({ name: 'Field' + index, type: 'int' }));
  for (let offset = 0; offset < object.methods[0].code.length; offset += 3) {
    if ([Op.LDFLD, Op.STFLD].includes(object.methods[0].code[offset])) object.methods[0].code[offset + 1] = 3;
  }
  assert.equal(accepted(object).heapPeakBytes, 64);
  object.types[0].fields.push({ name: 'Extra', type: 'int' });
  unsupported(object);
});

test('bytecode profile: array admission reaches exactly 8 KiB and rejects the next finite element', () => {
  const value = image('int-array-at-heap-budget');
  const proof = accepted(value);
  assert.equal(proof.heapPeakBytes, 8192);
  assert.equal(proof.exitCode, 1020);
  value.constants[1] = 1021;
  assert.deepEqual(verifyImage(value), []);
  assert.equal(boundedBytecodeProfile(value), true);
  assert.deepEqual(run(value), {
    status: 'rejected', code: 'BYTECODE_RUNTIME_LIMIT_OR_ARITHMETIC', detail: 'OutOfMemoryException',
  });
  value.constants[1] = -1;
  assert.equal(run(value).detail, 'OverflowException');
});

test('bytecode profile: positive fourth call frame and recursive fifth-frame rejection share fixed limits', () => {
  const value = image('four-static-call-frames');
  assert.equal(accepted(value).exitCode, 40);
  value.methods[3].code = Int32Array.from([Op.CALL, 0, 0, Op.RET, 0, 0]);
  assert.deepEqual(verifyImage(value), []);
  assert.equal(boundedBytecodeProfile(value), true);
  assert.equal(run(value).detail, 'StackOverflowException');
});

test('bytecode profile: aggregate stack bytes can reject before the fourth frame is allocated', () => {
  const value = image();
  value.methods[0].locals = Array.from({ length: 16 }, () => ({ type: 'int' }));
  value.methods[0].code = Int32Array.from([
    ...Array.from({ length: 120 }, () => [Op.CONST, 0, 0]).flat(),
    ...Array.from({ length: 120 }, () => [Op.POP, 0, 0]).flat(), Op.CALL, 0, 0, Op.RET, 0, 0,
  ]);
  assert.equal(boundedBytecodeProfile(value), true);
  assert.equal(run(value).detail, 'StackOverflowException');
  const vm = new VirtualMachine(value, {
    maxFrames: bytecodeLimits.maxFrames, maxStackBytes: bytecodeLimits.maxStackBytes,
    maxInstructions: bytecodeLimits.maxInstructions, maxBytes: bytecodeLimits.maxBytes,
    maxOutputCharacters: 0, maxUICommands: 0, framePooling: false, framePoolBytes: 0, environment: {}, virtualTime: true,
  });
  try {
    const result = vm.run();
    assert.equal(result.fault.message, 'Managed stack byte budget exceeded');
    assert(result.stats.instructions < 1024);
    assert(vm.frames.length < 4, 'The aggregate reservation prevents another live frame');
  } finally { vm.stop(); }
});

test('bytecode profile: scans include unreachable host instructions and negative field operands', () => {
  for (const opcode of [Op.BUILTIN, Op.DELEGATE, Op.THROW, Op.ENDFINALLY, Op.CONVERT, Op.ENUM]) {
    const value = image();
    value.methods[0].code = Int32Array.from([
      ...value.methods[0].code, opcode, BuiltinMap.get('Console.WriteLine').id, 1,
    ]);
    unsupported(value);
  }
  for (const opcode of [Op.LDFLD, Op.STFLD]) {
    const value = image('fixed-object-field');
    const offset = value.methods[0].code.findIndex((word, index) => index % 3 === 0 && word === opcode);
    value.methods[0].code[offset + 1] = -1;
    unsupported(value);
  }
  for (const opcode of [Op.LDLOC, Op.STLOC, Op.LDSTATIC, Op.STSTATIC, Op.CALL, Op.NEWOBJ, Op.NEWARR]) {
    const value = image();
    value.methods[0].code = Int32Array.from([...value.methods[0].code, opcode, -1, 0]);
    unsupported(value);
  }
});

test('bytecode profile: closed metadata blocks foreign, generic and non-integer construction paths', () => {
  for (const change of [
    value => { value.types[0].name = 'FuzzBox`5'; },
    value => { value.types[0].token = 1; },
    value => { value.types[0].base = 'System.Object'; },
    value => { value.types[0].interfaces = []; },
    value => { value.types[0].enum = true; },
    value => { value.types[0].fields[0].type = 'System.Func`2'; },
    value => { value.methods[0].locals[0].type = 'object'; },
    value => { value.methods[0].owner = 'FuzzBox'; },
    value => { value.methods[0].id = 1; },
    value => { value.il = {}; },
  ]) {
    const value = image('fixed-object-field');
    change(value);
    unsupported(value);
  }
  const foreignArray = image('empty-int-array');
  foreignArray.constants[2] = 'System.Func`2';
  unsupported(foreignArray);
  const literal = image('empty-int-array');
  literal.methods[0].code[1] = 2;
  unsupported(literal);
  const arbitraryConstant = image();
  arbitraryConstant.constants[0] = { h: 0, g: 1 };
  unsupported(arbitraryConstant);
  const arbitraryStatic = image('static-read-write');
  arbitraryStatic.statics[0].value = { h: 0, g: 1 };
  unsupported(arbitraryStatic);
});

test('bytecode profile: string arithmetic, exception handlers and mismatched parameter slots remain excluded', () => {
  const arithmetic = image('add-two-integers');
  arithmetic.methods[0].code[8] = 2;
  unsupported(arithmetic);
  const handlers = image();
  handlers.methods[0].locals = [{ type: 'int' }];
  handlers.methods[0].handlers = [{ kind: 'catch', start: 0, end: 1, target: 0, slot: 0, type: 'Exception' }];
  unsupported(handlers);
  const parameters = image('call-two-integers');
  parameters.methods[1].locals[0].type = 'int[]';
  unsupported(parameters);
  parameters.methods[1].parameters = null;
  assert.equal(boundedBytecodeProfile(parameters), false, 'Malformed signatures never reach VM construction');
});

test('bytecode profile: errors cannot become successes through the managed-fault wrapper', () => {
  for (const fault of [
    new TypeError('unexpected implementation defect'), new RangeError('unexpected allocation failure'),
    new ManagedFault('RuntimeException', 'wrapped host exception'),
    new ManagedFault('IndexOutOfRangeException', 'unclassified managed bounds fault'),
    new ManagedFault('InvalidProgramException', 'unclassified verifier/runtime disagreement'),
    Object.assign(new Error('Wrong class'), { name: 'OutOfMemoryException' }),
  ]) assert.throws(() => bytecodeExecutionOutcome({ fault }), error => error === fault);
  const value = image('int-array-store-load-length');
  value.constants[3] = 2;
  assert.throws(() => run(value), error => error instanceof ManagedFault && error.name === 'IndexOutOfRangeException');
});

test('bytecode profile: pre-cancellation and direct executor admission fail closed', () => {
  const controller = new AbortController();
  controller.abort();
  const value = image('int-array-at-heap-budget');
  assert.equal(target.run(encode(value), { ...context, signal: controller.signal }).code, 'FUZZ_CANCELLED');
  assert.equal(executeBoundedBytecode(value, { signal: controller.signal }).code, 'FUZZ_CANCELLED');
  value.types = [{ id: 0, name: 'FuzzBox`5', fields: [] }];
  assert.equal(executeBoundedBytecode(value, context).code, 'BYTECODE_EXECUTION_PROFILE');
});
