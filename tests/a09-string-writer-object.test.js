import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {BuiltinMap} from '@sharpforge/bytecode';
import {intrinsicDefinitions, loadAssembly} from '@sharpforge/cil';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {invokeIntrinsic} from '../packages/runtime/src/execution/intrinsics.js';
import {managedFixture} from './managed-fixtures.js';
import {writerPlatform, writerContract, writerType, parentType, builderType} from './fixtures/text-writer/engines.js';

const directory = new URL('../packages/bcl-io/reference/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('string-writer-object-net10.json', directory), 'utf8'));
const objectString = intrinsicDefinitions.find(entry => entry.implementation === 'objectToString').descriptor;
const engines = {source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly),
  roundtrip: program => new VirtualMachine(loadAssembly(program.assembly))};

function compile(source) {
  const program = compileToIL('using System;using System.IO;' + source);
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  return program;
}

function assembly({name, kind}) {
  return managedFixture({name: 'StringWriterObject', methods: [{name: 'Main', result: 'string', locals: [writerType], body(w, c) {
    if (name === 'null') w.op('ldnull');
    else {
      w.op('newobj', c.member(writerType, '.ctor', 'void', [], false)).op('stloc.0');
      if (name !== 'empty') {
        w.op('ldloc.0').op('ldstr', 0x70000000 + c.md.userString('value'))
          .op('callvirt', c.member(parentType, 'Write', 'void', ['string'], false));
      }
      if (name === 'disposed' || name === 'mutated-after-disposal') {
        w.op('ldloc.0').op('callvirt', c.member(parentType, 'Dispose', 'void', [], false));
      }
      if (name === 'mutated-after-disposal') {
        w.op('ldloc.0').op('callvirt', c.member(writerType, 'GetStringBuilder', builderType, [], false))
          .op('ldstr', 0x70000000 + c.md.userString('!'))
          .op('callvirt', c.member(builderType, 'Append', builderType, ['string'], false)).op('pop');
      }
      w.op('ldloc.0');
    }
    w.op(kind, c.member('System.Object', 'ToString', 'string', [], false)).op('ret');
  }}]});
}

function render(writer, engine) {
  const {vm, reference} = writer;
  return engine === 'source' ? vm.builtin(BuiltinMap.get('object.ToString').id, [reference]) :
    vm.heap.withRoots([reference], () => invokeIntrinsic(vm, objectString, [reference], true));
}

test('StringWriter Object.ToString: pinned source and existing contract identity', () => {
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.rows.length, 10);
  assert.equal(createHash('sha256').update(readFileSync(new URL('string-writer-object/Program.cs', directory))).digest('hex'),
    reference.sourceSha256);
  const contract = writerContract('ToString');
  assert.equal(contract.id, 655380);
  assert.equal(contract.objectToStringOverride, true);
  assert.equal(writerContract('GetStringBuilder').id, 655379);
});

for (const [engine, create] of Object.entries(engines)) {
  test(`StringWriter Object.ToString ${engine}: actual object locals retain current and disposed builder text`, () => {
    const program = compile('var writer = new StringWriter();object value = writer;Console.WriteLine(value.ToString());' +
      'writer.Write("value");Console.WriteLine(value.ToString());writer.Dispose();Console.WriteLine(value.ToString());' +
      'writer.GetStringBuilder().Append("!");Console.WriteLine(value.ToString());');
    const expected = ['empty', 'written', 'disposed', 'mutated-after-disposal']
      .map(name => reference.rows.find(row => row.name === name && row.kind === 'callvirt').value).join('\n') + '\n';
    const vm = create(program);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, expected);
    } finally { vm.stop(); }
  });
}

for (const row of reference.rows) {
  test(`StringWriter Object.ToString independent CIL: ${row.kind} ${row.name}`, () => {
    const vm = new CilVirtualMachine(assembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', result.fault?.stack);
      if (row.fault) assert.equal(result.fault.name, row.fault);
      else assert.equal(vm.value(vm.returnValue), row.value);
    } finally { vm.stop(); }
  });
}

for (const engine of ['source', 'cil']) {
  test(`StringWriter Object.ToString ${engine}: observer GC, disposal faults and snapshot restoration retain the builder`, () => {
    const writer = writerPlatform(engine);
    const {vm, platform, call} = writer;
    const {heap} = platform;
    const builder = call('GetStringBuilder');
    const weak = heap.createHandle(builder, {weak: true});
    const append = findContracts(builderType, 'Append').find(member => member.parameters.join(',') === 'string');
    try {
      vm.onWrite = () => heap.collect();
      call('Write', ['string'], ['before']);
      const saved = heap.snapshot();
      call('Dispose');
      assert.throws(() => call('Write', ['string'], ['rejected']), {name: 'ObjectDisposedException'});
      platform.invoke(append, [builder, 'after']);
      heap.threshold = 0;
      assert.equal(platform.native(render(writer, engine)), 'beforeafter');
      assert.deepEqual(heap.getHandle(weak), builder);
      heap.restore(saved);
      call('Write', ['string'], ['restored']);
      assert.equal(platform.native(render(writer, engine)), 'beforerestored');
      assert.deepEqual(call('GetStringBuilder'), builder);
      assert.equal(heap.pins.length, 0);
    } finally { vm.onWrite = null; heap.releaseHandle(weak); writer.stop(); }
  });

  test(`StringWriter Object.ToString ${engine}: allocation fault leaves text reachable and releases roots`, () => {
    const writer = writerPlatform(engine);
    const {platform, call} = writer;
    const {heap} = platform;
    const budget = heap.maxBytes;
    try {
      call('Write', ['string'], ['retained']);
      heap.maxBytes = 1;
      assert.throws(() => render(writer, engine), {name: 'OutOfMemoryException'});
      assert.equal(heap.pins.length, 0);
      heap.maxBytes = budget;
      assert.equal(platform.native(render(writer, engine)), 'retained');
    } finally { heap.maxBytes = budget; writer.stop(); }
  });
}
