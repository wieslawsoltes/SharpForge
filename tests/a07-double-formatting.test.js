import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {findContracts} from '@sharpforge/framework';
import {frameworkBuiltin} from '@sharpforge/bytecode';
import {formatDoubleDefault} from '@sharpforge/bcl-core';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';
import {sourceImage, execute} from './fixtures/a07/legacy-builtin-engines.js';

const reference = JSON.parse(readFileSync(new URL('../packages/bcl-core/reference/double-format-net10.json', import.meta.url)));
const formatContract = findContracts('SharpForge.Runtime.Formatting', 'FormatValue', true)[0];

function numberFromBits(bits) {
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setBigUint64(0, BigInt('0x' + bits));
  return bytes.getFloat64(0);
}

function formatAssembly(format) {
  return managedFixture({methods: [{
    name: 'Main', parameters: ['double'], result: 'string',
    body(writer, context) {
      writer.op('ldarg.0').op('box', context.resolve('System.Double'));
      writer.op('ldstr', 0x70000000 + context.md.userString(format)).op('ldc.i4.0');
      writer.op('ldstr', 0x70000000 + context.md.userString('double'));
      writer.op('call', context.member('SharpForge.Runtime.Formatting', 'FormatValue', 'string',
        ['object', 'string', 'int', 'string'])).op('ret');
    }
  }]});
}

function formatterMachine(value, format, engine, assembly) {
  const fixture = {
    name: frameworkBuiltin(formatContract).name,
    args: [value, format, 0, 'double'],
    result: 'string'
  };
  return engine === 'source' ? new VirtualMachine(sourceImage(fixture)) :
    new CilVirtualMachine(assembly, {arguments: [value]});
}

function runFormatter(value, format, engine, assembly) {
  const vm = formatterMachine(value, format, engine, assembly);
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    return vm.value(vm.returnValue);
  } finally {
    vm.stop();
  }
}

function outputAssembly(objectToString = false) {
  return managedFixture({methods: [{
    name: 'Main', parameters: ['double'], result: objectToString ? 'string' : 'void',
    body(writer, context) {
      writer.op('ldarg.0');
      if (objectToString) {
        writer.op('box', context.resolve('System.Double'));
        writer.op('callvirt', context.member('System.Object', 'ToString', 'string', [], false));
      } else writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['double']));
      writer.op('ret');
    }
  }]});
}

function defaultOutput(value, engine, route, assembly) {
  if (route === 'convert') {
    return execute({name: 'Convert.ToString', args: [value], parameter: 'double', result: 'string'}, engine).value;
  }
  const fixture = {
    name: route === 'console' ? 'Console.WriteLine' : 'object.ToString',
    args: [value], result: route === 'console' ? 'void' : 'string'
  };
  const vm = engine === 'source' ? new VirtualMachine(sourceImage(fixture)) :
    new CilVirtualMachine(assembly, {arguments: [value]});
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    return route === 'console' ? result.output : vm.value(vm.returnValue);
  } finally {
    vm.stop();
  }
}

test('SF-A07-B03 reference pins fifty binary64 values and five required formats to .NET 10.0.5', () => {
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.culture, 'InvariantCulture');
  assert.equal(reference.rows.length, 50);
  assert.equal(new Set(reference.rows.map(row => row.bits)).size, 50);
  for (const format of ['', 'G', 'G3', 'G17', 'R']) assert(reference.formats.includes(format));
  for (const row of reference.rows) {
    assert.match(row.bits, /^[0-9a-f]{16}$/);
    assert.deepEqual(Object.keys(row.output), reference.formats);
  }
});

test('SF-A07-B03 public default formatter matches all fifty native binary64 cases', () => {
  for (const row of reference.rows) {
    assert.equal(formatDoubleDefault(numberFromBits(row.bits)), row.output[''], row.name);
  }
});

for (const engine of ['source', 'cil']) {
  test(`SF-A07-B03 ${engine} rejects integer-only and unsupported double formats`, () => {
    for (const format of ['D', 'X', 'Q']) {
      const vm = formatterMachine(1.25, format, engine, engine === 'cil' ? formatAssembly(format) : null);
      try {
        assert.equal(vm.run().fault?.name, 'FormatException', format);
      } finally {
        vm.stop();
      }
    }
  });
  for (const format of reference.formats) {
    test(`SF-A07-B03 ${engine} fifty doubles match .NET format ${JSON.stringify(format)}`, () => {
      const assembly = engine === 'cil' ? formatAssembly(format) : null;
      for (const row of reference.rows) {
        const value = numberFromBits(row.bits);
        assert.equal(runFormatter(value, format, engine, assembly), row.output[format], row.name + ' bits=' + row.bits);
      }
    });
  }
  for (const route of ['console', 'convert', 'object']) {
    test(`SF-A07-B03 ${engine} default double text reaches .NET formatting through ${route}`, () => {
      const assembly = engine === 'cil' && route !== 'convert' ? outputAssembly(route === 'object') : null;
      for (const row of reference.rows) {
        const actual = defaultOutput(numberFromBits(row.bits), engine, route, assembly);
        assert.equal(actual, row.output[''] + (route === 'console' ? '\n' : ''), row.name + ' bits=' + row.bits);
      }
    });
  }
}
