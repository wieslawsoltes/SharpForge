import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, codedIndex, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, invalidateExecutionCode} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

function constructor(base) {
  return {name: '.ctor', static: false, flags: 0x1886, body(writer, context) {
    const target = base ? context.methods.get(base + '..ctor') : context.member('System.Object', '.ctor', 'void', [], false);
    writer.op('ldarg.0').op('call', target).op('ret');
  }};
}

function fixture({root = false, middle = null, leaf = false, main, trace = false, throwing = false,
  explicit = false, invalidLeaf = false, abstractRoot = false} = {}) {
  const text = (name, flags) => ({name: 'ToString', static: false, flags, result: 'string', body(writer, context) {
    if (name === 'Leaf' && invalidLeaf) { writer.op('pop').op('ret'); return; }
    if (throwing) { writer.op('ldnull').op('throw'); return; }
    const field = context.fields.get('Root.X');
    writer.op('call', context.member('System.GC', 'Collect', 'void'));
    writer.op('ldarg.0').op('dup').op('ldfld', field).op('ldc.i4.1').op('add').op('stfld', field);
    writer.op('ldstr', 0x70000000 + context.md.userString(name));
    if (trace) writer.op('dup').op('call', context.member('System.Console', 'WriteLine', 'void', ['string']));
    writer.op('ret');
  }});
  return genericCallFixture([
    {name: 'Root', ...(abstractRoot ? {flags: 0x100081} : {}), fields: [{name: 'X', type: 'int'}],
      methods: [constructor(), ...(abstractRoot ? [{name: 'ToString', static: false, flags: 0x4c6, result: 'string'}]
        : root ? [text('Root', 0xc6)] : [])]},
    {name: 'Middle', base: 'Root', ...(abstractRoot ? {flags: 0x100081} : {}), methods: [constructor('Root'),
      ...(middle ? [text('Middle', middle === 'newslot' ? 0x1c6 : 0xc6)] : [])]},
    {name: 'Leaf', base: 'Middle', methods: [constructor('Middle'), ...(explicit === 'internal'
      ? [{...text('Leaf', 0x1e1), name: 'Hidden'}] : leaf ? [text('Leaf', 0xc6)] : [])]},
    {name: 'Other', methods: [constructor()]},
    {name: 'Holder', fields: [{name: 'Value', type: 'Root'}], methods: [constructor()]},
    {name: 'Program', methods: [
      {name: 'Apply', parameters: ['Root&'], result: 'string', body(writer, context) {
        writer.op('ldarg.0').op('constrained.', context.resolve('Root'))
          .op('callvirt', context.member('System.Object', 'ToString', 'string', [], false)).op('ret');
      }},
      {name: 'Expired', result: 'Root&', locals: ['Root'], body: writer => writer.op('ldloca.s', 0).op('ret')},
      {name: 'Main', result: 'string', locals: ['Root', 'Root[]', 'Holder', 'Other', 'string'], body(writer, context) {
        if (main) { main(writer, context); return; }
        writer.op('newobj', context.methods.get('Leaf..ctor')).op('stloc.0');
        writer.op('ldloca.s', 0).op('call', context.methods.get('Program.Apply')).op('ret');
      }}
    ]}
  ], {decorate(context) {
    if (explicit === 'internal') context.md.add(25, [context.types.get('Leaf') & 0xffffff,
      codedIndex('MethodDefOrRef', context.methods.get('Leaf.Hidden')),
      codedIndex('MethodDefOrRef', context.methods.get('Root.ToString'))]);
    else if (explicit) context.md.add(25, [context.types.get('Root') & 0xffffff,
      codedIndex('MethodDefOrRef', context.methods.get('Root.ToString')),
      codedIndex('MethodDefOrRef', context.member('System.Object', 'ToString', 'string', [], false))]);
  }});
}

function withVM(bytes, callback, options = {}, VM = CilVirtualMachine) {
  const vm = new VM(bytes, options);
  try { callback(vm); } finally { vm.stop(); }
}

function pauseAtCall(vm, active = false) {
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity, onInstruction(instruction, frame) {
    return active ? frame.method.name === 'ToString' : instruction.name === 'callvirt';
  }});
  assert.equal(vm.state, 'paused');
}

const combinations = [
  [{}, 'Leaf'],
  [{root: true}, 'Root'],
  [{root: true, middle: 'override'}, 'Middle'],
  [{root: true, leaf: true}, 'Leaf'],
  [{leaf: true}, 'Leaf'],
  [{abstractRoot: true, leaf: true}, 'Leaf'],
  [{root: true, middle: 'newslot', leaf: true}, 'Root'],
  [{middle: 'newslot', leaf: true}, 'Leaf']
];
for (const [options, expected] of combinations) for (const decodePlans of [false, true]) {
  test(`reference Object slot ${JSON.stringify(options)} with decodePlans=${decodePlans}`, () => {
    withVM(fixture(options), vm => {
      const allocated = vm.heap.stats.allocations;
      assert.equal(vm.run().state, 'terminated');
      assert.equal(vm.format(vm.returnValue), expected);
      assert.equal(vm.heap.stats.allocations - allocated, 2, 'only the explicit Leaf object and result string allocate');
      assert.equal(vm.heap.records.some(record => record?.kind === 'box'), false);
      const overridesObject = options.root || options.middle === 'override' || options.leaf && options.middle !== 'newslot';
      assert.equal(vm.heap.records.find(record => record?.type === 'Leaf').data[0], overridesObject ? 1 : 0);
    }, {decodePlans});
  });
}

test('inherited override receives the same live reference and its mutations survive host GC', () => {
  let vm, receiver, outputs = 0;
  try {
    vm = new CilVirtualMachine(fixture({root: true, trace: true}), {onOutput() {
      outputs++;
      receiver = vm.top.args[0];
      vm.frames.find(frame => frame.method.name === 'Main').locals[0] = null;
      vm.heap.collect();
      assert.equal(vm.heap.get(receiver).type, 'Leaf');
      assert.equal(vm.heap.get(receiver).data[0], 1);
    }});
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.format(vm.returnValue), 'Root');
    assert.equal(outputs, 1);
    vm.heap.collect();
    assert.throws(() => vm.heap.get(receiver), {name: 'InvalidReferenceException'});
  } finally { vm?.stop(); }
});

test('fallback pins the dereferenced receiver if formatting clears its source slot', () => {
  class CollectingVM extends CilVirtualMachine {
    format(value, type) {
      if (value?.h !== undefined && this.heap.get(value).type === 'Leaf') {
        this.frames.find(frame => frame.method.name === 'Main').locals[0] = null;
        this.heap.collect();
        assert.equal(this.heap.get(value).type, 'Leaf');
      }
      return super.format(value, type);
    }
  }
  withVM(fixture(), vm => {
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.format(vm.returnValue), 'Leaf');
    assert.equal(vm.heap.records.some(record => record?.kind === 'box'), false);
  }, {}, CollectingVM);
});

for (const active of [false, true]) test(`snapshot of ${active ? 'override frame' : 'reference prefix'} preserves identity`, () => {
  withVM(fixture({root: true}), vm => {
    pauseAtCall(vm, active);
    const original = vm.frames[0].locals[0], snapshot = vm.snapshot();
    if (active) assert.deepEqual(vm.top.args[0], original);
    for (let replay = 0; replay < 2; replay++) {
      vm.restore(snapshot);
      invalidateExecutionCode(vm, 'reference-tostring-test');
      vm.state = 'running';
      vm.heap.collect();
      assert.equal(vm.run().state, 'terminated');
      assert.equal(vm.format(vm.returnValue), 'Root');
      assert.equal(vm.heap.get(original).data[0], 1);
    }
    vm.restore(snapshot);
    vm.stop();
    vm.heap.collect();
    assert.throws(() => vm.heap.get(original), {name: 'InvalidReferenceException'});
  });
});

test('array and field reference storage retain the existing object without allocating boxes', () => {
  withVM(fixture({root: true, main(writer, context) {
    const apply = context.methods.get('Program.Apply'), type = context.resolve('Root');
    writer.op('newobj', context.methods.get('Leaf..ctor')).op('stloc.0');
    writer.op('ldc.i4.1').op('newarr', type).op('stloc.1');
    writer.op('ldloc.1').op('ldc.i4.0').op('ldloc.0').op('stelem.ref');
    writer.op('newobj', context.methods.get('Holder..ctor')).op('stloc.2');
    writer.op('ldloc.2').op('ldloc.0').op('stfld', context.fields.get('Holder.Value'));
    writer.op('ldloc.1').op('ldc.i4.0').op('ldelema', type).op('call', apply).op('pop');
    writer.op('ldloc.2').op('ldflda', context.fields.get('Holder.Value')).op('call', apply).op('ret');
  }}), vm => {
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.format(vm.returnValue), 'Root');
    const receiver = vm.heap.records.find(record => record?.type === 'Leaf');
    assert.equal(receiver.data[0], 2);
    assert.equal(vm.heap.records.some(record => record?.kind === 'box'), false);
  });
});

for (const kind of ['null', 'uninitialized', 'foreign', 'wrong-slot', 'incompatible']) {
  test(`warm reference Object dispatch still rejects ${kind}`, () => {
    const bytes = fixture({root: true, main(writer, context) {
      writer.op('newobj', context.methods.get('Leaf..ctor')).op('stloc.0');
      writer.op('ldloca.s', 0).op('call', context.methods.get('Program.Apply')).op('pop');
      writer.op('ldloca.s', 0).op('call', context.methods.get('Program.Apply')).op('ret');
    }});
    withVM(bytes, vm => withVM(bytes, other => {
      let calls = 0;
      vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity, onInstruction(instruction) {
        return instruction.name === 'callvirt' && ++calls === 2;
      }});
      assert.equal(vm.state, 'paused');
      const main = vm.frames[0];
      if (kind === 'null') main.locals[0] = null;
      if (kind === 'uninitialized') main.locals[0] = undefined;
      if (kind === 'foreign') vm.top.stack[0] = other.address('local', 0);
      if (kind === 'wrong-slot') vm.top.stack[0] = Object.freeze({...vm.top.stack[0], frameId: main.id, index: 3});
      if (kind === 'incompatible') main.locals[0] = vm.heap.object(vm.typeSystem.table('Other'), []);
      vm.state = 'running';
      assert.equal(vm.run().fault?.name, kind === 'null' ? 'NullReferenceException' : 'InvalidProgramException');
    }));
  });
}

test('expired reference storage cannot reach Object fallback', () => {
  withVM(fixture({main(writer, context) {
    writer.op('call', context.methods.get('Program.Expired')).op('call', context.methods.get('Program.Apply')).op('ret');
  }}), vm => assert.equal(vm.run().fault?.name, 'InvalidProgramException'));
});

test('throwing override preserves its original first-pass receiver and stop releases it', () => {
  withVM(fixture({root: true, throwing: true}), vm => {
    const result = vm.run();
    assert.equal(result.fault?.name, 'NullReferenceException');
    assert.equal(result.fault.phase, 'unhandled');
    assert.deepEqual(vm.frames.map(frame => frame.method.name), ['Main', 'Apply', 'ToString']);
    const receiver = vm.top.args[0];
    assert.equal(receiver, vm.frames[0].locals[0]);
    vm.heap.collect();
    assert.equal(vm.heap.get(receiver).type, 'Leaf');
    assert.equal(vm.heap.records.some(record => record?.kind === 'box'), false);
    vm.stop();
    assert.equal(vm.frames.length, 0);
    vm.heap.collect();
    assert.throws(() => vm.heap.get(receiver), {name: 'InvalidReferenceException'});
  });
});

test('verification reaches possible descendant overrides, but excludes bodies in a hiding slot', () => {
  assert.equal(verifyCilAssembly(fixture({root: true, leaf: true, invalidLeaf: true})).success, false);
  assert.equal(verifyCilAssembly(fixture({root: true, middle: 'newslot', leaf: true, invalidLeaf: true})).success, true);
});

for (const explicit of [true, 'internal']) test(`explicit Object MethodImpl remains rejected (${explicit})`, () => {
  const report = verifyCilAssembly(fixture({root: true, explicit}));
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.message.includes('Explicit Object.ToString')));
});

test('a malformed cyclic hierarchy is bounded before descendant traversal', () => {
  const inspector = new AssemblyInspector(fixture());
  const root = inspector.types.find(type => type.name === 'Root'), leaf = inspector.types.find(type => type.name === 'Leaf');
  root.baseToken = leaf.token;
  const report = verifyCilAssembly(inspector);
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.message.includes('cyclic')));
});

for (const base of ['System.Exception', 'Generic`1<int>']) test(`external and closed generic base ${base} preserve their admission boundary`, () => {
  const bytes = genericCallFixture([
    {name: 'Generic`1', genericParameters: [{}], methods: []},
    {name: 'Receiver', base, methods: []},
    {name: 'Program', methods: [{name: 'Main', locals: ['Receiver'], result: 'string', body(writer, context) {
      writer.op('ldloca.s', 0).op('constrained.', context.resolve('Receiver'))
        .op('callvirt', context.member('System.Object', 'ToString', 'string', [], false)).op('ret');
    }}]}
  ]);
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, base !== 'System.Exception', JSON.stringify(report.issues));
  if (base === 'System.Exception') assert(report.issues.some(issue => issue.code === 'IL_PREFIX'));
  else withVM(bytes, vm => assert.equal(vm.run().fault?.name, 'NullReferenceException'));
});

for (const depth of [64, 65]) test(`reference hierarchy depth ${depth} obeys the metadata boundary`, () => {
  const types = Array.from({length: depth}, (_, index) => ({name: 'C' + index,
    ...(index ? {base: 'C' + (index - 1)} : {}), methods: []}));
  types.push({name: 'Program', methods: [{name: 'Main', locals: ['C' + (depth - 1)], result: 'string', body(writer, context) {
    writer.op('ldloca.s', 0).op('constrained.', context.resolve('C' + (depth - 1)))
      .op('callvirt', context.member('System.Object', 'ToString', 'string', [], false)).op('ret');
  }}]});
  const report = verifyCilAssembly(genericCallFixture(types));
  assert.equal(report.success, depth === 64, JSON.stringify(report.issues));
  if (depth === 65) assert(report.issues.some(issue => issue.message.includes('64 levels')));
});
