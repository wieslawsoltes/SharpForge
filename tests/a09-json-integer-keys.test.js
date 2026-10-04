import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

const directory = new URL('./fixtures/json-integer-keys/', import.meta.url);
const source = readFileSync(new URL('Cases.cs', directory), 'utf8');
const reference = JSON.parse(readFileSync(new URL('oracle.json', directory), 'utf8'));
const nativeCatch = 'catch (JsonException)';
assert.equal(source.split(nativeCatch).length, 2, 'Adapt exactly one unsupported typed catch');
const supportedSource = source.replace(nativeCatch, 'catch (Exception)');

for (const pipeline of ['bound', 'legacy']) {
  let compiled;
  for (const engine of ['source', 'cil']) {
    test(`SF-A09-B02 ${pipeline}/${engine} native JSON retains source Char with only the typed-catch adaptation`, () => {
      compiled ??= compileToIL(supportedSource, {pipeline});
      assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
      assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
      const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.deepEqual(result.output.trimEnd().split('\n'), reference.lines);
        const boxes = vm.heap.records.filter(record => record?.kind === 'box');
        const boxedTypes = new Set(boxes.map(record => record.methodTable.name));
        for (const type of ['System.Int32', 'System.Double', 'System.Boolean', 'System.Char']) {
          assert(boxedTypes.has(type), 'The fixture must execute real managed boxing for ' + type);
        }
        const character = boxes.find(record => record.methodTable.name === 'System.Char');
        assert.equal(vm.platform.native(character.data[0]), 60, 'The native fixture must retain its actual Char payload');
      } finally {
        vm.stop();
      }
    });
  }
}

for (const engine of ['source', 'cil']) {
  test(`SF-A09-B02 ${engine} integer dictionary retains nonfinite and unsupported-object faults`, () => {
    const cases = [
      ['using System.Text.Json; using System.Collections.Generic; ' +
        'class Payload {} class Program { static void Main() { ' +
        'var values = new Dictionary<int, object>(); values.Add(1, new Payload()); JsonSerializer.Serialize(values); } }',
      'NotSupportedException'],
      ['using System.Text.Json; using System.Collections.Generic; ' +
        'var values = new Dictionary<int, double>(); values.Add(1, 0.0 / 0.0); JsonSerializer.Serialize(values);',
      'JsonException'],
      ['using System.Text.Json; using System.Collections.Generic; ' +
        'var values = new Dictionary<int, object>(); values.Add(1, values); JsonSerializer.Serialize(values);',
      reference.lines.at(-1)]
    ];
    for (const [program, expected] of cases) {
      const built = compileToIL(program);
      assert.equal(built.success, true, JSON.stringify(built.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(built.image) : new CilVirtualMachine(built.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'faulted');
        assert.equal(result.fault.name, expected);
      } finally {
        vm.stop();
      }
    }
  });
}

test('SF-A09-B02 independently assembled CIL serializes signed dictionary keys in entry order', () => {
  const owner = 'System.Collections.Generic.Dictionary`2<int, string>';
  const entries = [[2, 'two'], [1, 'one'], [-2147483648, 'minimum'], [2147483647, '<é+>']];
  const assembly = managedFixture({methods: [{
    name: 'Main', result: 'string', maxStack: 4,
    body(writer, context) {
      writer.op('newobj', context.member(owner, '.ctor', 'void', [], false));
      for (const [key, value] of entries) {
        writer.op('dup').op('ldc.i4', key).op('ldstr', 0x70000000 + context.md.userString(value));
        writer.op('callvirt', context.member(owner, 'Add', 'void', ['int', 'string'], false));
      }
      writer.op('call', context.member('System.Text.Json.JsonSerializer', 'Serialize', 'string', ['object'])).op('ret');
    }
  }]});
  const vm = new CilVirtualMachine(assembly);
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    const expected = '{"2":"two","1":"one","-2147483648":"minimum",' +
      '"2147483647":"\\u003C\\u00E9\\u002B\\u003E"}';
    assert.equal(vm.value(vm.returnValue), expected);
  } finally {
    vm.stop();
  }
});

test('SF-A09-B02 independently assembled CIL preserves genuine boxed Char and Boolean JSON values', () => {
  const owner = 'System.Collections.Generic.Dictionary`2<int, object>';
  const entries = [
    [7, null, null], [6, '<é+>', 'string'], [5, 42, 'System.Int32'], [4, 1e-7, 'System.Double'],
    [3, 1, 'System.Boolean'], [2, 0, 'System.Boolean'], [1, 60, 'System.Char']
  ];
  const assembly = managedFixture({methods: [{
    name: 'Main', result: 'string', maxStack: 4,
    body(writer, context) {
      writer.op('newobj', context.member(owner, '.ctor', 'void', [], false));
      for (const [key, value, type] of entries) {
        writer.op('dup').op('ldc.i4', key);
        if (type === null) writer.op('ldnull');
        else if (type === 'string') writer.op('ldstr', 0x70000000 + context.md.userString(value));
        else {
          writer.op(type === 'System.Double' ? 'ldc.r8' : 'ldc.i4', value);
          writer.op('box', context.resolve(type));
        }
        writer.op('callvirt', context.member(owner, 'Add', 'void', ['int', 'object'], false));
      }
      writer.op('call', context.member('System.Text.Json.JsonSerializer', 'Serialize', 'string', ['object'])).op('ret');
    }
  }]});
  const vm = new CilVirtualMachine(assembly);
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(vm.value(vm.returnValue), reference.lines[11]);
    const character = vm.heap.records.find(record => record?.kind === 'box' && record.methodTable.name === 'System.Char');
    assert.equal(character.data[0], 60);
  } finally {
    vm.stop();
  }
});

test('SF-A09-B02 integer dictionary oracle pins source, SDK, runtime and all eighteen cases', () => {
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.lines.length, 18);
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
});
