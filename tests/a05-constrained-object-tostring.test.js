import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, codedIndex, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

function callToString(writer, context, type = context.resolve('Point')) {
  writer.op('constrained.', type).op('callvirt', context.member('System.Object', 'ToString', 'string', [], false));
}

function fixture({override = false, newSlot = false, initialize = false, main, throwing = false,
  explicit = false, initLocals = true, typeFlags = 0x100109, fieldType = 'int', overrideBody, overrideSignature} = {}) {
  const methods = [];
  if (override || newSlot || explicit) methods.push({name: 'ToString', static: false,
    flags: newSlot ? 0x1c6 : 0xc6, result: 'string', signature: overrideSignature, body: overrideBody ?? ((writer, context) => {
      if (throwing) { writer.op('ldnull').op('throw'); return; }
      writer.op('call', context.member('System.GC', 'Collect', 'void'));
      writer.op('ldarg.0').op('dup').op('ldfld', context.fields.get('Point.X'))
        .op('ldc.i4.5').op('add').op('stfld', context.fields.get('Point.X'));
      writer.op('ldstr', 0x70000000 + context.md.userString('override')).op('ret');
    })});
  if (initialize) methods.push({name: '.cctor', body(writer, context) {
    writer.op('ldsfld', context.fields.get('Point.Initializations')).op('ldc.i4.1').op('add')
      .op('stsfld', context.fields.get('Point.Initializations')).op('ret');
  }});
  return genericCallFixture([
    {name: 'Point', base: 'System.ValueType', flags: initialize ? typeFlags & ~0x100000 : typeFlags,
      fields: [{name: 'X', type: fieldType}, {name: 'Initializations', type: 'int', flags: 0x16}], methods},
    {name: 'Other', base: 'System.ValueType', flags: 0x100109, fields: [{name: 'X', type: 'int'}], methods: []},
    {name: 'Program', methods: [{name: 'Main', result: 'string', initLocals,
      locals: ['valuetype Point', 'valuetype Point', 'string', 'valuetype Other'], body(writer, context) {
        if (main) { main(writer, context); return; }
        writer.op('ldloca.s', 0);
        callToString(writer, context);
        writer.op('ret');
      }}]}
  ], {decorate(context) {
    if (explicit) context.md.add(25, [context.types.get('Point') & 0xffffff,
      codedIndex('MethodDefOrRef', context.methods.get('Point.ToString')),
      codedIndex('MethodDefOrRef', context.member('System.Object', 'ToString', 'string', [], false))]);
  }});
}

function withVM(bytes, callback, options = {}, VM = CilVirtualMachine) {
  const vm = new VM(bytes, options);
  try { callback(vm); } finally { vm.stop(); }
}

for (const override of [false, true]) for (const decodePlans of [false, true]) {
  test(`concrete ToString ${override ? 'override' : 'fallback'} with decodePlans=${decodePlans}`, () => {
    withVM(fixture({override}), vm => {
      const allocations = vm.heap.stats.allocations;
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(vm.format(vm.returnValue), override ? 'override' : 'Point');
      assert.equal(vm.heap.stats.allocations - allocations, override ? 1 : 2, 'one result string, plus only the fallback box');
      assert.equal(vm.heap.records.filter(record => record?.kind === 'box').length, override ? 0 : 1);
    }, {decodePlans});
  });
}

test('a newslot ToString hides rather than overrides Object.ToString', () => {
  withVM(fixture({newSlot: true}), vm => {
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.format(vm.returnValue), 'Point');
  });
});

test('the override receives the original address while an earlier value copy is isolated', () => {
  const bytes = fixture({override: true, main(writer, context) {
    writer.op('ldloca.s', 0).op('ldc.i4.s', 10).op('stfld', context.fields.get('Point.X'));
    writer.op('ldloc.0').op('stloc.1').op('ldloca.s', 0);
    callToString(writer, context);
    writer.op('stloc.2').op('ldloc.2').op('ret');
  }});
  withVM(bytes, vm => {
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity, onInstruction(instruction, frame) {
      return frame.method.owner === 'Program' && instruction.name === 'ret';
    }});
    assert.equal(vm.state, 'paused');
    assert.equal(vm.top.locals[0].fields[0], 15);
    assert.equal(vm.top.locals[1].fields[0], 10);
    assert(vm.heap.stats.collections > 0);
    vm.state = 'running';
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.format(vm.returnValue), 'override');
  });
});

test('fallback copies the value and pins its box during allocation and formatting callbacks', () => {
  class CollectingVM extends CilVirtualMachine {
    format(value, type) {
      if (value?.h !== undefined && this.heap.get(value).kind === 'box') {
        this.heap.collect();
        assert.equal(this.heap.get(value).type, 'Point');
      }
      return super.format(value, type);
    }
  }
  withVM(fixture({main(writer, context) {
    writer.op('ldloca.s', 0).op('ldc.i4.s', 9).op('stfld', context.fields.get('Point.X')).op('ldloca.s', 0);
    callToString(writer, context);
    writer.op('stloc.2').op('ldloca.s', 0).op('ldc.i4.s', 77).op('stfld', context.fields.get('Point.X'));
    writer.op('ldloc.2').op('ret');
  }}), vm => {
    vm.heap.threshold = 0;
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity, onInstruction(instruction) {
      return instruction.name === 'ret';
    }});
    assert.equal(vm.state, 'paused');
    const box = vm.heap.records.find(record => record?.kind === 'box');
    assert.equal(box.data[0].fields[0], 9);
    assert.equal(box.methodTable, vm.typeSystem.table('Point'));
    assert.equal(vm.top.locals[0].fields[0], 77);
    assert.notEqual(box.data[0], vm.top.locals[0]);
    assert(vm.heap.stats.collections >= 2);
    vm.state = 'running';
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.format(vm.returnValue), 'Point');
  }, {}, CollectingVM);
});

test('a temporary array interior remains rooted after the call consumes its only address', () => {
  class CollectingVM extends CilVirtualMachine {
    format(value, type) {
      if (value?.h !== undefined && this.heap.get(value).kind === 'box') {
        this.heap.collect();
        assert.equal(this.heap.records.filter(record => record?.kind === 'array').length, 1);
      }
      return super.format(value, type);
    }
  }
  withVM(fixture({main(writer, context) {
    const type = context.resolve('Point');
    writer.op('ldc.i4.1').op('newarr', type).op('ldc.i4.0').op('ldelema', type);
    callToString(writer, context);
    writer.op('ret');
  }}), vm => {
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.format(vm.returnValue), 'Point');
  }, {}, CollectingVM);
});

for (const override of [false, true]) test(`cctor retry preserves ${override ? 'override' : 'fallback'} operands and snapshot`, () => {
  withVM(fixture({override, initialize: true}), vm => {
    vm.runSlice({instructionBudget: 3, timeBudgetMs: Infinity});
    assert.equal(vm.top.method.name, '.cctor');
    assert.equal(vm.frames[0].stack.length, 1);
    const snapshot = vm.snapshot();
    for (let replay = 0; replay < 2; replay++) {
      vm.restore(snapshot);
      assert.equal(vm.run().state, 'terminated');
      assert.equal(vm.format(vm.returnValue), override ? 'override' : 'Point');
      assert.equal([...vm.statics.values()].filter(value => value === 1).length, 1);
    }
  });
});

for (const budget of [2, 3]) test(`snapshot at ${budget === 2 ? 'prefix boundary' : 'override entry'} retains owned receiver`, () => {
  withVM(fixture({override: true}), vm => {
    vm.runSlice({instructionBudget: budget, timeBudgetMs: Infinity});
    assert.equal(vm.top.method.owner, budget === 2 ? 'Program' : 'Point');
    const address = budget === 2 ? vm.top.stack[0] : vm.top.args[0];
    const snapshot = vm.snapshot();
    for (let replay = 0; replay < 2; replay++) {
      vm.restore(snapshot);
      vm.heap.collect();
      assert.equal(vm.run().state, 'terminated');
      assert.equal(vm.format(vm.returnValue), 'override');
    }
    vm.restore(snapshot);
    vm.stop();
    assert.throws(() => vm.dereference(address), {name: 'InvalidProgramException'});
  });
});

for (const override of [false, true]) for (const receiver of ['copy', 'wrong', 'readonly', 'foreign', 'uninitialized']) {
  test(`${override ? 'override' : 'fallback'} rejects ${receiver} receiver`, () => {
    const bytes = fixture({override, initLocals: receiver !== 'uninitialized'});
    withVM(bytes, vm => withVM(bytes, other => {
      vm.runSlice({instructionBudget: 2, timeBudgetMs: Infinity});
      if (receiver === 'copy') vm.top.stack[0] = vm.top.locals[0];
      if (receiver === 'wrong') vm.top.stack[0] = vm.address('local', 3);
      if (receiver === 'readonly') vm.top.stack[0] = Object.freeze({...vm.top.stack[0], readonly: true});
      if (receiver === 'foreign') vm.top.stack[0] = other.address('local', 0);
      assert.equal(vm.run().fault?.name, receiver === 'readonly' ? 'NotSupportedException' : 'InvalidProgramException');
    }));
  });
}

test('throwing override releases frames without allocating a receiver box', () => {
  withVM(fixture({override: true, throwing: true}), vm => {
    assert.equal(vm.run().fault?.name, 'NullReferenceException');
    assert.equal(vm.frames.length, 0);
    assert.equal(vm.heap.records.some(record => record?.kind === 'box'), false);
  });
});

test('verification reaches the selected override and fallback initializer bodies', () => {
  const invalid = writer => writer.op('pop').op('ret');
  assert.equal(verifyCilAssembly(fixture({override: true, overrideBody: invalid})).success, false);
  const inspector = new AssemblyInspector(fixture({initialize: true}));
  const initializer = [...inspector.methods.values()].find(method => method.name === '.cctor');
  const body = inspector.getMethod(initializer.token);
  body.instructions[0] = {...body.instructions[0], name: 'pop', operandKind: 'none'};
  assert.equal(verifyCilAssembly(inspector).success, false);
});

test('explicit Object MethodImpl remains unsupported', () => {
  const report = verifyCilAssembly(fixture({explicit: true}));
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.message.includes('Explicit Object.ToString')));
});

for (const position of ['declaration', 'override']) test(`explicitThis ${position} cannot hide behind a display signature`, () => {
  const bytes = position === 'override' ? fixture({override: true, overrideSignature: new Uint8Array([0x60, 0, 0x0e])})
    : fixture({main(writer, context) {
      const target = context.member('System.Object', 'ToString', 'string', [], false, {explicitThis: true});
      writer.op('ldloca.s', 0).op('constrained.', context.resolve('Point')).op('callvirt', target).op('ret');
    }});
  assert.equal(verifyCilAssembly(bytes).success, false);
});

for (const typeFlags of [0x100101, 0x100111]) test(`unsupported struct layout flags ${typeFlags} do not select Object fallback`, () => {
  const report = verifyCilAssembly(fixture({typeFlags}));
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_PREFIX'));
});

test('reference-containing storage is not admitted by the Object fallback', () => {
  assert.throws(() => new CilVirtualMachine(fixture({fieldType: 'object'})), {name: 'NotSupportedException'});
});

for (const member of ['Equals', 'GetHashCode']) test(`Object.${member} remains outside the constrained leaf`, () => {
  const report = verifyCilAssembly(fixture({main(writer, context) {
    writer.op('ldloca.s', 0);
    if (member === 'Equals') writer.op('ldnull');
    writer.op('constrained.', context.resolve('Point'))
      .op('callvirt', context.member('System.Object', member, member === 'Equals' ? 'bool' : 'int',
        member === 'Equals' ? ['object'] : [], false)).op('pop').op('ldnull').op('ret');
  }}));
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_PREFIX'));
});

for (const receiver of ['enum', 'primitive', 'generic-struct', 'method-parameter']) {
  test(`Object.ToString does not broaden ${receiver} constraint admission`, () => {
    const generic = receiver === 'method-parameter';
    const body = (writer, context) => {
      writer.op(generic ? 'ldarg.0' : 'ldnull');
      const type = generic ? context.typeSpec('!!0') : receiver === 'primitive'
        ? context.resolve('System.Int32') : context.resolve('Receiver');
      callToString(writer, context, type);
      writer.op('ret');
    };
    const bytes = genericCallFixture([
      {name: 'Receiver', base: generic ? 'System.Object'
        : receiver === 'enum' ? 'System.Enum' : 'System.ValueType', flags: 0x100109,
        ...(receiver === 'generic-struct' ? {genericParameters: [{}]} : {}), methods: []},
      {name: 'Program', methods: [
        ...(generic ? [{name: 'Apply', genericParameters: [{}], parameters: ['!!0&'], result: 'string', body}] : []),
        {name: 'Main', result: 'string', body: generic ? (writer, context) => {
          writer.op('ldnull').op('call', context.methodSpec(context.methods.get('Program.Apply'), ['Receiver'])).op('ret');
        } : body}
      ]}
    ]);
    const report = verifyCilAssembly(bytes);
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.code === 'IL_PREFIX'), JSON.stringify(report.issues));
  });
}
