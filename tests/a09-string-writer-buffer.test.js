import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {Op, frameworkBuiltin} from '@sharpforge/bytecode';
import {findContracts} from '@sharpforge/framework';
import {MAX} from '@sharpforge/bcl-core';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';
import {sourceImage} from './fixtures/a07/legacy-builtin-engines.js';
import {writerPlatform, writerContract, writerType, parentType} from './fixtures/text-writer/engines.js';

const directory = new URL('../packages/bcl-io/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-writer-buffer-net10.json', directory), 'utf8'));
const fullParameters = ['char[]'];
const sliceParameters = ['char[]', 'int', 'int'];
const units = value => value.split('').map(unit => unit.charCodeAt(0));

function sourceWriter(row) {
  const image = sourceImage({name: frameworkBuiltin(writerContract('Write', row.full ? fullParameters : sliceParameters)).name,
    args: [], result: 'void'});
  const code = [];
  const emit = (op, first = 0, second = 0) => code.push(op, first, second);
  const constant = value => emit(Op.CONST, image.constants.push(value) - 1);
  const call = (name, parameters, count) => emit(Op.BUILTIN, frameworkBuiltin(writerContract(name, parameters)).id, count);
  if (row.nullWriter) constant(null);
  else call('.ctor', [], 0);
  emit(Op.STSTATIC, 0); emit(Op.POP);
  if (!row.nullWriter) {
    emit(Op.LDSTATIC, 0); constant('seed|'); call('Write', ['string'], 2); emit(Op.POP);
  }
  if (row.disposed) { emit(Op.LDSTATIC, 0); call('Dispose', [], 1); emit(Op.POP); }
  if (row.input === null) constant(null);
  else { constant(row.input.length); emit(Op.NEWARR, image.constants.push('char') - 1); }
  emit(Op.STSTATIC, 1); emit(Op.POP);
  row.input?.forEach((value, index) => {
    emit(Op.LDSTATIC, 1); constant(index); constant(value); emit(Op.STELEM); emit(Op.POP);
  });
  emit(Op.LDSTATIC, 0); emit(Op.LDSTATIC, 1);
  if (!row.full) { constant(row.index); constant(row.count); }
  call('Write', row.full ? fullParameters : sliceParameters, row.full ? 2 : 4); emit(Op.RET);
  image.statics = [{name: 'Writer', type: row.baseView ? parentType : writerType, value: null},
    {name: 'Buffer', type: 'char[]', value: null}];
  image.methods[0].code = Int32Array.from(code);
  return new VirtualMachine(image);
}

function writerAssembly(row) {
  const owner = row.baseView ? parentType : writerType;
  return managedFixture({fields: [{name: 'Writer', type: owner}, {name: 'Buffer', type: 'char[]'}],
    methods: [{name: 'Main', result: 'void', maxStack: 4, body(w, c) {
      const writer = 0x04000000 | c.fields.Writer, buffer = 0x04000000 | c.fields.Buffer;
      const call = (name, parameters = []) => w.op('callvirt', c.member(owner, name, 'void', parameters, false));
      if (row.nullWriter) w.op('ldnull');
      else w.op('newobj', c.member(writerType, '.ctor', 'void', [], false)).op('castclass', c.resolve(owner));
      w.op('stsfld', writer);
      if (!row.nullWriter) {
        w.op('ldsfld', writer).op('ldstr', 0x70000000 + c.md.userString('seed|')); call('Write', ['string']);
      }
      if (row.disposed) { w.op('ldsfld', writer); call('Dispose'); }
      if (row.input === null) w.op('ldnull');
      else w.op('ldc.i4', row.input.length).op('newarr', c.resolve('System.Char'));
      w.op('stsfld', buffer);
      row.input?.forEach((value, index) => w.op('ldsfld', buffer).op('ldc.i4', index).op('ldc.i4', value).op('stelem.i2'));
      w.op('ldsfld', writer).op('ldsfld', buffer);
      if (!row.full) w.op('ldc.i4', row.index).op('ldc.i4', row.count);
      call('Write', row.full ? fullParameters : sliceParameters); w.op('ret');
    }}]});
}

for (const engine of ['source', 'cil']) {
  test(`StringWriter buffer ${engine}: all native full/slice calls preserve text, input and faults`, () => {
    for (const row of native.rows) {
      const vm = engine === 'source' ? sourceWriter(row) : new CilVirtualMachine(writerAssembly(row));
      const field = index => engine === 'source' ? vm.statics[index] : vm.statics.get(0x04000001 + index);
      try {
        const result = vm.run();
        assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
        assert.equal(result.fault?.name ?? null, row.fault, row.id);
        const value = field(0) === null ? null : vm.platform.native(vm.platform.invoke(writerContract('ToString'), [field(0)]));
        assert.deepEqual(value === null ? null : units(value), row.output, row.id);
        assert.deepEqual(field(1) === null ? null : vm.heap.get(field(1)).data, row.buffer, row.id);
      } finally { vm.stop(); }
    }
  });

  test(`StringWriter buffer ${engine}: one bulk chunk preserves storage, input copy and observer GC`, () => {
    const writer = writerPlatform(engine);
    const {platform, vm, reference, call} = writer;
    const {heap} = platform;
    call('Write', ['string'], ['prefix|']);
    const builder = call('GetStringBuilder');
    const beforeBuffer = platform.get(builder, '$data');
    const input = Array.from({length: 17000}, (_, index) => [0, 0xd800, 0xdc00, 0xffff, 65][index % 5]);
    const buffer = heap.allocate('array', 'char[]', [...input]);
    const weak = heap.createHandle(buffer, {weak: true});
    let writes = 0;
    const allocations = heap.stats.allocations;
    try {
      vm.onWrite = event => { if (event.kind === 'array') writes++; heap.collect(); };
      platform.invoke(writerContract('Write', sliceParameters), [reference, buffer, 1, 16998]);
      assert.equal(heap.stats.allocations - allocations, 1, 'One managed string and no growth with spare chunk storage');
      assert.equal(writes, 1);
      assert.deepEqual(platform.get(builder, '$data'), beforeBuffer);
      assert.deepEqual(heap.get(buffer).data, input);
      heap.get(buffer).data.fill(66);
      assert.deepEqual(units(platform.native(call('ToString'))), [...units('prefix|'), ...input.slice(1, -1)]);
      assert.equal(heap.pins.length, 0);
      heap.collect();
      assert.equal(heap.getHandle(weak), null, 'The writer owns copied text, not the caller buffer');
    } finally { vm.onWrite = null; heap.releaseHandle(weak); writer.stop(); }
  });

  test(`StringWriter buffer ${engine}: zero/null writes, snapshots and disposed overload rules`, () => {
    const writer = writerPlatform(engine);
    const {platform, reference, call} = writer;
    const buffer = platform.heap.allocate('array', 'char[]', [65, 66]);
    const root = platform.heap.createHandle(buffer);
    try {
      const before = platform.heap.mutationRevision;
      platform.invoke(writerContract('Write', fullParameters), [reference, null]);
      platform.invoke(writerContract('Write', sliceParameters), [reference, buffer, 2, 0]);
      assert.equal(platform.heap.mutationRevision, before);
      platform.invoke(writerContract('Write', fullParameters), [reference, buffer]);
      const saved = platform.heap.snapshot();
      call('Dispose');
      assert.equal(platform.invoke(writerContract('Write', fullParameters), [reference, null]), null);
      assert.throws(() => platform.invoke(writerContract('Write', sliceParameters), [reference, null, 0, 0]),
        {name: 'ArgumentNullException'});
      assert.throws(() => platform.invoke(writerContract('Write', sliceParameters), [reference, buffer, 2, 0]),
        {name: 'ObjectDisposedException'});
      platform.heap.restore(saved);
      platform.invoke(writerContract('Write', sliceParameters), [reference, buffer, 1, 1]);
      assert.equal(platform.native(call('ToString')), 'ABB');
    } finally { platform.heap.releaseHandle(root); writer.stop(); }
  });

  test(`StringWriter buffer ${engine}: invalid host arrays and numeric slices retain writer content`, () => {
    const writer = writerPlatform(engine);
    const {platform, reference, call} = writer;
    const buffer = platform.heap.array('char', 3);
    const root = platform.heap.createHandle(buffer);
    try {
      for (const invalid of [42, platform.heap.array('int', 3), platform.heap.string('abc')]) {
        assert.throws(() => platform.invoke(writerContract('Write', fullParameters), [reference, invalid]), {name: 'ArgumentException'});
      }
      for (const type of ['char[,]', 'char[*]']) {
        const invalid = platform.heap.allocate('array', type, [65]);
        assert.throws(() => platform.invoke(writerContract('Write', fullParameters), [reference, invalid]), {name: 'ArgumentException'});
      }
      for (const [index, count] of [[0.5, 1], [0, NaN], [0, Infinity], [0, 2147483648]]) {
        assert.throws(() => platform.invoke(writerContract('Write', sliceParameters), [reference, buffer, index, count]),
          {name: 'ArgumentOutOfRangeException'});
      }
      assert.equal(platform.native(call('ToString')), '');
    } finally { platform.heap.releaseHandle(root); writer.stop(); }
  });

  test(`StringWriter buffer ${engine}: host text limit and managed OOM leave prior text intact`, () => {
    const writer = writerPlatform(engine);
    const {platform, reference, call} = writer;
    const {heap} = platform;
    const buffer = heap.allocate('array', 'char[]', [65, 66]);
    const root = heap.createHandle(buffer);
    const budget = heap.maxBytes;
    try {
      call('Write', ['string'], ['x'.repeat(MAX - 1)]);
      assert.throws(() => platform.invoke(writerContract('Write', fullParameters), [reference, buffer]), {name: 'OutOfMemoryException'});
      assert.equal(platform.native(call('ToString')).length, MAX - 1);
      heap.maxBytes = 1;
      assert.throws(() => platform.invoke(writerContract('Write', sliceParameters), [reference, buffer, 0, 1]),
        {name: 'OutOfMemoryException'});
      assert.equal(heap.pins.length, 0);
      heap.maxBytes = budget;
      platform.invoke(writerContract('Write', sliceParameters), [reference, buffer, 0, 1]);
      const value = platform.native(call('ToString'));
      assert.equal(value.length, MAX);
      assert.equal(value.at(-1), 'A');
    } finally { heap.maxBytes = budget; heap.releaseHandle(root); writer.stop(); }
  });

  test(`StringWriter buffer ${engine}: a throwing observer releases roots without consuming a partial character prefix`, () => {
    const writer = writerPlatform(engine);
    const {platform, vm, reference, call} = writer;
    const buffer = platform.heap.allocate('array', 'char[]', [65, 66, 67]);
    const root = platform.heap.createHandle(buffer);
    const failure = new Error('Observer failed');
    try {
      call('Write', ['string'], ['seed']);
      vm.onWrite = event => { if (event.kind === 'array') throw failure; };
      assert.throws(() => platform.invoke(writerContract('Write', fullParameters), [reference, buffer]), error => error === failure);
      assert.equal(platform.heap.pins.length, 0);
      vm.onWrite = null;
      assert.equal(platform.native(call('ToString')), 'seed');
      platform.invoke(writerContract('Write', fullParameters), [reference, buffer]);
      assert.equal(platform.native(call('ToString')), 'seedABC');
    } finally { vm.onWrite = null; platform.heap.releaseHandle(root); writer.stop(); }
  });
}

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`StringWriter buffer ${pipeline} ${engine}: compiled overloads and base references use character arrays`, () => {
      const program = compileToIL('using System;using System.IO;var writer=new StringWriter();TextWriter view=writer;' +
        "char[] buffer=new char[]{'a','\\u0000','\\uD800','z'};writer.Write(buffer);view.Write(buffer,1,2);" +
        'Console.WriteLine(writer.ToString().Length);Console.WriteLine((int)writer.ToString()[4]);' +
        'Console.WriteLine((int)writer.ToString()[5]);char[] empty=null;writer.Dispose();view.Write(empty);Console.WriteLine("done");',
      {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '6\n0\n55296\ndone\n');
      } finally { vm.stop(); }
    });
  }
}

test('StringWriter buffer contracts append after reader buffers and native capture pins source', () => {
  assert.equal(writerContract('Write', fullParameters).id, 655383);
  assert.equal(writerContract('Write', sliceParameters).id, 655384);
  assert.equal(findContracts('System.IO.TextReader', 'ReadBlock')[0].id, 655382);
  assert.equal(writerContract('ToString').id, 655380);
  assert.equal(native.rows.length, 70);
  assert.equal(native.runtime, '10.0.5');
  assert.equal(createHash('sha256').update(readFileSync(new URL('string-writer-buffer/Program.cs', directory))).digest('hex'),
    native.sourceSha256);
});
