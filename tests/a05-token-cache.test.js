import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector} from '@sharpforge/cil';
import {CilVirtualMachine, executionCodeStatistics, invalidateExecutionCode} from '@sharpforge/runtime';
import {cachedField, cachedMetadataToken, cachedMethod, cachedTypeName, cachedUserString, verifiedMethod}
  from '../packages/runtime/src/execution/token-cache.js';
import {fieldAssembly} from './support/field-cache-fixture.js';
import {controlFixture} from './support/control-fixture.js';

test('T07 cached field metadata keeps closed generic types and reads current heap storage', () => {
  const fixture = fieldAssembly(), vm = new CilVirtualMachine(fixture.bytes);
  const integer = vm.heap.object('Box`1<int>', [42]), text = vm.heap.object('Box`1<string>', [null]);
  const first = vm.field(fixture.field, integer), other = vm.field(fixture.field, text);
  assert.notEqual(first.field, other.field);
  assert.equal(first.field.signature.type, 'System.Int32');
  assert.equal(other.field.signature.type, 'System.String');
  const epoch = executionCodeStatistics(vm).epoch;
  const snapshot = vm.snapshot();
  vm.heap.writeData(integer, 0, 99);
  assert.equal(vm.field(fixture.field, integer).record.data[0], 99);
  vm.restore(snapshot);
  const restored = vm.field(fixture.field, integer);
  assert(executionCodeStatistics(vm).epoch > epoch);
  assert.notEqual(restored.field, first.field);
  assert.deepEqual(restored.field, first.field);
  assert.notEqual(restored.record, first.record);
  assert.equal(restored.record.data[0], 42);
  assert.equal(vm.field(fixture.members[0], integer).field.signature.type, 'int');
  assert.equal(vm.field(fixture.members[1], text).field.signature.type, 'string');
});

test('T07 warm metadata never bypasses null, stale receiver or invalid token checks', () => {
  const fixture = fieldAssembly(), vm = new CilVirtualMachine(fixture.bytes);
  const value = vm.heap.object('Box`1<int>', [1]);
  vm.field(fixture.field, value);
  assert.throws(() => vm.field(fixture.field, null), {name: 'NullReferenceException'});
  const wrong = vm.heap.object('Other', [2]);
  assert.throws(() => vm.field(fixture.field, wrong), {name: 'InvalidProgramException'});
  assert.throws(() => cachedField(vm, fixture.method), /field token/);
  vm.heap.collect();
  assert.throws(() => vm.field(fixture.field, value), {name: 'InvalidReferenceException'});
});

test('T07 owner replacement and unload invalidate token metadata, field layout and verification membership', () => {
  const fixture = fieldAssembly(), vm = new CilVirtualMachine(fixture.bytes);
  const previous = cachedField(vm, fixture.otherField).field;
  const method = cachedMethod(vm, fixture.method);
  assert(verifiedMethod(vm, fixture.method));
  assert(!verifiedMethod(vm, 0x0600ffff));
  const epoch = executionCodeStatistics(vm).epoch;
  vm.inspector = new AssemblyInspector(fieldAssembly('string').bytes);
  assert.notEqual(cachedMethod(vm, fixture.method), method);
  const next = cachedField(vm, fixture.otherField).field;
  assert.notEqual(next, previous);
  assert.equal(next.signature.type, 'string');
  assert(executionCodeStatistics(vm).epoch > epoch);
  invalidateExecutionCode(vm, 'assembly-unload');
  assert.notEqual(cachedField(vm, fixture.otherField).field, next);
});

test('T07 fields, methods, raw tokens and strings resolve no metadata after their warm-up', () => {
  const fixture = fieldAssembly(), vm = new CilVirtualMachine(fixture.bytes);
  const value = vm.heap.object('Box`1<int>', [12]);
  const field = vm.field(fixture.field, value).field;
  const raw = cachedMetadataToken(vm, fixture.field), method = cachedMethod(vm, fixture.method);
  const name = cachedTypeName(vm, 0x02000002);
  vm.inspector.resolveToken = () => { throw new Error('Warm path resolved a metadata token'); };
  vm.inspector.signature = () => { throw new Error('Warm path decoded a signature'); };
  vm.inspector.metadata.typeName = () => { throw new Error('Warm path resolved a type name'); };
  for (let index = 0; index < 100; index++) {
    assert.equal(vm.field(fixture.field, value).field, field);
    assert.equal(cachedMetadataToken(vm, fixture.field), raw);
    assert.equal(cachedMethod(vm, fixture.method), method);
    assert.equal(cachedTypeName(vm, 0x02000002), name);
  }
});

test('T07 a field-heavy interpreter loop performs zero token or string resolutions after warm-up', () => {
  const bytes = controlFixture([{name: 'Program', fields: [{name: 'Value'}], methods: [
    {name: 'Main', result: 'int', locals: ['int'], body(writer, context) {
      const field = context.fields.get('Program.Value'), text = 0x70000000 + context.md.userString('cached');
      writer.mark('loop').op('ldsfld', field).op('ldc.i4.1').op('add').op('stsfld', field);
      writer.op('ldstr', text).op('pop').op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0');
      writer.op('ldloc.0').op('ldc.i4', 100).op('blt', 'loop').op('ldsfld', field).op('ret');
    }}
  ]}]);
  const vm = new CilVirtualMachine(bytes);
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000,
    onInstruction: (instruction, frame) => instruction.name === 'ldstr' && frame.locals[0] === 2});
  assert.equal(vm.state, 'paused');
  const text = vm.top.method.instructions.find(instruction => instruction.name === 'ldstr').operand;
  assert.equal(cachedUserString(vm, text), 'cached');
  vm.inspector.resolveToken = () => { throw new Error('Warm loop resolved a metadata token'); };
  vm.inspector.metadata.userString = () => { throw new Error('Warm loop decoded a user string'); };
  vm.state = 'running';
  const result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  assert.equal(result.returnValue, 100);
});
