import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MAX} from '@sharpforge/bcl-core';
import {decimalBits} from '@sharpforge/bytecode';
import {CilVirtualMachine, ManagedFault} from '@sharpforge/runtime';
import {writerPlatform, writerContract, parentType} from './fixtures/text-writer/engines.js';
import {scalarTypes, scalarCases, scalarWriterAssembly, capturedScalar} from './fixtures/text-writer/scalars.js';

const selectedText = {bool: 'True', int: '-2147483648', uint: '4294967295', long: '-9007199254740993',
  ulong: '18446744073709551615', float: '0.1', double: '-0', decimal: '1.2300'};
const samples = scalarTypes.map(type => {
  const row = scalarCases.find(item => item.type === type && item.text === selectedText[type]);
  assert(row, 'Missing scalar state sample: ' + type);
  return row;
});

for (const engine of ['source', 'cil']) {
  test(`StringWriter scalars ${engine}: native subclass transitions match host-observer sequencing`, () => {
    const native = JSON.parse(readFileSync(new URL('../packages/bcl-io/reference/string-writer-scalars-net10.json', import.meta.url)));
    for (const row of native.transitions) {
      assert.equal(row.nativeOnly, true);
      const scalar = capturedScalar(row);
      const writer = writerPlatform(engine);
      const {platform, vm, call} = writer;
      const {heap} = platform;
      call('Write', ['string'], ['seed|']);
      call('set_NewLine', ['string'], ['|']);
      const builder = call('GetStringBuilder');
      let armed = true;
      try {
        vm.onWrite = event => {
          if (armed && event.handle === builder.h && event.property === '$capacity') {
            armed = false;
            if (row.mode === 'newline') call('set_NewLine', ['string'], [heap.string('!\r\n')]);
            else if (row.mode === 'dispose') call('Dispose');
            else throw new ManagedFault('InvalidOperationException', 'Native transition callback');
          }
          heap.collect();
        };
        const invoke = () => call('WriteLine', [row.type], [scalar.value]);
        if (row.fault) assert.throws(invoke, {name: row.fault}, row.id);
        else assert.equal(invoke(), null, row.id);
        assert.equal(armed, false, row.id);
        const units = value => platform.native(value).split('').map(unit => unit.charCodeAt(0));
        assert.deepEqual(units(call('ToString')), row.output, row.id);
        assert.deepEqual(units(call('get_NewLine')), row.newLine, row.id);
        assert.equal(heap.pins.length, 0);
      } finally { vm.onWrite = null; writer.stop(); }
    }
  });

  test(`StringWriter scalars ${engine}: receiver validation and disposal precede writing for every scalar type`, () => {
    const writer = writerPlatform(engine);
    const {platform, reference, call} = writer;
    const unsupported = platform.make(parentType);
    const root = platform.heap.createHandle(unsupported);
    try {
      call('Write', ['string'], ['retained']);
      for (const row of samples) {
        for (const method of ['Write', 'WriteLine']) {
          const descriptor = writerContract(method, [row.type]);
          assert.throws(() => platform.invoke(descriptor, [null, row.value]), {name: 'NullReferenceException'}, row.type);
          assert.throws(() => platform.invoke(descriptor, [unsupported, row.value]), {name: 'NotSupportedException'}, row.type);
        }
      }
      call('Dispose');
      call('set_NewLine', ['string'], ['']);
      for (const row of samples) {
        for (const method of ['Write', 'WriteLine']) {
          assert.throws(() => call(method, [row.type], [row.value]), {name: 'ObjectDisposedException'}, row.type);
        }
      }
      assert.equal(platform.native(call('ToString')), 'retained');
      assert.equal(platform.get(reference, '$disposed'), true);
      assert.equal(platform.heap.pins.length, 0);
    } finally { platform.heap.releaseHandle(root); writer.stop(); }
  });

  test(`StringWriter scalars ${engine}: two rooted chunks preserve storage, exact carriers and snapshot state`, () => {
    for (const row of samples) {
      const writer = writerPlatform(engine);
      const {platform, vm, call} = writer;
      const {heap} = platform;
      call('Write', ['string'], ['seed|']);
      call('set_NewLine', ['string'], ['!']);
      const builder = call('GetStringBuilder');
      const storage = platform.get(builder, '$data');
      const bits = row.type === 'decimal' ? decimalBits(row.value) : null;
      const allocations = heap.stats.allocations;
      let writes = 0;
      try {
        vm.onWrite = event => { if (event.kind === 'array') writes++; heap.collect(); };
        call('WriteLine', [row.type], [row.value]);
        assert.equal(heap.stats.allocations - allocations, 2, row.type);
        assert.equal(writes, 2, row.type);
        assert.deepEqual(platform.get(builder, '$data'), storage, row.type);
        if (bits) assert.deepEqual(decimalBits(row.value), bits);
        assert.equal(heap.pins.length, 0);
        vm.onWrite = null;
        const snapshot = heap.snapshot();
        call('set_NewLine', ['string'], ['']);
        call('Dispose');
        heap.restore(snapshot);
        assert.deepEqual(call('GetStringBuilder'), builder);
        call('WriteLine', [row.type], [row.value]);
        assert.equal(platform.native(call('ToString')), 'seed|' + (row.text + '!').repeat(2), row.type);
      } finally { vm.onWrite = null; writer.stop(); }
    }
  });

  test(`StringWriter scalars ${engine}: value/newline boundary observes NewLine, disposal and callback faults`, () => {
    for (const row of samples) {
      for (const mode of ['newline', 'dispose', 'throw']) {
        const writer = writerPlatform(engine);
        const {platform, vm, call} = writer;
        const {heap} = platform;
        call('Write', ['string'], ['seed|']);
        call('set_NewLine', ['string'], ['|']);
        const builder = call('GetStringBuilder');
        const failure = new Error('Scalar value observer failed');
        let armed = true;
        try {
          vm.onWrite = event => {
            if (armed && event.handle === builder.h && event.property === '$capacity') {
              armed = false;
              heap.collect();
              if (mode === 'newline') call('set_NewLine', ['string'], [heap.string('\0\ud800!')]);
              else if (mode === 'dispose') call('Dispose');
              else throw failure;
            }
            heap.collect();
          };
          const invoke = () => call('WriteLine', [row.type], [row.value]);
          if (mode === 'dispose') assert.throws(invoke, {name: 'ObjectDisposedException'}, row.type);
          else if (mode === 'throw') assert.throws(invoke, error => error === failure, row.type);
          else assert.equal(invoke(), null);
          assert.equal(armed, false, row.type);
          assert.equal(platform.native(call('ToString')), 'seed|' + row.text + (mode === 'newline' ? '\0\ud800!' : ''), row.type);
          assert.equal(heap.pins.length, 0);
        } finally { vm.onWrite = null; writer.stop(); }
      }
    }
  });

  test(`StringWriter scalars ${engine}: Write has one disposal gate and newline reset preserves the LF profile`, () => {
    for (const row of samples) {
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
        assert.equal(call('Write', [row.type], [row.value]), null);
        assert.equal(armed, false);
        assert.equal(platform.native(call('ToString')), row.text);
        assert.throws(() => call('Write', [row.type], [row.value]), {name: 'ObjectDisposedException'});
        call('set_NewLine', ['string'], [null]);
        assert.equal(platform.native(call('get_NewLine')), '\n');
      } finally { vm.onWrite = null; writer.stop(); }
    }
  });

  test(`StringWriter scalars ${engine}: text-limit failure preserves precisely the completed value`, () => {
    for (const row of samples) {
      for (const valueFits of [false, true]) {
        const writer = writerPlatform(engine);
        const {platform, call} = writer;
        const initialLength = MAX - row.text.length + (valueFits ? 0 : 1);
        try {
          call('Write', ['string'], ['x'.repeat(initialLength)]);
          assert.throws(() => call('WriteLine', [row.type], [row.value]), {name: 'OutOfMemoryException'}, row.type);
          const actual = platform.native(call('ToString'));
          assert.equal(actual.length, valueFits ? MAX : initialLength, row.type);
          assert.equal(actual.endsWith(row.text), valueFits, row.type);
          assert.equal(platform.heap.pins.length, 0);
        } finally { writer.stop(); }
      }
    }
  });

  test(`StringWriter scalars ${engine}: managed OOM before or after value append retains committed text`, () => {
    for (const row of samples) {
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
          assert.throws(() => call('WriteLine', [row.type], [row.value]), {name: 'OutOfMemoryException'}, row.type);
          vm.onWrite = null;
          heap.maxBytes = budget;
          assert.equal(platform.native(call('ToString')), 'seed|' + (afterValue ? row.text : ''), row.type);
          assert.equal(heap.pins.length, 0);
        } finally { vm.onWrite = null; heap.maxBytes = budget; writer.stop(); }
      }
    }
  });

  test(`StringWriter scalars ${engine}: throwing chunk observers preserve prior committed chunks and release roots`, () => {
    for (const row of samples) {
      for (const target of [1, 2]) {
        const writer = writerPlatform(engine);
        const {platform, vm, call} = writer;
        call('Write', ['string'], ['seed|']);
        const failure = new Error('Scalar chunk observer failed');
        let writes = 0;
        try {
          vm.onWrite = event => {
            platform.heap.collect();
            if (event.kind === 'array' && ++writes === target) throw failure;
          };
          assert.throws(() => call('WriteLine', [row.type], [row.value]), error => error === failure, row.type);
          vm.onWrite = null;
          assert.equal(platform.native(call('ToString')), 'seed|' + (target === 2 ? row.text : ''), row.type);
          assert.equal(platform.heap.pins.length, 0);
        } finally { vm.onWrite = null; writer.stop(); }
      }
    }
  });
}

test('StringWriter scalars independent CIL: null and disposed receivers fault for every scalar signature', () => {
  for (const row of samples) {
    for (const method of ['Write', 'WriteLine']) {
      for (const nullWriter of [false, true]) {
        const vm = new CilVirtualMachine(scalarWriterAssembly([row], {method, baseView: true, nullWriter, disposed: !nullWriter}));
        try {
          const result = vm.run();
          assert.equal(result.state, 'faulted', row.type + '/' + method);
          assert.equal(result.fault.name, nullWriter ? 'NullReferenceException' : 'ObjectDisposedException', row.type);
        } finally { vm.stop(); }
      }
    }
  }
});
