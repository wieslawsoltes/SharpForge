import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {verifyCilAssembly} from '@sharpforge/cil';
import {genericCallFixture} from './support/generic-call-fixture.js';

function fixture() {
  return genericCallFixture([
    {name: 'Cell`1', base: 'System.ValueType', flags: 0x100109, genericParameters: [{}],
      fields: [{name: 'Value', type: '!0'}], methods: [
        {name: '.ctor', static: false, parameters: ['!0'], body(writer, context) {
          writer.op('ldarg.0').op('ldarg.1').op('stfld', context.fields.get('Cell`1.Value')).op('ret');
        }},
        {name: 'Read', static: false, result: '!0', body(writer, context) {
          writer.op('ldarg.0').op('ldfld', context.fields.get('Cell`1.Value')).op('ret');
        }}
      ]},
    {name: 'Program', methods: [
      {name: 'Main', locals: ['valuetype Cell`1<string>', 'valuetype Cell`1<string>', 'valuetype Cell`1<int>'],
        body(writer, context) {
          const referenceCell = context.typeSpec('valuetype Cell`1<string>');
          const integerCell = context.typeSpec('valuetype Cell`1<int>');
          const identity = context.methodSpec(context.methods.get('Program.Identity'), ['valuetype Cell`1<string>']);
          const referenceField = context.field(referenceCell, 'Value', '!0');
          writer.op('ldstr', 0x70000000 + context.md.userString('copied reference'));
          writer.op('newobj', context.member(referenceCell, '.ctor', 'void', ['!0'], false)).op('stloc.0');
          writer.op('ldloc.0').op('call', identity).op('stloc.1');
          writer.op('ldloca.s', 0).op('ldnull').op('stfld', referenceField);
          writer.op('ldloca.s', 1).op('call', context.member(referenceCell, 'Read', '!0', [], false));
          writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['string']));
          writer.op('ldc.i4.s', 37).op('newobj', context.member(integerCell, '.ctor', 'void', ['!0'], false)).op('stloc.2');
          writer.op('ldloca.s', 2).op('call', context.member(integerCell, 'Read', '!0', [], false));
          writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['int'])).op('ret');
        }},
      {name: 'Identity', genericParameters: [{}], parameters: ['!!0'], result: '!!0',
        body: writer => writer.op('ldarg.0').op('ret')}
    ]}
  ]);
}

test('closed generic aggregate constructors, instance methods and MethodSpec values keep independent storage', () => {
  const bytes = fixture();
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, true, JSON.stringify(report.issues));
  const vm = new CilVirtualMachine(bytes);
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, 'copied reference\n37\n');
  } finally { vm.stop(); }
});

test('generic aggregate calls preserve reference fields through collection and repeated snapshots', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity,
      onInstruction: (_instruction, frame) => frame.method.name === 'Identity'});
    assert.equal(vm.state, 'paused');
    const snapshot = vm.snapshot();
    for (let replay = 0; replay < 2; replay++) {
      vm.restore(snapshot);
      vm.heap.collect();
      vm.state = 'running';
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, 'copied reference\n37\n');
    }
  } finally { vm.stop(); }
});
