import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const reference = new URL('../packages/bcl-collections/reference/', import.meta.url);
const source = readFileSync(new URL('boxed-object-equality/Program.cs', reference), 'utf8');
const expected = readFileSync(new URL('boxed-object-equality-net10.txt', reference), 'utf8').replaceAll('\r\n', '\n');
let compiled;

for (const engine of ['source', 'cil']) {
  test(`SF-A08-B01 ${engine} boxed collection equality matches .NET 10.0.5`, () => {
    compiled ??= compileToIL(source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, expected);
      const boxedTypes = new Set(vm.heap.records.filter(record => record?.kind === 'box').map(record => record.methodTable.name));
      for (const type of ['System.Int32', 'System.Double', 'System.Boolean']) {
        assert(boxedTypes.has(type), 'Fixture must execute managed boxing for ' + type);
      }
    } finally {
      vm.stop();
    }
  });
}
