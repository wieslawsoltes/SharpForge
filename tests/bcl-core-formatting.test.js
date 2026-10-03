import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine, ManagedFault, VirtualMachine, isReference} from '@sharpforge/runtime';
import {frameworkType} from '@sharpforge/framework';
import {formatBclValue, compositeFormat, formattingModule} from '../packages/bcl-core/src/formatting/index.js';

function createPlatform(engine) {
  const compiled = compileToIL('using System; class Program { static void Main() {} }');
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
  vm.platform.bclHost = {frameworkType, isReference, fault: (type, message) => { throw new ManagedFault(type, message); }};
  return vm.platform;
}

for (const engine of ['source', 'cil']) {
  test(`BCL formatting ${engine}: released formats and exact midpoint rounding`, () => {
    const platform = createPlatform(engine);
    const cases = [
      [42, 'D4', 'int', '0042'],
      [-1, 'X', 'int', 'FFFFFFFF'],
      [2.25, 'F1', 'double', '2.2'],
      [3.125, 'F2', 'double', '3.12'],
      [-0, 'F2', 'double', '-0.00'],
      [1234.5, 'N2', 'double', '1,234.50'],
      [0.25, 'P0', 'double', '25 %'],
      [12, 'E2', 'double', '1.20E+001'],
      [12, 'e2', 'double', '1.20e+001'],
      [12.345, 'G3', 'double', '12.3']
    ];
    for (const [value, format, type, expected] of cases) {
      assert.equal(formatBclValue(platform, platform.managed(value, type), format, 0, type), expected);
    }
    assert.equal(formatBclValue(platform, null, '', 3), '   ');
    assert.equal(formatBclValue(platform, platform.managed(true, 'bool'), '', -6, 'bool'), 'True  ');
  });

  test(`BCL formatting ${engine}: boxed composite values and brace validation`, () => {
    const platform = createPlatform(engine);
    const formatType = platform.heap.string('int');
    const boxed = formattingModule.invoke(platform, {name: 'BoxValue'}, [42, formatType]).value;
    assert.equal(compositeFormat(platform, '{{{0,6:D4}}}:{1}', [boxed, null]), '{  0042}:');
    for (const format of ['{', '}', '{1}', '{0:bad}']) {
      assert.throws(() => compositeFormat(platform, format, [boxed]), ManagedFault);
    }
    // The pinned .NET 10.0.5 corpus accepts composite width 1,000,000, beyond the direct helper's alignment limit.
    const aligned = compositeFormat(platform, '{0,100001}', [boxed]);
    assert.equal(aligned.length, 100001);
    assert.equal(aligned.slice(-2), '42');
    assert.equal(aligned.slice(0, -2), ' '.repeat(99999));
    assert.throws(() => compositeFormat(platform, '{0,1000001}', [boxed]), {name: 'OutOfMemoryException'});
    assert.throws(() => formatBclValue(platform, platform.managed(1, 'double'), 'D', 0, 'double'), {name: 'FormatException'});
    assert.throws(() => formatBclValue(platform, 1, '', -100001), {name: 'ArgumentOutOfRangeException'});
    assert.throws(() => formatBclValue(platform, 1, '', 100001), {name: 'ArgumentOutOfRangeException'});
    assert.throws(() => compositeFormat(platform, 'x'.repeat(1000001), []), {name: 'OutOfMemoryException'});
    const unknownType = platform.heap.string('unsupported');
    assert.throws(() => formattingModule.invoke(platform, {name: 'BoxValue'}, [1, unknownType]), {name: 'InvalidOperationException'});
  });
}
