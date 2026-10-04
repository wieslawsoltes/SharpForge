import test from 'node:test';
import assert from 'node:assert/strict';
import {codedIndex, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';
import {controlFixture} from './support/control-fixture.js';

const iface = 'System.Collections.IEnumerator';
function fixture({wrongResult = false, wrongOwner = false, duplicate = false} = {}) {
  return controlFixture([
    {name: 'Program', fields: [{name: 'Cleanup'}], methods: [{name: 'Main', locals: ['Counter', 'int'], body(w, c) {
      w.op('newobj', c.methods.get('Counter..ctor')).op('stloc.0').label('loop').op('ldloc.0')
        .op('callvirt', c.member(iface, 'MoveNext', 'bool', [], false)).op('brfalse', 'end')
        .op('ldloc.1').op('ldloc.0').op('callvirt', c.member(iface, 'get_Current', 'object', [], false))
        .op('unbox.any', c.resolve('System.Int32')).op('add').op('stloc.1').op('br', 'loop').label('end')
        .op('ldloc.0').op('callvirt', c.member('System.IDisposable', 'Dispose', 'void', [], false))
        .op('ldloc.1').op('call', c.member('System.Console', 'WriteLine', 'void', ['int']))
        .op('ldsfld', c.fields.get('Program.Cleanup')).op('call', c.member('System.Console', 'WriteLine', 'void', ['int'])).op('ret');
    }}]},
    {name: 'Counter', interfaces: [wrongOwner ? 'System.Collections.IEnumerable' : iface, 'System.IDisposable'],
      fields: [{name: 'State', flags: 6}], methods: [
        {name: '.ctor', static: false, flags: 0x1886, body(w, c) {
          w.op('ldarg.0').op('call', c.member('System.Object', '.ctor', 'void', [], false)).op('ret');
        }},
        {name: 'Step', static: false, flags: 0x1e1, result: wrongResult ? 'int' : 'bool', body(w, c) {
          w.op('ldarg.0').op('ldarg.0').op('ldfld', c.fields.get('Counter.State')).op('ldc.i4.1').op('add')
            .op('stfld', c.fields.get('Counter.State')).op('ldarg.0').op('ldfld', c.fields.get('Counter.State'))
            .op('ldc.i4.3').op('clt').op('ret');
        }},
        {name: 'Current', static: false, flags: 0x1e1, result: 'object', body(w, c) {
          w.op('ldarg.0').op('ldfld', c.fields.get('Counter.State')).op('box', c.resolve('System.Int32')).op('ret');
        }},
        {name: 'Cleanup', static: false, flags: 0x1e1, body(w, c) {
          w.op('ldsfld', c.fields.get('Program.Cleanup')).op('ldc.i4.1').op('add').op('stsfld', c.fields.get('Program.Cleanup')).op('ret');
        }}
      ]}
  ], {decorate(c) {
    const map = (body, owner, name, result) => c.md.add(25, [c.types.get('Counter') & 0xffffff,
      codedIndex('MethodDefOrRef', c.methods.get('Counter.' + body)),
      codedIndex('MethodDefOrRef', c.member(owner, name, result, [], false))]);
    map('Step', iface, 'MoveNext', 'bool');
    map('Current', iface, 'get_Current', 'object');
    map('Cleanup', 'System.IDisposable', 'Dispose', 'void');
    if (duplicate) map('Step', iface, 'MoveNext', 'bool');
  }});
}

test('T29 external iterator interfaces enter verified explicit implementations and dispose once', () => {
  const bytes = fixture(), report = verifyCilAssembly(bytes);
  assert.equal(report.success, true, JSON.stringify(report.issues));
  const vm = new CilVirtualMachine(bytes), result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.output, '3\n1\n');
});

test('T29 iterator interface calls retain owning frames across portable replay', async () => {
  const bytes = fixture(), vm = new CilVirtualMachine(bytes);
  for (let step = 0; step < 100; step++) {
    vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    const counter = vm.frames[0]?.locals[0];
    if (counter && vm.heap.get(counter).data[0] === 1 && vm.frames.length === 1) break;
  }
  assert.equal(vm.frames.length, 1);
  const wire = await serializeSnapshot(vm, vm.snapshot(), {json: true});
  vm.stop(); vm.heap.collect();
  const fresh = await restoreSerializedSnapshot(new CilVirtualMachine(bytes), wire);
  fresh.heap.collect();
  const result = fresh.run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.output, '3\n1\n');
});

test('T29 external MethodImpl admission rejects wrong signatures, owners and duplicate slots', () => {
  for (const options of [{wrongResult: true}, {wrongOwner: true}, {duplicate: true}]) {
    const report = verifyCilAssembly(fixture(options));
    assert.equal(report.success, false, JSON.stringify(options));
    assert(report.issues.some(issue => /MethodImpl/.test(issue.message)), JSON.stringify(report.issues));
  }
});
