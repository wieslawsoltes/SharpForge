import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {ManagedFault, VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {registerIoModules} from '@sharpforge/bcl-io';
import {readerPlatform, readerContract, parentType} from './fixtures/text-reader/engines.js';
import {bufferContract, bufferReader} from './fixtures/text-reader/buffer.js';

const directory = new URL('../packages/bcl-io/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-reader-buffer-net10.json', directory), 'utf8'));

function peek(platform, receiver) {
  try { return {next: platform.invoke(readerContract('Peek'), [receiver]), nextFault: null}; }
  catch (error) {
    assert(error instanceof ManagedFault);
    return {next: null, nextFault: error.name};
  }
}

for (const engine of ['source', 'cil']) {
  test(`SF-A09-T03 buffer ${engine}: all 56 native slice results execute through real bytecode`, () => {
    assert.equal(native.rows.length, 56);
    for (const row of native.rows) {
      const {vm, reader, buffer} = bufferReader(engine, row);
      try {
        const result = vm.run();
        assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
        const actual = {
          countRead: row.fault ? null : vm.value(vm.returnValue),
          fault: result.fault?.name ?? null,
          buffer: buffer() === null ? null : [...vm.heap.get(buffer()).data],
          ...peek(vm.platform, reader())
        };
        const expected = {countRead: row.countRead, fault: row.fault, buffer: row.buffer, next: row.next, nextFault: row.nextFault};
        assert.deepEqual(actual, expected, row.id);
      } finally {vm.stop();}
    }
  });

  test(`SF-A09-T03 buffer ${engine}: slice writes retain storage and allocate no managed values`, () => {
    const reader = readerPlatform(engine, 'ABCDE');
    const {vm, platform, reference} = reader;
    const buffer = platform.heap.array('char', 7);
    const root = platform.heap.createHandle(buffer);
    const data = platform.heap.get(buffer).data;
    data.fill(46);
    const writes = [];
    const fields = [];
    const allocations = platform.heap.stats.allocations;
    const bytes = platform.heap.stats.allocatedBytes;
    const revision = platform.heap.mutationRevision;
    try {
      vm.onWrite = event => {
        if (event.kind === 'array') writes.push([event.index, event.oldValue, event.value]);
        else if (event.kind === 'field') fields.push([event.property, event.oldValue, event.value]);
      };
      assert.equal(platform.invoke(bufferContract('Read'), [reference, buffer, 2, 3]), 3);
      assert.strictEqual(platform.heap.get(buffer).data, data);
      assert.deepEqual(data, [46, 46, 65, 66, 67, 46, 46]);
      assert.deepEqual(writes, [[2, 46, 65], [3, 46, 66], [4, 46, 67]]);
      assert.deepEqual(fields, [['$position', 0, 3]]);
      assert.equal(platform.heap.stats.allocations, allocations);
      assert.equal(platform.heap.stats.allocatedBytes, bytes);
      assert(platform.heap.mutationRevision > revision);
      assert.equal(reader.call('Peek'), 68);
      const beforeZero = platform.heap.mutationRevision;
      assert.equal(platform.invoke(bufferContract('ReadBlock'), [reference, buffer, 7, 0]), 0);
      assert.equal(platform.heap.mutationRevision, beforeZero);
      assert.equal(writes.length, 3);
    } finally {vm.onWrite = null; platform.heap.releaseHandle(root); reader.stop();}
  });

  test(`SF-A09-T03 buffer ${engine}: read and read-block share cursor state and restore with the buffer`, () => {
    const reader = readerPlatform(engine, 'ABCDE');
    const {platform, reference} = reader;
    const buffer = platform.heap.array('char', 4);
    const root = platform.heap.createHandle(buffer);
    platform.heap.get(buffer).data.fill(46);
    try {
      assert.equal(platform.invoke(bufferContract('Read'), [reference, buffer, 1, 2]), 2);
      const snapshot = platform.heap.snapshot();
      assert.equal(platform.invoke(bufferContract('ReadBlock'), [reference, buffer, 0, 4]), 3);
      assert.deepEqual(platform.heap.get(buffer).data, [67, 68, 69, 46]);
      assert.equal(platform.invoke(bufferContract('Read'), [reference, buffer, 0, 4]), 0);
      platform.heap.restore(snapshot);
      assert.deepEqual(platform.heap.get(buffer).data, [46, 65, 66, 46]);
      assert.equal(reader.call('Peek'), 67);
      assert.equal(platform.invoke(bufferContract('ReadBlock'), [reference, buffer, 0, 4]), 3);
      reader.call('Dispose');
      assert.throws(() => platform.invoke(bufferContract('ReadBlock'), [reference, buffer, 4, 0]),
        {name: 'ObjectDisposedException'});
    } finally {platform.heap.releaseHandle(root); reader.stop();}
  });

  test(`SF-A09-T03 buffer ${engine}: buffer and input stay rooted across write observers`, () => {
    const reader = readerPlatform(engine, 'ABCD');
    const {vm, platform, reference} = reader;
    const buffer = platform.heap.array('char', 5);
    platform.heap.get(buffer).data.fill(46);
    let writes = 0;
    try {
      vm.onWrite = event => {
        if (event.kind === 'array') writes++;
        platform.heap.collect();
      };
      assert.equal(platform.invoke(bufferContract('ReadBlock'), [reference, buffer, 1, 4]), 4);
      assert.equal(writes, 4);
      assert.deepEqual(platform.heap.get(buffer).data, [46, 65, 66, 67, 68]);
      assert.equal(platform.heap.pins.length, 0);
    } finally {vm.onWrite = null; reader.stop();}
  });

  test(`SF-A09-T03 buffer ${engine}: observer failure releases roots and leaves the cursor uncommitted`, () => {
    const reader = readerPlatform(engine, 'ABCD');
    const {vm, platform, reference} = reader;
    const buffer = platform.heap.array('char', 4);
    platform.heap.get(buffer).data.fill(46);
    const failure = new Error('Observer failed');
    let writes = 0;
    try {
      vm.onWrite = event => {
        if (event.kind === 'array' && ++writes === 2) throw failure;
      };
      assert.throws(() => platform.invoke(bufferContract('Read'), [reference, buffer, 0, 4]), error => error === failure);
      assert.deepEqual(platform.heap.get(buffer).data, [65, 66, 46, 46]);
      assert.equal(reader.call('Peek'), 65);
      assert.equal(platform.heap.pins.length, 0);
      vm.onWrite = null;
      assert.equal(platform.invoke(bufferContract('Read'), [reference, buffer, 0, 4]), 4);
    } finally {vm.onWrite = null; reader.stop();}
  });

  test(`SF-A09-T03 buffer ${engine}: invalid platform array shapes and numeric arguments do not consume input`, () => {
    const reader = readerPlatform(engine, 'ABC');
    const {platform, reference} = reader;
    const buffer = platform.heap.array('char', 3);
    const wrong = platform.heap.array('int', 3);
    const root = platform.heap.createHandle(buffer);
    const wrongRoot = platform.heap.createHandle(wrong);
    try {
      assert.throws(() => platform.invoke(bufferContract('Read'), [reference, wrong, 0, 1]), {name: 'ArgumentException'});
      for (const [index, count] of [[0.5, 1], [0, NaN], [0, Infinity], [0, 2147483648]]) {
        assert.throws(() => platform.invoke(bufferContract('Read'), [reference, buffer, index, count]),
          {name: 'ArgumentOutOfRangeException'});
      }
      assert.equal(reader.call('Peek'), 65);
    } finally {platform.heap.releaseHandle(root); platform.heap.releaseHandle(wrongRoot); reader.stop();}
  });
}

test('SF-A09-T03 buffer: registration appends after all reader and writer base IDs', () => {
  assert.equal(bufferContract('Read').id, 655381);
  assert.equal(bufferContract('ReadBlock').id, 655382);
  assert.equal(readerContract('Read').id, 655362);
  assert.equal(readerContract('.ctor').id, 655367);
  assert.equal(findContracts('System.IO.StringWriter', 'ToString', false)[0].id, 655380);
  assert.equal(findContracts('System.Text.Json.JsonElement', 'GetInt64', false)[0].id, 655360);
  const entries = [];
  registerIoModules({
    define() {},
    member(owner, name, parameters) {entries.push({owner, name, parameters});},
    ctor(owner, parameters = []) {entries.push({owner, name: '.ctor', parameters});},
    prop(owner, name) {entries.push({owner, name: 'get_' + name}, {owner, name: 'set_' + name});}
  });
  assert.equal(entries.length, 43);
  assert.deepEqual(entries.slice(20, 22), ['Read', 'ReadBlock']
    .map(name => ({owner: parentType, name, parameters: ['char[]', 'int', 'int']})));
  assert.deepEqual(entries.slice(22, 24), [['char[]'], ['char[]', 'int', 'int']]
    .map(parameters => ({owner: 'System.IO.TextWriter', name: 'Write', parameters})));
  assert.deepEqual(entries.slice(24, 26), [['char[]'], ['char[]', 'int', 'int']]
    .map(parameters => ({owner: 'System.IO.TextWriter', name: 'WriteLine', parameters})));
  assert.deepEqual(entries[26], {owner: 'System.IO.TextWriter', name: 'WriteLine', parameters: ['char']});
});

test('SF-A09-T03 buffer: native capture pins exact source bytes and UTF-16 boundary data', () => {
  const source = readFileSync(new URL('string-reader-buffer/Program.cs', directory));
  assert.equal(native.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(native.runtime, '10.0.5');
  assert.equal(native.sdk, '10.0.201');
  assert.deepEqual(native.rows.find(row => row.id === 'utf16-units/Read').buffer,
    [46, 0, 55357, 56832, 55296, 88, 56320, 13, 10, 46]);
});

for (const pipeline of ['bound', 'legacy']) {
  for (const [engine, create] of Object.entries({source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly)})) {
    test(`SF-A09-T03 buffer ${pipeline} ${engine}: source character arrays preserve destination slices`, () => {
      const program = compileToIL('using System.IO; var reader = new StringReader("xy"); ' +
        "var buffer = new char[] {'a', 'b', 'c'};" +
        'Console.WriteLine(reader.Read(buffer, 1, 1));Console.WriteLine((int)buffer[0]);Console.WriteLine((int)buffer[1]);' +
        'Console.WriteLine(reader.ReadBlock(buffer, 2, 1));Console.WriteLine((int)buffer[2]);Console.WriteLine(reader.Peek());', {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = create(program);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '1\n97\n120\n1\n121\n-1\n');
      } finally {vm.stop();}
    });
  }
}
