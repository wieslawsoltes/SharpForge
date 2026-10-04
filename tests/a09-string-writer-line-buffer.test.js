import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {MAX} from '@sharpforge/bcl-core';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {writerPlatform, writerContract} from './fixtures/text-writer/engines.js';
import {sourceBufferWriter, bufferWriterAssembly} from './fixtures/text-writer/buffer-cases.js';

const directory = new URL('../packages/bcl-io/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-writer-line-buffer-net10.json', directory), 'utf8'));
const fullParameters = ['char[]'];
const sliceParameters = ['char[]', 'int', 'int'];
const units = value => value.split('').map(unit => unit.charCodeAt(0));

for (const engine of ['source', 'cil']) {
  test(`StringWriter buffer line ${engine}: native concrete/base calls preserve text, input and faults`, () => {
    for (const row of native.rows) {
      const vm = engine === 'source' ? sourceBufferWriter(row, 'WriteLine') : new CilVirtualMachine(bufferWriterAssembly(row, 'WriteLine'));
      const field = index => engine === 'source' ? vm.statics[index] : vm.statics.get(0x04000001 + index);
      try {
        const result = vm.run();
        assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
        assert.equal(result.fault?.name ?? null, row.fault, row.id);
        const text = field(0) === null ? null : vm.platform.native(vm.platform.invoke(writerContract('ToString'), [field(0)]));
        assert.deepEqual(text === null ? null : units(text), row.output, row.id);
        assert.deepEqual(field(1) === null ? null : vm.heap.get(field(1)).data, row.buffer, row.id);
      } finally { vm.stop(); }
    }
  });

  test(`StringWriter buffer line ${engine}: native value/newline sequencing survives observer GC`, () => {
    for (const row of native.transitions) {
      const writer = writerPlatform(engine);
      const {platform, vm, reference, call} = writer;
      const {heap} = platform;
      call('Write', ['string'], ['seed|']);
      call('set_NewLine', ['string'], ['|']);
      const builder = call('GetStringBuilder');
      const buffer = heap.allocate('array', 'char[]', [65, 66, 67, 68]);
      const parameters = row.full ? fullParameters : sliceParameters;
      const args = row.full ? [reference, buffer] : [reference, buffer, 1, 2];
      let armed = true;
      try {
        vm.onWrite = event => {
          if (armed && event.handle === builder.h && event.property === '$capacity') {
            armed = false;
            if (row.mode === 'newline') call('set_NewLine', ['string'], [heap.string('!')]);
            else call('Dispose');
          }
          heap.collect();
        };
        const invoke = () => platform.invoke(writerContract('WriteLine', parameters), args);
        if (row.fault) assert.throws(invoke, {name: row.fault});
        else invoke();
        assert.equal(armed, false);
        assert.deepEqual(units(platform.native(call('ToString'))), row.output);
        assert.deepEqual(units(platform.native(call('get_NewLine'))), row.newLine);
        assert.deepEqual(heap.get(buffer).data, [65, 66, 67, 68]);
        assert.equal(heap.pins.length, 0);
      } finally { vm.onWrite = null; writer.stop(); }
    }
  });

  test(`StringWriter buffer line ${engine}: bulk value and newline use two managed chunks without retaining input`, () => {
    const writer = writerPlatform(engine);
    const {platform, vm, reference, call} = writer;
    const {heap} = platform;
    call('Write', ['string'], ['seed|']);
    call('set_NewLine', ['string'], [heap.string('!')]);
    const builder = call('GetStringBuilder');
    const storage = platform.get(builder, '$data');
    const input = Array.from({length: 17000}, (_, index) => [0, 0xd800, 0xdc00, 0xffff, 65][index % 5]);
    const buffer = heap.allocate('array', 'char[]', [...input]);
    const weak = heap.createHandle(buffer, {weak: true});
    const allocations = heap.stats.allocations;
    let writes = 0;
    try {
      vm.onWrite = event => { if (event.kind === 'array') writes++; heap.collect(); };
      platform.invoke(writerContract('WriteLine', sliceParameters), [reference, buffer, 1, 16998]);
      assert.equal(heap.stats.allocations - allocations, 2);
      assert.equal(writes, 2);
      assert.deepEqual(platform.get(builder, '$data'), storage);
      assert.deepEqual(heap.get(buffer).data, input);
      heap.get(buffer).data.fill(66);
      assert.deepEqual(units(platform.native(call('ToString'))), [...units('seed|'), ...input.slice(1, -1), 33]);
      assert.equal(heap.pins.length, 0);
      heap.collect();
      assert.equal(heap.getHandle(weak), null);
    } finally { vm.onWrite = null; heap.releaseHandle(weak); writer.stop(); }
  });

  test(`StringWriter buffer line ${engine}: snapshots preserve writer state and null/empty disposal rules`, () => {
    const writer = writerPlatform(engine);
    const {platform, reference, call} = writer;
    const {heap} = platform;
    const buffer = heap.allocate('array', 'char[]', [65, 66]);
    const root = heap.createHandle(buffer);
    try {
      call('set_NewLine', ['string'], ['!']);
      platform.invoke(writerContract('WriteLine', fullParameters), [reference, null]);
      const snapshot = heap.snapshot();
      call('set_NewLine', ['string'], ['']);
      call('Dispose');
      assert.throws(() => platform.invoke(writerContract('WriteLine', fullParameters), [reference, null]),
        {name: 'ObjectDisposedException'});
      assert.throws(() => platform.invoke(writerContract('WriteLine', sliceParameters), [reference, null, 0, 0]),
        {name: 'ArgumentNullException'});
      assert.throws(() => platform.invoke(writerContract('WriteLine', sliceParameters), [reference, buffer, 2, 0]),
        {name: 'ObjectDisposedException'});
      heap.restore(snapshot);
      platform.invoke(writerContract('WriteLine', sliceParameters), [reference, buffer, 1, 1]);
      assert.equal(platform.native(call('ToString')), '!B!');
    } finally { heap.releaseHandle(root); writer.stop(); }
  });

  test(`StringWriter buffer line ${engine}: the released string overload keeps its single disposal check`, () => {
    const writer = writerPlatform(engine);
    const {platform, vm, call} = writer;
    call('Write', ['string'], ['seed|']);
    const builder = call('GetStringBuilder');
    let armed = true;
    try {
      vm.onWrite = event => {
        if (armed && event.handle === builder.h && event.property === '$capacity') {
          armed = false;
          call('Dispose');
        }
      };
      call('WriteLine', ['string'], ['AB']);
      assert.equal(armed, false);
      assert.equal(platform.native(call('ToString')), 'seed|AB\n');
      assert.throws(() => call('WriteLine'), {name: 'ObjectDisposedException'});
    } finally { vm.onWrite = null; writer.stop(); }
  });

  test(`StringWriter buffer line ${engine}: host text limit preserves a completed value before newline failure`, () => {
    const writer = writerPlatform(engine);
    const {platform, reference, call} = writer;
    const buffer = platform.heap.allocate('array', 'char[]', [65]);
    const root = platform.heap.createHandle(buffer);
    try {
      call('Write', ['string'], ['x'.repeat(MAX - 1)]);
      assert.throws(() => platform.invoke(writerContract('WriteLine', fullParameters), [reference, buffer]),
        {name: 'OutOfMemoryException'});
      const actual = platform.native(call('ToString'));
      assert.equal(actual.length, MAX);
      assert.equal(actual.at(-1), 'A');
      assert.equal(platform.heap.pins.length, 0);
    } finally { platform.heap.releaseHandle(root); writer.stop(); }
  });

  test(`StringWriter buffer line ${engine}: managed OOM between appends retains the completed value`, () => {
    const writer = writerPlatform(engine);
    const {platform, vm, reference, call} = writer;
    const {heap} = platform;
    call('Write', ['string'], ['seed|']);
    const builder = call('GetStringBuilder');
    const buffer = heap.allocate('array', 'char[]', [65, 66]);
    const budget = heap.maxBytes;
    try {
      vm.onWrite = event => {
        if (event.handle === builder.h && event.property === '$capacity') heap.maxBytes = 1;
      };
      assert.throws(() => platform.invoke(writerContract('WriteLine', fullParameters), [reference, buffer]),
        {name: 'OutOfMemoryException'});
      vm.onWrite = null;
      heap.maxBytes = budget;
      assert.equal(platform.native(call('ToString')), 'seed|AB');
      assert.equal(heap.pins.length, 0);
    } finally { vm.onWrite = null; heap.maxBytes = budget; writer.stop(); }
  });

  test(`StringWriter buffer line ${engine}: throwing newline observer releases roots and preserves completed value`, () => {
    const writer = writerPlatform(engine);
    const {platform, vm, reference, call} = writer;
    call('Write', ['string'], ['seed|']);
    const buffer = platform.heap.allocate('array', 'char[]', [65, 66]);
    const failure = new Error('Newline observer failed');
    let writes = 0;
    try {
      vm.onWrite = event => { if (event.kind === 'array' && ++writes === 2) throw failure; };
      assert.throws(() => platform.invoke(writerContract('WriteLine', fullParameters), [reference, buffer]), error => error === failure);
      vm.onWrite = null;
      assert.equal(platform.native(call('ToString')), 'seed|AB');
      assert.equal(platform.heap.pins.length, 0);
      platform.invoke(writerContract('WriteLine', fullParameters), [reference, null]);
      assert.equal(platform.native(call('ToString')), 'seed|AB\n');
    } finally { vm.onWrite = null; writer.stop(); }
  });
}

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`StringWriter buffer line ${pipeline}/${engine}: compiled whole/slice calls retain real base references`, () => {
      const program = compileToIL(`using System; using System.IO;
        var writer = new StringWriter(); TextWriter view = writer; writer.NewLine = "!";
        char[] buffer = new char[] {'a', '\\u0000', '\\uD800', 'z'};
        writer.WriteLine(buffer); view.WriteLine(buffer, 1, 2);
        Console.WriteLine(writer.ToString().Length);
        Console.WriteLine((int)writer.ToString()[5]); Console.WriteLine((int)writer.ToString()[6]);
        char[] empty = null; view.WriteLine(empty); Console.WriteLine(writer.ToString().Length);
        writer.Dispose();
        try { view.WriteLine(empty); } catch (Exception error) { Console.WriteLine(error.GetType().Name); }
        try { view.WriteLine(empty, -1, -1); } catch (Exception error) { Console.WriteLine(error.GetType().Name); }
      `, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '8\n0\n55296\n9\nObjectDisposedException\nArgumentNullException\n');
      } finally { vm.stop(); }
    });
  }
}

test('StringWriter buffer line contracts append without changing released slots or the pinned native fixture', () => {
  assert.equal(writerContract('WriteLine', fullParameters).id, 655385);
  assert.equal(writerContract('WriteLine', sliceParameters).id, 655386);
  assert.equal(writerContract('Write', fullParameters).id, 655383);
  assert.equal(writerContract('Write', sliceParameters).id, 655384);
  assert.equal(writerContract('ToString').id, 655380);
  assert.equal(native.rows.length, 86);
  assert.equal(native.transitions.length, 8);
  assert.equal(native.runtime, '10.0.5');
  assert.equal(native.sdk, '10.0.201');
  const source = readFileSync(new URL('string-writer-line-buffer/Program.cs', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), native.sourceSha256);
});
