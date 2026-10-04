import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, codedIndex} from '@sharpforge/cil';
import {compileToIL} from '@sharpforge/compiler';
import {CilDebugSession} from '@sharpforge/debugger';
import {CilVirtualMachine, executionCodeStatistics, invalidateExecutionCode} from '@sharpforge/runtime';
import {cachedMetadataToken, cachedTypeName, cachedUserString, verifiedMethod}
  from '../packages/runtime/src/execution/token-cache.js';
import {staticSlot} from '../packages/runtime/src/execution/statics.js';
import {tokenCacheFixture} from './support/token-cache-fixture.js';
import {managedFixture} from './managed-fixtures.js';

class CountingInspector extends AssemblyInspector {
  resolveToken(...args) {
    this.resolutions = (this.resolutions ?? 0) + 1;
    return super.resolveToken(...args);
  }
}

function fieldLoop() {
  return managedFixture({fields: [{name: 'Value', static: false}, {name: 'Total'}], methods: [
    {name: 'Main', result: 'int', locals: ['Fixture.Program', 'int'], body(writer, context) {
      writer.op('newobj', context.methods['.ctor']).op('stloc.0');
      writer.mark('loop').op('ldloc.0').op('ldloc.1').op('stfld', context.fields.Value);
      writer.op('ldloc.0').op('ldfld', context.fields.Value).op('call', context.methods.Bump);
      writer.op('stsfld', context.fields.Total).op('ldsflda', context.fields.Total);
      writer.op('ldsfld', context.fields.Total).op('stind.i4');
      writer.op('ldstr', 0x70000000 + context.md.userString('cached\u0000\ud83d\ude42')).op('pop');
      writer.op('ldtoken', context.type).op('pop');
      writer.op('ldloc.1').op('ldc.i4.1').op('add').op('dup').op('stloc.1');
      writer.op('ldc.i4', 40).op('blt', 'loop').op('ldsfld', context.fields.Total).op('ret');
    }},
    {name: '.ctor', static: false, body: (writer, context) => writer.op('ldarg.0')
      .op('call', context.member('System.Object', '.ctor', 'void', [], false)).op('ret')},
    {name: 'Bump', parameters: ['int'], result: 'int', body: writer =>
      writer.op('ldarg.0').op('ldc.i4.1').op('add').op('ret')}
  ]});
}

test('field-heavy execution resolves no metadata tokens after its first loop iterations', () => {
  for (const decodePlans of [false, true]) {
    const inspector = new CountingInspector(fieldLoop());
    const vm = new CilVirtualMachine(inspector, {decodePlans});
    vm.runSlice({instructionBudget: 10000, timeBudgetMs: 1000, onInstruction(instruction, frame) {
      return instruction.name === 'blt' && frame.locals[1] === 10;
    }});
    assert.equal(vm.state, 'paused', vm.fault?.message);
    const warmed = inspector.resolutions;
    vm.state = 'running';
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.returnValue, 40);
    assert.equal(inspector.resolutions, warmed);
  }
});

test('metadata descriptors are immutable and verification membership tracks replaced reports', () => {
  const fixture = tokenCacheFixture();
  const vm = new CilVirtualMachine(fixture.bytes);
  const method = cachedMetadataToken(vm, fixture.method);
  assert.equal(cachedMetadataToken(vm, fixture.method), method);
  assert(Object.isFrozen(method));
  assert(Object.isFrozen(method.signature));
  assert(Object.isFrozen(method.signature.parameters));
  assert.throws(() => method.signature.parameters.push('string'), TypeError);
  assert(verifiedMethod(vm, fixture.method));
  assert(!verifiedMethod(vm, 0x0600ffff));
  vm.report = {...vm.report, methods: []};
  assert(!verifiedMethod(vm, fixture.method));
  for (let repeat = 0; repeat < 2; repeat++) {
    assert.throws(() => cachedMetadataToken(vm, 0x0600ffff));
    assert.throws(() => cachedUserString(vm, fixture.method));
  }
  assert.equal(cachedMetadataToken(vm, fixture.method), method);
});

test('closed field owners never share substituted signatures or thread-static slot identities', () => {
  const fixture = tokenCacheFixture();
  const vm = new CilVirtualMachine(fixture.bytes);
  const integer = vm.heap.object('Box`1<int>', [42]);
  const text = vm.heap.object('Box`1<string>', [null]);
  const integerField = vm.field(fixture.field, integer).field;
  const textField = vm.field(fixture.field, text).field;
  assert.equal(integerField.signature.type, 'System.Int32');
  assert.equal(textField.signature.type, 'System.String');
  assert.notEqual(integerField, textField);
  assert.equal(vm.field(fixture.members[0], integer).field.signature.type, 'int');
  assert.equal(vm.field(fixture.members[1], text).field.signature.type, 'string');
  for (const [owner, value, expectedType] of [['Box`1<int>', 19, 'int'], ['Box`1<string>', null, 'string']]) {
    const slot = staticSlot(vm, fixture.staticField, {genericIdentity: owner});
    assert.equal(slot.field.signature.type, expectedType);
    vm.dereference(vm.address('static', slot.key), true, value);
    assert.equal(vm.statics.get(slot.key), value);
    assert.equal(staticSlot(vm, fixture.staticField, {genericIdentity: owner}).field, slot.field);
  }
  const bytes = managedFixture({fields: [{name: 'Value'}], decorate: ({md, fields, member}) => {
    md.add(12, [codedIndex('HasCustomAttribute', fields.Value),
      codedIndex('CustomAttributeType', member('System.ThreadStaticAttribute', '.ctor', 'void', [], false)),
      md.blob(new Uint8Array([1, 0, 0, 0]))]);
  }});
  const threaded = new CilVirtualMachine(bytes);
  const first = staticSlot(threaded, 0x04000001);
  threaded.scheduler.currentId = 2;
  const second = staticSlot(threaded, 0x04000001);
  assert.equal(second.field, first.field);
  assert.notEqual(second.key, first.key);
});

test('warm fields validate null, wrong, collected and foreign receivers on every access', () => {
  const fixture = tokenCacheFixture();
  const vm = new CilVirtualMachine(fixture.bytes);
  const ref = vm.heap.object('Box`1<int>', [42]);
  vm.field(fixture.field, ref);
  assert.throws(() => vm.field(fixture.field, null), {name: 'NullReferenceException'});
  const wrong = vm.heap.object('Other', [1]);
  assert.throws(() => vm.field(fixture.field, wrong), {name: 'InvalidProgramException'});
  const other = new CilVirtualMachine(fixture.bytes);
  assert.throws(() => vm.typeSystem.fieldCache.resolve(fixture.field, other.typeSystem.table('Box`1<int>')),
    {name: 'InvalidProgramException'});
  vm.heap.collect();
  assert.throws(() => vm.field(fixture.field, ref), {name: 'InvalidReferenceException'});
});

test('metadata string caching never retains weak intern handles or aliases strings from another VM', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'string', body(writer, context) {
    writer.op('ldstr', 0x70000000 + context.md.userString('cached\u0000\ud83d\ude42')).op('ret');
  }}]});
  const vm = new CilVirtualMachine(bytes, {weakStringInterning: true});
  const other = new CilVirtualMachine(bytes, {weakStringInterning: true});
  const token = vm.top.method.instructions[0].operand;
  const text = cachedUserString(vm, token);
  assert.equal(text, 'cached\u0000\ud83d\ude42');
  vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
  const first = vm.pop();
  vm.heap.collect();
  assert.throws(() => vm.heap.get(first), {name: 'InvalidReferenceException'});
  vm.top.pc = 0;
  vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
  const second = vm.top.stack[0];
  assert.equal(vm.value(second), text);
  assert.notDeepEqual(second, first);
  assert.equal(cachedUserString(other, token), text);
  const foreign = other.string(text);
  assert.notEqual(foreign, second);
  assert.equal(other.value(foreign), text);
});

test('restore rebuilds field metadata while preserving live storage and rejecting invalid restore atomically', () => {
  const fixture = tokenCacheFixture();
  const vm = new CilVirtualMachine(fixture.bytes);
  const ref = vm.heap.object('Box`1<int>', [42]);
  const before = vm.field(fixture.field, ref);
  const token = cachedMetadataToken(vm, fixture.method);
  const snapshot = vm.snapshot();
  vm.heap.get(ref).data[0] = 99;
  assert.equal(vm.field(fixture.field, ref).record.data[0], 99);
  assert.throws(() => vm.restore({...snapshot, schemaVersion: 999}), /schema version/);
  assert.equal(vm.field(fixture.field, ref).field, before.field);
  assert.equal(cachedMetadataToken(vm, fixture.method), token);
  vm.restore(snapshot);
  const after = vm.field(fixture.field, ref);
  assert.notEqual(after.field, before.field);
  assert.notEqual(after.record, before.record);
  assert.equal(after.record.data[0], 42);
  assert.notEqual(cachedMetadataToken(vm, fixture.method), token);
});

test('inspector replacement, explicit unload and stop isolate identical tokens and drop metadata caches', () => {
  const fixture = tokenCacheFixture();
  const vm = new CilVirtualMachine(fixture.bytes);
  const previous = vm.field(fixture.otherField).field;
  const descriptor = cachedMetadataToken(vm, fixture.otherField);
  assert.equal(cachedTypeName(vm, 0x02000003), 'Other');
  const independent = new CilVirtualMachine(vm.inspector);
  assert.notEqual(cachedMetadataToken(independent, fixture.otherField), descriptor);
  vm.inspector = new AssemblyInspector(tokenCacheFixture('string').bytes);
  assert.notEqual(cachedMetadataToken(vm, fixture.otherField), descriptor);
  const next = vm.field(fixture.otherField).field;
  assert.equal(next.signature.type, 'string');
  assert.notEqual(next, previous);
  invalidateExecutionCode(vm, 'assembly-unload');
  const unloaded = vm.field(fixture.otherField).field;
  assert.notEqual(unloaded, next);
  vm.stop();
  assert.notEqual(vm.field(fixture.otherField).field, unloaded);
});

test('committed debugger Hot Reload replaces metadata caches; rejected changes retain their identity', () => {
  const source = 'class P {static int Value(){return 1;} static void Main(){\nConsole.WriteLine(Value());\n}}';
  const before = compileToIL(source);
  const after = compileToIL(source.replace('return 1;', 'return 9;'));
  assert(before.success, JSON.stringify(before.diagnostics));
  assert(after.success, JSON.stringify(after.diagnostics));
  const session = new CilDebugSession(before.assembly);
  session.setBreakpoints('Program.cs', [{line: 2}]);
  session.start(false);
  session.runUntilStop();
  const methodToken = session.vm.top.method.token;
  const old = cachedMetadataToken(session.vm, methodToken);
  const epoch = executionCodeStatistics(session.vm).epoch;
  assert.throws(() => session.applyChanges(after.assembly, {expectedVersion: -1}), /version/i);
  assert.equal(cachedMetadataToken(session.vm, methodToken), old);
  assert.equal(executionCodeStatistics(session.vm).epoch, epoch);
  session.applyChanges(after.assembly);
  assert.notEqual(cachedMetadataToken(session.vm, methodToken), old);
  assert(executionCodeStatistics(session.vm).epoch > epoch);
  session.resume();
  assert.equal(session.runUntilStop().output, '9\n');
});
