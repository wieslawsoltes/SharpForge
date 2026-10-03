import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {Op, frameworkBuiltin} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';
import {sourceImage} from './fixtures/a07/legacy-builtin-engines.js';

const directory = new URL('./fixtures/json-number-formatting/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('oracle.json', directory), 'utf8'));
const serialize = frameworkBuiltin(findContracts('System.Text.Json.JsonSerializer', 'Serialize', true)[0]);
const box = frameworkBuiltin(findContracts('SharpForge.Runtime.Formatting', 'BoxValue', true)[0]);

function numberFromBits(bits) {
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setBigUint64(0, BigInt('0x' + bits));
  return bytes.getFloat64(0);
}

function sourceNumber(value) {
  const image = sourceImage({name: serialize.name, args: [value, 'double'], result: 'string'});
  image.methods[0].code = Int32Array.from([
    Op.CONST, 0, 0, Op.CONST, 1, 0, Op.BUILTIN, box.id, 2,
    Op.BUILTIN, serialize.id, 1, Op.RET, 0, 0
  ]);
  return new VirtualMachine(image);
}

function numberAssembly() {
  return managedFixture({methods: [{
    name: 'Main', parameters: ['double'], result: 'string',
    body(writer, context) {
      writer.op('ldarg.0').op('box', context.resolve('System.Double'));
      writer.op('call', context.member('System.Text.Json.JsonSerializer', 'Serialize', 'string', ['object']));
      writer.op('ret');
    }
  }]});
}

function doubleLiteral(bits) {
  const value = numberFromBits(bits);
  return Object.is(value, -0) ? '-0.0' : value.toExponential();
}

let containers;
function compiledContainers() {
  if (containers) return containers;
  const statements = reference.cases.filter(row => !row.exception).flatMap(row => {
    const value = doubleLiteral(row.bits);
    return [
      `Console.WriteLine(JsonSerializer.Serialize(new object[] {${value}, -0.0, 42, "1e+21 <é>"}));`,
      `Console.WriteLine(JsonSerializer.Serialize(new Dictionary<string, double> {{"n<é+>", ${value}}, {"zero", -0.0}}));`
    ];
  });
  statements.push(
    'Console.WriteLine(JsonSerializer.Serialize(-2147483648));',
    'Console.WriteLine(JsonSerializer.Serialize(2147483647));',
    'Console.WriteLine(JsonSerializer.Serialize(null));',
    'Console.WriteLine(JsonSerializer.Serialize("1e+21 -0 1e-7 <é>"));'
  );
  containers = compileToIL('using System; using System.Text.Json; using System.Collections.Generic;\n' + statements.join('\n'));
  assert.equal(containers.success, true, JSON.stringify(containers.diagnostics));
  return containers;
}

for (const engine of ['source', 'cil']) {
  test(`SF-A09-B01 ${engine} binary64 JSON tokens match all pinned finite native values`, () => {
    const assembly = engine === 'cil' ? numberAssembly() : null;
    for (const row of reference.cases) {
      const value = numberFromBits(row.bits);
      const vm = engine === 'source' ? sourceNumber(value) : new CilVirtualMachine(assembly, {arguments: [value]});
      try {
        const result = vm.run();
        if (row.exception) {
          // Preserve the released runtime's policy; .NET reports ArgumentException for nonfinite input.
          assert.equal(row.exception, 'ArgumentException');
          assert.equal(result.fault?.name, 'JsonException', row.name);
        } else {
          assert.equal(result.state, 'terminated', result.fault?.stack);
          assert.equal(vm.value(vm.returnValue), row.scalar, row.name);
        }
      } finally {
        vm.stop();
      }
    }
  });

  test(`SF-A09-B01 ${engine} compiled mixed arrays and dictionary values retain native numeric spelling`, () => {
    const compiled = compiledContainers();
    const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      const lines = reference.cases.filter(row => !row.exception).flatMap(row => [row.array, row.dictionary]);
      lines.push(...Object.values(reference.controls));
      assert.equal(result.output, lines.join('\n') + '\n');
    } finally {
      vm.stop();
    }
  });

  test(`SF-A09-B01 ${engine} numeric token expansion respects the existing output budget`, () => {
    const compiled = compileToIL('Console.WriteLine(0);');
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
    const encode = count => {
      const text = vm.heap.string('a'.repeat(count));
      return vm.heap.withRoots([text], () => {
        const input = vm.heap.allocate('array', 'object[]', [text, vm.platform.managed(1e-7, 'double')]);
        return vm.platform.native(vm.platform.invoke(serialize.contract, [input]));
      });
    };
    try {
      assert.equal(encode(999990).length, 1_000_000);
      assert.throws(() => encode(999991), {name: 'JsonException'});
    } finally {
      vm.stop();
    }
  });
}

test('SF-A09-B01 numeric oracle pins fifty values, source, SDK and runtime', () => {
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.cases.length, 50);
  assert.equal(reference.cases.filter(row => row.exception).length, 3);
  const source = readFileSync(new URL('Program.cs', directory));
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
});
