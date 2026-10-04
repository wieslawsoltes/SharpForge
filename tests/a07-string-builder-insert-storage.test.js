import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decimal} from '@sharpforge/bytecode';
import {MAX} from '@sharpforge/bcl-core';
import {builderContract, builderPlatform, units} from './fixtures/string-builder/append-char.js';
import {createInsertBuilder} from './fixtures/string-builder/insert-char.js';
import {managedCharacters} from './fixtures/string-builder/append-array.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-insert-values-net10.json', directory), 'utf8'));
const metadata = (platform, reference) => ['$data', '$count', '$length', '$capacity', '$version']
  .map(key => platform.get(reference, key));
const text = (platform, reference) => platform.native(platform.invoke(builderContract('ToString'), [reference]));
const parameters = row => row.overload === 'char[]-range' ? ['int', 'char[]', 'int', 'int'] : ['int', row.overload];
const invoke = (platform, reference, signature, values) =>
  platform.invoke(builderContract('Insert', signature), [reference, ...values]);
const flatRow = {capacity: 1, segments: [units('ab'), units('cd')]};

function withBuilder(engine, row, action) {
  const runner = builderPlatform(engine, '');
  try {
    runner.platform.heap.withRoots([], () => {
      const reference = createInsertBuilder(runner.platform, row);
      action({...runner, reference});
    });
    assert.equal(runner.platform.heap.pins.length, 0);
  } finally {
    runner.stop();
  }
}

function fault(error, row) {
  assert.equal(error.name, row.fault, row.id);
  if (row.parameter) assert(error.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + error.message);
  return true;
}

function referenceValue(platform, row) {
  if (row.input.type === 'null' || row.input.units === null) return null;
  const value = row.input.type === 'char[]' ? managedCharacters(platform, row.input.units)
    : platform.heap.string(String.fromCharCode(...row.input.units));
  platform.heap.pins.push(value);
  return value;
}

function argumentsFor(row, value) {
  return row.overload === 'char[]-range' ? [row.index, value, row.startIndex, row.charCount] : [row.index, value];
}

function protectChunks(platform, reference, read) {
  const storage = platform.get(reference, '$data');
  const records = storage ? platform.heap.get(storage).data.filter(Boolean).map(value => platform.heap.get(value)) : [];
  const descriptors = records.map(record => Object.getOwnPropertyDescriptor(record, 'data'));
  records.forEach((record, index) => Object.defineProperty(record, 'data', {
    configurable: true,
    get() { read(); return descriptors[index].value; }
  }));
  return () => records.forEach((record, index) => Object.defineProperty(record, 'data', descriptors[index]));
}

function preparedCases(platform) {
  const cases = [
    {signature: ['int', 'string'], value: platform.heap.string('x\0\ud800'), output: 'x\0\ud800'},
    {signature: ['int', 'int'], value: -2147483648, output: '-2147483648'},
    {signature: ['int', 'uint'], value: -1, output: '4294967295'},
    {signature: ['int', 'long'], value: -9007199254740993n, output: '-9007199254740993'},
    {signature: ['int', 'ulong'], value: -1n, output: '18446744073709551615'},
    {signature: ['int', 'float'], value: Math.fround(0.1), output: '0.1'},
    {signature: ['int', 'double'], value: 0.1, output: '0.1'},
    {signature: ['int', 'decimal'], value: decimal(12300n, 4), output: '1.2300'},
    {signature: ['int', 'object'], value: platform.heap.allocate('box', 'System.Char', [0xd800]), output: '\ud800'},
    {signature: ['int', 'char[]'], value: managedCharacters(platform, [65, 0, 0xd800]), output: 'A\0\ud800'},
    {signature: ['int', 'char[]', 'int', 'int'], value: managedCharacters(platform, [88, 0, 0xd800, 89]),
      range: [1, 2], output: '\0\ud800'}
  ];
  for (const row of cases) platform.heap.pins.push(row.value);
  return cases;
}

for (const engine of ['source', 'cil']) {
  test(`StringBuilder Insert storage ${engine}: native no-ops avoid chunk reads, managed allocations and notifications`, () => {
    const rows = native.rows.filter(row => row.segments !== null && !row.fault && row.calls === 0 &&
      ['string', 'char[]', 'null'].includes(row.input.type) && row.before.length === row.after.length);
    for (const row of rows) withBuilder(engine, row, ({platform, vm, reference}) => {
      const {heap} = platform;
      const value = referenceValue(platform, row);
      const before = [metadata(platform, reference), heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision];
      const budget = heap.maxBytes;
      let reads = 0;
      let writes = 0;
      const restore = protectChunks(platform, reference, () => { reads++; });
      vm.onWrite = () => { writes++; };
      try {
        heap.maxBytes = 1;
        assert.deepEqual(invoke(platform, reference, parameters(row), argumentsFor(row, value)), reference, row.id);
        assert.equal(reads, 0, row.id);
        assert.equal(writes, 0, row.id);
        assert.deepEqual([metadata(platform, reference), heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision], before);
      } finally {
        heap.maxBytes = budget;
        vm.onWrite = null;
        restore();
      }
    });
  });

  test(`StringBuilder Insert storage ${engine}: native rejected string/array inputs do not flatten or mutate the builder`, () => {
    const rows = native.rows.filter(row => row.segments !== null && row.fault && ['string', 'char[]'].includes(row.input.type));
    for (const row of rows) withBuilder(engine, row, ({platform, reference}) => {
      const value = referenceValue(platform, row);
      const before = metadata(platform, reference);
      const restore = protectChunks(platform, reference, () => { throw new Error('Read builder before rejecting arguments'); });
      try {
        assert.throws(() => invoke(platform, reference, parameters(row), argumentsFor(row, value)), error => fault(error, row));
        assert.deepEqual(metadata(platform, reference), before, row.id);
      } finally { restore(); }
      assert.deepEqual(units(text(platform, reference)), row.before.text, row.id);
    });
  });

  test(`StringBuilder Insert storage ${engine}: first allocation failures leave all scalar and array edits unchanged`, () => {
    withBuilder(engine, flatRow, ({platform, reference}) => {
      const {heap} = platform;
      const cases = preparedCases(platform);
      const before = metadata(platform, reference);
      const chunks = [...heap.get(before[0]).data];
      const allocations = heap.stats.allocations;
      const budget = heap.maxBytes;
      try {
        heap.maxBytes = 1;
        for (const row of cases) {
          assert.throws(() => invoke(platform, reference, row.signature, [2, row.value, ...(row.range ?? [])]),
            {name: 'OutOfMemoryException'}, row.signature.join(','));
          assert.deepEqual(metadata(platform, reference), before);
          assert.deepEqual(heap.get(before[0]).data, chunks);
          assert.equal(heap.stats.allocations, allocations);
        }
      } finally { heap.maxBytes = budget; }
      assert.equal(text(platform, reference), 'abcd');
    });
  });

  test(`StringBuilder Insert storage ${engine}: host bounds precede array decoding and permit the exact final length`, () => {
    withBuilder(engine, flatRow, ({platform, reference}) => {
      const {heap} = platform;
      const value = managedCharacters(platform, [65, 66, 67]);
      const oversized = heap.string('abc');
      heap.pins.push(value, oversized);
      platform.invoke(builderContract('set_Length', ['int']), [reference, MAX - 2]);
      const before = metadata(platform, reference);
      const data = heap.get(value).data;
      Object.defineProperty(data, 0, {configurable: true, get() { throw new Error('Decode before size validation'); }});
      const restore = protectChunks(platform, reference, () => { throw new Error('Flatten before size validation'); });
      try {
        for (const [signature, arguments_] of [
          [['int', 'char[]'], [1, value]], [['int', 'string'], [1, oversized]], [['int', 'int'], [1, 100]]
        ]) assert.throws(() => invoke(platform, reference, signature, arguments_), {name: 'OutOfMemoryException'});
        assert.deepEqual(invoke(platform, reference, ['int', 'char[]', 'int', 'int'], [1, value, 3, 0]), reference);
        assert.deepEqual(metadata(platform, reference), before);
      } finally {
        restore();
        Object.defineProperty(data, 0, {configurable: true, writable: true, enumerable: true, value: 65});
      }
      invoke(platform, reference, ['int', 'char[]', 'int', 'int'], [1, value, 1, 2]);
      assert.equal(platform.get(reference, '$length'), MAX);
      assert.equal(text(platform, reference).slice(0, 6), 'aBCbcd');
    });
  });

  test(`StringBuilder Insert storage ${engine}: one-result commits retain inputs through observer GC and restore snapshots`, () => {
    withBuilder(engine, flatRow, ({platform, vm, reference}) => {
      const {heap} = platform;
      const cases = preparedCases(platform);
      const snapshot = heap.snapshot();
      const pins = heap.pins.length;
      for (const row of cases) {
        heap.restore(snapshot);
        const allocations = heap.stats.allocations;
        vm.onWrite = () => {
          heap.collect();
          if (platform.bclHost.isReference(row.value)) heap.get(row.value);
        };
        try { assert.deepEqual(invoke(platform, reference, row.signature, [2, row.value, ...(row.range ?? [])]), reference); }
        finally { vm.onWrite = null; }
        assert.equal(heap.stats.allocations - allocations, 1, row.signature.join(','));
        assert.equal(heap.pins.length, pins);
        assert.equal(text(platform, reference), 'ab' + row.output + 'cd');
        heap.restore(snapshot);
        assert.equal(text(platform, reference), 'abcd');
      }
    });
  });

  test(`StringBuilder Insert storage ${engine}: observer faults retain the common string commit's partial progress`, () => {
    withBuilder(engine, flatRow, ({platform, vm, reference}) => {
      const {heap} = platform;
      const cases = preparedCases(platform).filter(row => row.signature[1] !== 'object');
      for (const row of cases) {
        const expanded = heap.string(row.output);
        heap.pins.push(expanded);
        const snapshot = heap.snapshot();
        const pins = heap.pins.length;
        for (const property of ['$count', '$version', '$length', '$capacity']) {
          const states = [];
          const failure = new Error('stop after ' + property);
          for (const typed of [true, false]) {
            heap.restore(snapshot);
            vm.onWrite = event => { if (event.property === property) { heap.collect(); throw failure; } };
            try {
              assert.throws(() => typed
                ? invoke(platform, reference, row.signature, [2, row.value, ...(row.range ?? [])])
                : invoke(platform, reference, ['int', 'string'], [2, expanded]), error => error === failure);
            } finally { vm.onWrite = null; }
            assert.equal(heap.pins.length, pins);
            states.push({metadata: metadata(platform, reference), text: text(platform, reference)});
          }
          assert.deepEqual(states[0], states[1], row.signature.join(',') + ' ' + property);
        }
        heap.restore(snapshot);
      }
    });
  });

  test(`StringBuilder Insert storage ${engine}: bounded Char decoding preserves blocks and reads only the chosen slice`, () => {
    withBuilder(engine, flatRow, ({platform, reference}) => {
      const selected = Array.from({length: 8195}, (_, index) => [0, 0xd800, 0xdc00, 65, 0xdc00][index % 5]);
      const value = managedCharacters(platform, [88, ...selected, 89]);
      platform.heap.pins.push(value);
      const data = platform.heap.get(value).data;
      const threshold = platform.heap.threshold;
      const outside = () => { throw new Error('Read outside selected Char range'); };
      // This measures conversion reads; GC legitimately scans every array slot and is exercised separately.
      platform.heap.threshold = platform.heap.maxBytes;
      Object.defineProperty(data, 0, {configurable: true, get: outside});
      Object.defineProperty(data, data.length - 1, {configurable: true, get: outside});
      try {
        invoke(platform, reference, ['int', 'char[]', 'int', 'int'], [2, value, 1, selected.length]);
        assert.deepEqual(units(text(platform, reference)), [...units('ab'), ...selected, ...units('cd')]);
      } finally {
        Object.defineProperty(data, 0, {configurable: true, writable: true, enumerable: true, value: 88});
        Object.defineProperty(data, data.length - 1, {configurable: true, writable: true, enumerable: true, value: 89});
        platform.heap.threshold = threshold;
      }
    });
  });

  test(`StringBuilder Insert storage ${engine}: virtual framework strings remain rooted through GC, including self insertion`, () => {
    withBuilder(engine, flatRow, ({platform, vm, reference}) => {
      const {heap} = platform;
      const source = platform.invoke(builderContract('.ctor', ['string']), [heap.string('x\0\ud800')]);
      heap.pins.push(source);
      const snapshot = heap.snapshot();
      const originalHost = platform.bclHost;
      let convertedReference = null;
      platform.bclHost = {...originalHost, invokeObjectToString(current, value) {
        const converted = originalHost.invokeObjectToString(current, value);
        convertedReference = converted.value;
        return converted;
      }};
      try {
        for (const [value, expected] of [[source, 'abx\0\ud800cd'], [reference, 'ababcdcd']]) {
          heap.restore(snapshot);
          heap.threshold = 1;
          vm.onWrite = () => {
            heap.collect();
            heap.get(convertedReference);
          };
          try { invoke(platform, reference, ['int', 'object'], [2, value]); }
          finally { vm.onWrite = null; }
          assert.equal(text(platform, reference), expected);
        }
      } finally {
        vm.onWrite = null;
        platform.bclHost = originalHost;
      }
    });
  });

  test(`StringBuilder Insert storage ${engine}: malformed host arrays and Char carriers fail before committing`, () => {
    withBuilder(engine, flatRow, ({platform, reference}) => {
      const {heap} = platform;
      const wrong = [42, heap.string('A'), heap.allocate('array', 'int[]', [65]), heap.allocate('array', 'char[,]', [65]),
        heap.allocate('array', 'char[*]', [65]), heap.allocate('object', 'char[]', [65])];
      heap.pins.push(...wrong);
      for (const value of wrong) assert.throws(() => invoke(platform, reference, ['int', 'char[]'], [1, value]),
        {name: 'ArgumentException'});
      const value = managedCharacters(platform, [65]);
      heap.pins.push(value);
      for (const invalid of [-1, 65536, NaN, 1.5]) {
        heap.get(value).data[0] = invalid;
        assert.throws(() => invoke(platform, reference, ['int', 'char[]'], [1, value]), {name: 'ArgumentOutOfRangeException'});
        assert.deepEqual(invoke(platform, reference, ['int', 'char[]', 'int', 'int'], [1, value, 0, 0]), reference);
      }
      assert.equal(text(platform, reference), 'abcd');
    });
  });
}
