import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {MAX} from '@sharpforge/bcl-core';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';
import {writerPlatform, writerContract, writerType, parentType} from './fixtures/text-writer/engines.js';

const directory = new URL('../packages/bcl-io/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-writer-char-line-net10.json', directory), 'utf8'));
const units = value => value.split('').map(unit => unit.charCodeAt(0));
const newline = row => row.newLine === null ? null : String.fromCharCode(...row.newLine);

function characterAssembly(row) {
  const owner = row.baseView ? parentType : writerType;
  return managedFixture({fields: [{name: 'Writer', type: owner}],
    methods: [{name: 'Main', result: 'void', maxStack: 2, body(writer, context) {
      const field = 0x04000000 | context.fields.Writer;
      const call = (name, parameters = []) => writer.op('callvirt', context.member(owner, name, 'void', parameters, false));
      if (row.nullWriter) writer.op('ldnull');
      else writer.op('newobj', context.member(writerType, '.ctor', 'void', [], false)).op('castclass', context.resolve(owner));
      writer.op('stsfld', field);
      if (!row.nullWriter) {
        writer.op('ldsfld', field).op('ldstr', 0x70000000 + context.md.userString('seed|'));
        call('Write', ['string']);
        if (row.setNewLine) {
          writer.op('ldsfld', field);
          if (row.newLine === null) writer.op('ldnull');
          else writer.op('ldstr', 0x70000000 + context.md.userString(newline(row)));
          call('set_NewLine', ['string']);
        }
      }
      if (row.disposed) {
        writer.op('ldsfld', field);
        call('Dispose');
      }
      writer.op('ldsfld', field).op('ldc.i4', row.value).op('conv.u2');
      call('WriteLine', ['char']);
      writer.op('ret');
    }}]});
}

test('StringWriter character line source: real platform dispatch matches all native character/null/disposal rows', () => {
  for (const row of native.rows) {
    const writer = writerPlatform('source');
    const {platform, reference, call} = writer;
    try {
      if (!row.nullWriter) {
        call('Write', ['string'], ['seed|']);
        if (row.setNewLine) call('set_NewLine', ['string'], [newline(row)]);
      }
      if (row.disposed) call('Dispose');
      const invoke = () => platform.invoke(writerContract('WriteLine', ['char']), [row.nullWriter ? null : reference, row.value]);
      if (row.fault) assert.throws(invoke, {name: row.fault}, row.id);
      else assert.equal(invoke(), null, row.id);
      const actual = row.nullWriter ? null : units(platform.native(call('ToString')));
      assert.deepEqual(actual, row.output, row.id);
    } finally { writer.stop(); }
  }
});

test('StringWriter character line CIL: independent concrete/base callvirt matches all native rows', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(characterAssembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      assert.equal(result.fault?.name ?? null, row.fault, row.id);
      const reference = vm.statics.get(0x04000001);
      const actual = reference === null ? null : units(vm.platform.native(vm.platform.invoke(writerContract('ToString'), [reference])));
      assert.deepEqual(actual, row.output, row.id);
    } finally { vm.stop(); }
  }
});

for (const engine of ['source', 'cil']) {
  test(`StringWriter character line ${engine}: observer NewLine/disposal changes match the native sequencing boundary`, () => {
    for (const row of native.transitions) {
      const writer = writerPlatform(engine);
      const {platform, vm, call} = writer;
      call('Write', ['string'], ['seed|']);
      call('set_NewLine', ['string'], ['|']);
      const builder = call('GetStringBuilder');
      let armed = true;
      try {
        vm.onWrite = event => {
          if (armed && event.handle === builder.h && event.property === '$capacity') {
            armed = false;
            if (row.mode === 'newline') call('set_NewLine', ['string'], [platform.heap.string('!')]);
            else call('Dispose');
          }
          platform.heap.collect();
        };
        const invoke = () => call('WriteLine', ['char'], [row.value]);
        if (row.fault) assert.throws(invoke, {name: row.fault});
        else invoke();
        assert.equal(armed, false);
        assert.deepEqual(units(platform.native(call('ToString'))), row.output);
        assert.deepEqual(units(platform.native(call('get_NewLine'))), row.newLine);
        assert.equal(platform.heap.pins.length, 0);
      } finally { vm.onWrite = null; writer.stop(); }
    }
  });

  test(`StringWriter character line ${engine}: two chunks survive GC and snapshot restoration`, () => {
    const writer = writerPlatform(engine);
    const {platform, vm, call} = writer;
    const {heap} = platform;
    call('Write', ['string'], ['seed|']);
    call('set_NewLine', ['string'], [heap.string('!')]);
    const allocations = heap.stats.allocations;
    let writes = 0;
    try {
      vm.onWrite = event => { if (event.kind === 'array') writes++; heap.collect(); };
      call('WriteLine', ['char'], [0xd800]);
      assert.equal(heap.stats.allocations - allocations, 2);
      assert.equal(writes, 2);
      assert.equal(heap.pins.length, 0);
      vm.onWrite = null;
      const snapshot = heap.snapshot();
      call('set_NewLine', ['string'], ['']);
      call('Dispose');
      heap.restore(snapshot);
      call('WriteLine', ['char'], [0xdc00]);
      assert.equal(platform.native(call('ToString')), 'seed|\ud800!\udc00!');
    } finally { vm.onWrite = null; writer.stop(); }
  });

  test(`StringWriter character line ${engine}: receiver/disposal precedence and existing character range guards remain`, () => {
    const writer = writerPlatform(engine);
    const {platform, reference, call} = writer;
    try {
      for (const value of [-1, 65536, 1.5, NaN, Infinity]) {
        assert.throws(() => call('WriteLine', ['char'], [value]), {name: 'ArgumentOutOfRangeException'});
      }
      assert.equal(platform.native(call('ToString')), '');
      const unsupported = platform.make(parentType);
      assert.throws(() => platform.invoke(writerContract('WriteLine', ['char']), [unsupported, 65]), {name: 'NotSupportedException'});
      call('Dispose');
      assert.throws(() => call('WriteLine', ['char'], [-1]), {name: 'ObjectDisposedException'});
      assert.throws(() => platform.invoke(writerContract('WriteLine', ['char']), [null, -1]), {name: 'NullReferenceException'});
      assert.equal(platform.get(reference, '$disposed'), true);
    } finally { writer.stop(); }
  });

  test(`StringWriter character line ${engine}: host-limit failures distinguish character and newline progress`, () => {
    for (const length of [MAX - 1, MAX]) {
      const writer = writerPlatform(engine);
      const {platform, call} = writer;
      try {
        call('Write', ['string'], ['x'.repeat(length)]);
        assert.throws(() => call('WriteLine', ['char'], [65]), {name: 'OutOfMemoryException'});
        const actual = platform.native(call('ToString'));
        assert.equal(actual.length, MAX);
        assert.equal(actual.at(-1), length === MAX ? 'x' : 'A');
        assert.equal(platform.heap.pins.length, 0);
      } finally { writer.stop(); }
    }
  });

  test(`StringWriter character line ${engine}: managed OOM before/between appends preserves completed text`, () => {
    for (const afterValue of [false, true]) {
      const writer = writerPlatform(engine);
      const {platform, vm, call} = writer;
      const {heap} = platform;
      call('Write', ['string'], ['seed|']);
      const builder = call('GetStringBuilder');
      const budget = heap.maxBytes;
      try {
        if (afterValue) vm.onWrite = event => {
          if (event.handle === builder.h && event.property === '$capacity') heap.maxBytes = 1;
        };
        else heap.maxBytes = 1;
        assert.throws(() => call('WriteLine', ['char'], [65]), {name: 'OutOfMemoryException'});
        vm.onWrite = null;
        heap.maxBytes = budget;
        assert.equal(platform.native(call('ToString')), afterValue ? 'seed|A' : 'seed|');
        assert.equal(heap.pins.length, 0);
      } finally { vm.onWrite = null; heap.maxBytes = budget; writer.stop(); }
    }
  });

  test(`StringWriter character line ${engine}: throwing value/newline observers release roots without rollback claims`, () => {
    for (const target of [1, 2]) {
      const writer = writerPlatform(engine);
      const {platform, vm, call} = writer;
      call('Write', ['string'], ['seed|']);
      const failure = new Error('Character-line observer failed');
      let writes = 0;
      try {
        vm.onWrite = event => {
          platform.heap.collect();
          if (event.kind === 'array' && ++writes === target) throw failure;
        };
        assert.throws(() => call('WriteLine', ['char'], [65]), error => error === failure);
        vm.onWrite = null;
        assert.equal(platform.native(call('ToString')), target === 1 ? 'seed|' : 'seed|A');
        assert.equal(platform.heap.pins.length, 0);
      } finally { vm.onWrite = null; writer.stop(); }
    }
  });

  test(`StringWriter character line ${engine}: released Write(char) keeps its single disposal check`, () => {
    const writer = writerPlatform(engine);
    const {platform, vm, call} = writer;
    const builder = call('GetStringBuilder');
    let armed = true;
    try {
      vm.onWrite = event => {
        if (armed && event.handle === builder.h && event.property === '$capacity') {
          armed = false;
          call('Dispose');
        }
      };
      call('Write', ['char'], [65]);
      assert.equal(armed, false);
      assert.equal(platform.native(call('ToString')), 'A');
      assert.throws(() => call('Write', ['char'], [66]), {name: 'ObjectDisposedException'});
    } finally { vm.onWrite = null; writer.stop(); }
  });
}

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`StringWriter character line ${pipeline}/${engine}: compiled literals and base references preserve UTF-16`, () => {
      const program = compileToIL(`using System; using System.IO;
        var writer = new StringWriter(); TextWriter view = writer; writer.NewLine = "|";
        writer.WriteLine('\\u0000'); view.WriteLine('\\uD800');
        view.NewLine = ""; view.WriteLine('\\uFFFF');
        Console.WriteLine(writer.ToString().Length);
        Console.WriteLine((int)writer.ToString()[0]); Console.WriteLine((int)writer.ToString()[2]);
        Console.WriteLine((int)writer.ToString()[4]);
        writer.Dispose();
        try { view.WriteLine('x'); } catch (Exception error) { Console.WriteLine(error.GetType().Name); }
      `, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '5\n0\n55296\n65535\nObjectDisposedException\n');
      } finally { vm.stop(); }
    });
  }
}

test('StringWriter character line appends one ID after buffers and pins the unchanged native fixture', () => {
  assert.equal(writerContract('WriteLine', ['char']).id, 655387);
  assert.equal(writerContract('WriteLine', ['char[]']).id, 655385);
  assert.equal(writerContract('WriteLine', ['char[]', 'int', 'int']).id, 655386);
  assert.equal(writerContract('Write', ['char']).id, 655370);
  assert.equal(native.rows.length, 40);
  assert.equal(native.transitions.length, 4);
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  const source = readFileSync(new URL('string-writer-char-line/Program.cs', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), native.sourceSha256);
});
