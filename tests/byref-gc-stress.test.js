import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {compile} from '@sharpforge/compiler';
import {valueFixture} from './a05-03-fixtures.js';

function program(seed) {
  let state = seed + 1;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  const operations = Array.from({length: 8}, () => ({set: !!(random() & 16), value: random() % 1000}));
  let expected = 0;
  for (const operation of operations) expected = operation.set ? operation.value : expected + operation.value;
  return {operations, expected};
}

function cilProgram(seed, operations) {
  return valueFixture([
    {name: 'Main', result: 'int', locals: ['Fixture.Outer', 'Fixture.Outer[]', 'int&', 'object'], body(writer, context) {
      if (seed & 1) {
        writer.op('ldloca.s', 0).op('initobj', context.outer);
        writer.op('ldloc.0').op('box', context.outer).op('stloc.3');
        writer.op('ldloc.3').op('unbox', context.outer);
      } else {
        writer.op('ldc.i4.1').op('newarr', context.outer).op('stloc.1');
        writer.op('ldloc.1').op('ldc.i4.0').op('ldelema', context.outer);
      }
      writer.op('ldflda', context.nested).op('ldflda', context.number).op('stloc.2');
      writer.op('ldnull').op('stloc.1').op('ldnull').op('stloc.3');
      for (const operation of operations) {
        writer.op('ldloc.2').op('ldc.i4', operation.value);
        if (operation.set) writer.op('stind.i4');
        else writer.op('call', context.methods.Bump);
      }
      writer.op('ldloc.2').op('ldind.i4').op('ret');
    }},
    {name: 'Bump', parameters: ['int&', 'int'], body(writer) {
      writer.op('ldarg.0').op('dup').op('ldind.i4').op('ldarg.1').op('add').op('stind.i4').op('ret');
    }}
  ]);
}

test('1000 seeded managed programs preserve byref owners with collection after every instruction', () => {
  for (let seed = 0; seed < 1000; seed++) {
    const {operations, expected} = program(seed);
    const vm = new CilVirtualMachine(cilProgram(seed, operations), {gcStress: 'instruction'});
    vm.run();
    assert.equal(vm.state, 'terminated', 'seed ' + seed + ': ' + vm.fault?.message);
    assert.equal(vm.returnValue, expected, 'seed ' + seed);
    assert.ok(vm.heap.stats.collections >= vm.instructions - 1, 'GC hook missing for seed ' + seed);
  }
});

test('source ref/out programs retain array interiors under instruction GC', () => {
  for (let seed = 0; seed < 1000; seed++) {
    const {operations, expected} = program(seed);
    const steps = operations.map(operation => operation.set
      ? 'interior = ' + operation.value + ';' : 'Bump(ref interior, ' + operation.value + ');').join('\n');
    const compiled = compile(`class Program {
      static void Bump(ref int value, int amount) { value = value + amount; }
      static int Main() {
        int[] values = new int[1];
        ref int interior = ref values[0];
        values = null;
        ${steps}
        return interior;
      }
    }`);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const vm = new VirtualMachine(compiled.image, {gcStress: 'instruction'});
    vm.run();
    assert.equal(vm.state, 'terminated', 'source seed ' + seed + ': ' + vm.fault?.message);
    assert.equal(vm.returnValue, expected, 'source seed ' + seed);
    assert.ok(vm.heap.stats.collections >= vm.instructions - 1);
  }
});

test('stress oracle detects owner-root removal', () => {
  const {operations} = program(0);
  const vm = new CilVirtualMachine(cilProgram(0, operations), {gcStress: 'instruction'});
  // Mutation sensitivity: deliberately remove roots, keeping the runtime otherwise identical.
  vm.heap.rootProvider = () => [];
  vm.run();
  assert.equal(vm.state, 'faulted');
  assert.match(vm.fault?.message ?? '', /[Ss]tale|[Ii]nvalid managed reference/);
});
