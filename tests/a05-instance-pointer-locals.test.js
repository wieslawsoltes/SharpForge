import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, encodeSignature, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, invalidateExecutionCode} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

const scalar = name => ({kind: 'primitive', name});
const signature = (options = {}) => ({kind: 'method', hasThis: true,
  returnType: scalar('int'), parameters: [scalar('int')], ...options});
const pointer = (options = {}) => ({kind: 'functionPointer', signature: signature(options)});

function fixture({target = 'Counter.Add', localType = pointer(), join = false, addressed = false,
  assigned = true, initialize = true} = {}) {
  const add = (name, amount) => ({name, static: false, result: 'int', parameters: ['int'], maxStack: 3,
    body(writer, context) {
      writer.op('call', context.member('System.GC', 'Collect', 'void'));
      writer.op('ldarg.0').op('ldfld', context.fields.get('Counter.Value'))
        .op('ldarg.1').op('add').op('ldc.i4', amount).op('add').op('ret');
    }});
  return genericCallFixture([
    {name: 'Counter', fields: [{name: 'Value', type: 'int'}], methods: [
      {name: '.ctor', static: false, flags: 0x1886, maxStack: 3, body(writer, context) {
        writer.op('ldarg.0').op('call', context.member('System.Object', '.ctor', 'void', [], false)).op('ret');
      }}, add('Add', 1), add('Alternate', 2)]},
    {name: 'Program', methods: [
      {name: 'Static', result: 'int', parameters: ['int'], maxStack: 3, body: writer => writer.op('ldarg.0').op('ret')},
      {name: 'Main', result: 'int', maxStack: 3, initLocals: initialize,
        localsSignature: encodeSignature({kind: 'locals', types: [
          {kind: 'class', token: 0x02000002}, localType, scalar('nint')
        ]}), body(writer, context) {
        writer.op('newobj', context.methods.get('Counter..ctor')).op('stloc.0');
        writer.op('ldftn', context.methods.get('Program.Static')).op('stloc.2');
        if (addressed) writer.op('ldloca.s', 1).op('pop');
        if (join) writer.op('ldc.i4.0').op('brfalse.s', 'other');
        if (assigned) writer.op('ldftn', context.methods.get(target)).op('stloc.1');
        if (join) writer.op('br.s', 'invoke').mark('other')
          .op('ldftn', context.methods.get('Counter.Alternate')).op('stloc.1').mark('invoke');
        writer.op('ldloc.0').op('ldc.i4', 41).op('ldloc.1');
        writer.op('calli', context.md.add(17, [context.md.blob(encodeSignature(signature()))])).op('ret');
      }}
    ]}
  ]);
}

function withVM(bytes, callback, options = {}) {
  const vm = new CilVirtualMachine(bytes, options);
  try { callback(vm); } finally { vm.stop(); }
}

function pause(vm, opcode = 'ldloc.1') {
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity,
    onInstruction: instruction => instruction.name === opcode});
  assert.equal(vm.state, 'paused');
}

for (const nativeIntBits of [32, 64]) for (const typedNumericStack of [false, true]) {
  test(`typed instance pointer local calls its selected body at ABI${nativeIntBits}, typed slots=${typedNumericStack}`, () => {
    withVM(fixture(), vm => {
      assert.equal(vm.top.method.locals[1], 'method int *(int)', 'inspection spelling stays unchanged');
      assert.equal(vm.run().returnValue, 42);
      assert.equal(vm.state, 'terminated');
      assert(vm.heap.stats.collections > 0);
    }, {nativeIntBits, typedNumericStack});
  });
}

for (const decodePlans of [false, true]) test(`typed-local CFG joins preserve compatible instance provenance, decode=${decodePlans}`, () => {
  withVM(fixture({join: true}), vm => assert.equal(vm.run().returnValue, 43), {decodePlans});
});

test('equal display text does not make static and instance local signatures interchangeable', () => {
  for (const options of [{target: 'Program.Static'}, {localType: pointer({hasThis: false})}]) {
    const inspector = new AssemblyInspector(fixture(options));
    assert.equal(inspector.getMethod(inspector.pe.entryPoint).locals[1], 'method int *(int)');
    const report = verifyCilAssembly(inspector);
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.code === 'IL_CALLI' && /signature/.test(issue.message)));
  }
});

test('owned host local writes reject forged, foreign and static pointers without changing storage or write observations', () => {
  const bytes = fixture();
  withVM(bytes, vm => withVM(bytes, other => {
    pause(vm); pause(other);
    const address = vm.address('local', 1), original = vm.top.locals[1];
    const writes = [];
    vm.onWrite = event => writes.push(event);
    for (const invalid of [undefined, 1, Object.freeze({...original}), other.top.locals[1], vm.top.locals[2]]) {
      const revision = vm.writeRevision;
      assert.throws(() => vm.dereference(address, true, invalid), {name: 'InvalidProgramException'});
      assert.equal(vm.top.locals[1], original);
      assert.equal(vm.writeRevision, revision);
      assert.equal(writes.length, 0);
    }
    vm.dereference(address, true, original);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].value, original);
    assert.throws(() => vm.dereference(Object.freeze({...address, readonly: true}), true, original), /readonly/);
    assert.throws(() => vm.dereference(other.address('local', 1), true, original), /another VM/);
  }));
});

test('loads revalidate host-edited values before pushing them onto the evaluation stack', () => {
  withVM(fixture(), vm => {
    pause(vm);
    const snapshot = vm.snapshot(), original = vm.top.locals[1];
    for (const invalid of [undefined, 17, Object.freeze({...original}), vm.top.locals[2]]) {
      vm.restore(snapshot);
      vm.top.locals[1] = invalid;
      const stack = [...vm.top.stack];
      assert.throws(() => vm.step(), {name: 'InvalidProgramException'});
      assert.deepEqual(vm.top.stack, stack);
    }
    vm.restore(snapshot);
    vm.dereference(vm.address('local', 1), true, null);
    vm.step();
    assert.equal(vm.top.stack.at(-1), null);
    const stack = [...vm.top.stack];
    assert.throws(() => vm.step(), {name: 'InvalidProgramException'});
    assert.deepEqual(vm.top.stack, stack, 'a null pointer is not callable');
  });
});

for (const phase of ['ldloc.1', 'calli']) test(`snapshot at ${phase} preserves opaque identity and drops derived local plans`, () => {
  withVM(fixture(), vm => {
    pause(vm, phase);
    const pointer = vm.top.locals[1], address = vm.address('local', 1), snapshot = vm.snapshot();
    for (let replay = 0; replay < 2; replay++) {
      vm.restore(snapshot);
      invalidateExecutionCode(vm, 'typed-instance-local-replay');
      assert.equal(vm.top.locals[1], pointer);
      vm.heap.collect();
      vm.state = 'running';
      assert.equal(vm.run().returnValue, 42);
    }
    vm.restore(snapshot);
    vm.stop();
    assert.throws(() => vm.dereference(address, true, pointer), /outlived/);
  });
});

test('replacing metadata rebuilds raw local plans even when the legacy display stays equal', () => {
  withVM(fixture(), vm => {
    pause(vm);
    const bytes = fixture();
    const replacement = new AssemblyInspector(bytes);
    vm.inspector = replacement;
    vm.report = verifyCilAssembly(replacement);
    assert.equal(vm.report.success, true);
    invalidateExecutionCode(vm, 'typed-local-replacement');
    const address = vm.address('local', 1), pointer = vm.top.locals[1];
    vm.dereference(address, true, pointer); // Warm the replacement epoch's local plan.
    const signatureToken = vm.top.method.localSignature;
    const blob = replacement.metadata.blob(replacement.metadata.row(signatureToken)[0]);
    // This fixture uses locals[count=3], CLASS/token, then FNPTR/header.
    assert.equal(blob[4], 0x1b);
    blob[5] &= ~0x20;
    invalidateExecutionCode(vm, 'typed-local-header-edit');
    assert.throws(() => vm.dereference(address, true, pointer), /signature mismatch/);
    assert.equal(vm.top.locals[1], pointer);
  });
});

for (const nativeIntBits of [32, 64]) test(`typed pointer locals retain exact frame-byte quota and atomic restore at ABI${nativeIntBits}`, () => {
  for (const limit of [119, 120]) withVM(fixture(), vm => {
    pause(vm, 'calli');
    const snapshot = vm.snapshot(), pointer = vm.top.locals[1];
    // Main: header16 + maxstack3*8 + locals3*8 =64; Add: header16 + maxstack3*8 + args2*8 =56.
    vm.options.maxStackBytes = 63;
    assert.throws(() => vm.restore(snapshot), /Snapshot exceeds managed stack byte budget/);
    assert.equal(vm.top.locals[1], pointer);
    vm.options.maxStackBytes = limit;
    vm.restore(snapshot);
    vm.state = 'running';
    const result = vm.run();
    if (limit === 120) assert.equal(result.returnValue, 42);
    else assert.equal(result.fault?.name, 'StackOverflowException');
  }, {nativeIntBits});
});

for (const options of [{addressed: true}, {assigned: false}, {assigned: false, initialize: false}]) {
  test(`address escape or missing local provenance stays rejected: ${JSON.stringify(options)}`, () => {
    const report = verifyCilAssembly(fixture(options));
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.code === 'IL_CALLI'));
  });
}

for (const localType of [pointer({explicitThis: true}), pointer({callingConvention: 1}), pointer({genericArity: 1}),
  pointer({returnType: pointer()}), {kind: 'pinned', element: pointer()},
  {kind: 'functionPointer', signature: signature({hasThis: false, parameters: [pointer()]})}]) {
  test(`unsupported local pointer shape remains inspection-only: ${JSON.stringify(localType)}`, () => {
    const report = verifyCilAssembly(fixture({localType}));
    assert.equal(report.success, false);
  });
}
