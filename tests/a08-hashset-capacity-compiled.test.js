import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {hashSetValues} from '@sharpforge/bcl-collections';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {
  hashSetCapacitySource, capacityTranscript, hashSetCapacityAssembly, nullHashSetCapacityAssembly
} from './fixtures/hashset-capacity.js';

const captured = JSON.parse(readFileSync(new URL('../packages/bcl-collections/reference/hash-set-capacity-net10.json', import.meta.url)));
const rows = captured.rows.filter(row => !row.name.startsWith('native-prime-boundary-'));
const source = 'using System; using System.Collections.Generic;\n' + rows.map(hashSetCapacitySource).join('\n');
const expected = rows.map(capacityTranscript).join('');

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`SF-A08-T13 ${pipeline}/${engine}: complete capacity source overloads match the native transcript`, () => {
      const program = compileToIL(source, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, expected);
      } finally { vm.stop(); }
    });

    test(`SF-A08-T13 ${pipeline}/${engine}: readonly Capacity and the exact one-argument overloads bind on every closed type`, () => {
      const code = ['using System; using System.Collections.Generic;'];
      for (const element of ['int', 'double', 'bool', 'string', 'object']) {
        code.push(`{ var values = new HashSet<${element}>(); Console.WriteLine(values.Capacity);`);
        code.push('Console.WriteLine(values.EnsureCapacity(8)); values.TrimExcess(4); Console.WriteLine(values.Capacity);');
        code.push('values.TrimExcess(); Console.WriteLine(values.Capacity); }');
      }
      const program = compileToIL(code.join('\n'), {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '0\n11\n7\n3\n'.repeat(5));
      } finally { vm.stop(); }
      const invalid = compileToIL('using System.Collections.Generic; var values = new HashSet<int>(); values.Capacity = 1;', {pipeline});
      assert.equal(invalid.success, false, 'Capacity has no setter');
    });
  }
}

test('SF-A08-T13 independent CIL: native MemberRefs preserve return values, capacity, contents and range faults', () => {
  const ordinary = rows.filter(row => row.constructor.kind !== 'array' && row.steps.every(step => step.operation !== 'UnionWith'));
  for (const row of ordinary) {
    for (let index = 0; index < row.steps.length; index++) {
      const step = row.steps[index];
      if (!step.operation.startsWith('TrimExcess') && step.operation !== 'EnsureCapacity') continue;
      const vm = new CilVirtualMachine(hashSetCapacityAssembly(row, index));
      try {
        const result = vm.run();
        const label = row.name + '/' + index;
        if (step.fault) {
          assert.equal(result.state, 'faulted', label);
          assert.equal('System.' + result.fault.name, step.fault, label);
        } else {
          assert.equal(result.state, 'terminated', result.fault?.stack);
          if (step.operation === 'EnsureCapacity') assert.equal(vm.statics.get(0x04000002), step.result, label);
          assert.equal(vm.statics.get(0x04000003), step.capacity, label);
          assert.equal(vm.statics.get(0x04000004), step.count, label);
        }
        const reference = vm.statics.get(0x04000001);
        assert.deepEqual([...hashSetValues(vm.platform, reference)].map(value => vm.platform.native(value)), step.values, label);
      } finally { vm.stop(); }
    }
  }
});

test('SF-A08-T13 independent CIL: each null receiver precedes any negative capacity check', () => {
  const fixtures = [nullHashSetCapacityAssembly()];
  for (const step of [
    {operation: 'EnsureCapacity', argument: -1}, {operation: 'TrimExcess'}, {operation: 'TrimExcessCapacity', argument: -1}
  ]) fixtures.push(hashSetCapacityAssembly({constructor: {kind: 'null'}, steps: [step]}));
  for (const assembly of fixtures) {
    const vm = new CilVirtualMachine(assembly);
    try {
      const result = vm.run();
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.name, 'NullReferenceException');
    } finally { vm.stop(); }
  }
});

test('SF-A08-T13 independent CIL: every registered closed owner admits the complete exact capacity family', () => {
  const row = captured.rows.find(item => item.name === 'allocated-empty-prime-floor');
  const expected = row.steps.at(-1);
  for (const element of ['int', 'double', 'bool', 'string', 'object']) {
    const vm = new CilVirtualMachine(hashSetCapacityAssembly({...row, element}));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(vm.statics.get(0x04000003), expected.capacity, element);
      assert.equal(vm.statics.get(0x04000004), expected.count, element);
    } finally { vm.stop(); }
  }
});
