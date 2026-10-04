import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderContract, builderPlatform, units} from './fixtures/string-builder/append-char.js';
import {insertCharacterParameters, createInsertBuilder, builderInsertCharacterSource,
  builderInsertCharacterAssembly} from './fixtures/string-builder/insert-char.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-insert-char-net10.json', directory), 'utf8'));
const engines = {source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly)};
const programs = new Map();
function compile(source, pipeline = 'bound') {
  const key = pipeline + source;
  if (!programs.has(key)) {
    const program = compileToIL('using System;using System.Text;' + source, {pipeline});
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    programs.set(key, program);
  }
  return programs.get(key);
}
function fault(error, row) {
  assert.equal(error.name, row.fault, row.id);
  if (row.parameter) assert(error.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + error.message);
  return true;
}
function content(platform, reference) {
  return reference === null ? null : units(platform.native(platform.invoke(builderContract('ToString'), [reference])));
}
function withBuilder(engine, row, action) {
  const runner = builderPlatform(engine, '');
  try {
    runner.platform.heap.withRoots([], () => action({...runner, reference: createInsertBuilder(runner.platform, row)}));
    assert.equal(runner.platform.heap.pins.length, 0);
  } finally {runner.stop();}
}
function invoke(platform, reference, row) {
  const value = row.sourceIndex === null ? row.value
    : platform.invoke(builderContract('get_Chars', ['int']), [reference, row.sourceIndex]);
  return platform.invoke(builderContract('Insert', insertCharacterParameters), [reference, row.index, value]);
}
const metadata = (platform, reference) => ['$data', '$count', '$length', '$capacity', '$version'].map(key => platform.get(reference, key));

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`StringBuilder.Insert char ${pipeline}/${engine}: native text, UTF-16 offsets and aliased reads`, () => {
      const rows = native.rows.filter(row => !row.fault);
      const vm = create(compile(rows.map(builderInsertCharacterSource).join('\n'), pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'True\nTrue\n'.repeat(rows.length));
      } finally {vm.stop();}
    });
    test(`StringBuilder.Insert char ${pipeline}/${engine}: null/index/getter faults retain evaluation order`, () => {
      for (const id of ['null-minimum-65', 'empty-negative-65', 'flat-past-65', 'chunks-maximum-0', 'alias-invalid-getter-first']) {
        const row = native.rows.find(value => value.id === id);
        const vm = create(compile(builderInsertCharacterSource(row), pipeline));
        try {
          const result = vm.run();
          assert.equal(result.state, 'faulted', id);
          fault(result.fault, row);
        } finally {vm.stop();}
      }
    });
    test(`StringBuilder.Insert char ${pipeline}/${engine}: released string insertion remains nullable and fluent`, () => {
      const vm = create(compile('var builder = new StringBuilder("ab");string missing = null;' +
        'Console.WriteLine(object.ReferenceEquals(builder, builder.Insert(1, missing)));' +
        'builder.Insert(1, "65");Console.WriteLine(builder.ToString());', pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'True\na65b\n');
      } finally {vm.stop();}
    });
  }
  test(`StringBuilder.Insert char ${engine}: every native text/fault result and released storage profile`, () => {
    for (const row of native.rows) withBuilder(engine, row, ({platform, reference}) => {
      const before = reference === null ? null : metadata(platform, reference);
      if (row.fault) {
        assert.throws(() => invoke(platform, reference, row), error => fault(error, row));
        assert.deepEqual(reference === null ? null : metadata(platform, reference), before, row.id);
      } else {
        assert.deepEqual(invoke(platform, reference, row), reference, row.id);
        const control = createInsertBuilder(platform, row);
        const unit = row.sourceIndex === null ? row.value : row.before.text[row.sourceIndex];
        platform.invoke(builderContract('Insert', ['int', 'string']), [control, row.index, platform.heap.string(String.fromCharCode(unit))]);
        assert.equal(platform.get(reference, '$capacity'), platform.get(control, '$capacity'), row.id);
        assert.equal(platform.get(reference, '$count'), platform.get(control, '$count'), row.id);
        assert.equal(platform.get(reference, '$length'), row.after.length, row.id);
      }
      assert.deepEqual(content(platform, reference), row.after?.text ?? null, row.id);
    });
  });
  test(`StringBuilder.Insert char ${engine}: insertion flattens once, survives collection and restores snapshots`, () => {
    const row = native.rows.find(value => value.id === 'chunks-middle-55296');
    withBuilder(engine, row, ({platform, vm, reference}) => {
      const {heap} = platform;
      const snapshot = heap.snapshot();
      const storage = platform.get(reference, '$data');
      const allocations = heap.stats.allocations;
      const events = [];
      vm.onWrite = event => {heap.collect(); events.push(event.property);};
      try {invoke(platform, reference, row);}
      finally {vm.onWrite = null;}
      assert.equal(heap.stats.allocations - allocations, 1, 'one managed replacement string with existing backing capacity');
      assert.deepEqual(platform.get(reference, '$data'), storage);
      assert.equal(platform.get(reference, '$count'), 1);
      assert.deepEqual(events, ['$count', '$version', '$length', '$capacity']);
      assert.deepEqual(content(platform, reference), row.after.text);
      heap.restore(snapshot);
      assert.deepEqual(content(platform, reference), row.before.text);
    });
  });
  test(`StringBuilder.Insert char ${engine}: first-allocation OOM and invalid-index calls leave builder unchanged`, () => {
    const row = native.rows.find(value => value.id === 'flat-middle-65');
    withBuilder(engine, row, ({platform, reference}) => {
      const {heap} = platform;
      const before = metadata(platform, reference);
      const budget = heap.maxBytes;
      try {
        heap.maxBytes = 1;
        assert.throws(() => invoke(platform, reference, row), {name: 'OutOfMemoryException'});
        assert.throws(() => invoke(platform, reference, {...row, index: -1}), error =>
          fault(error, {...row, fault: 'ArgumentOutOfRangeException', parameter: 'index'}));
        assert.deepEqual(metadata(platform, reference), before);
      } finally {heap.maxBytes = budget;}
      assert.deepEqual(content(platform, reference), row.before.text);
      invoke(platform, reference, row);
      assert.deepEqual(content(platform, reference), row.after.text);
    });
  });
  test(`StringBuilder.Insert char ${engine}: host text ceiling is checked before managed replacement allocation`, () => {
    const row = {segments: [], capacity: 16, index: 1000000, value: 0, sourceIndex: null};
    withBuilder(engine, row, ({platform, reference}) => {
      platform.invoke(builderContract('Append', ['string']), [reference, platform.heap.string('a'.repeat(1000000))]);
      const before = metadata(platform, reference);
      const allocations = platform.heap.stats.allocations;
      assert.throws(() => invoke(platform, reference, row), {name: 'OutOfMemoryException'});
      assert.deepEqual(metadata(platform, reference), before);
      assert.equal(platform.heap.stats.allocations, allocations);
    });
  });
  test(`StringBuilder.Insert char ${engine}: deterministic insert positions retain all raw units`, () => {
    const row = {segments: [[97, 0xd800, 0xdc00]], capacity: 16, sourceIndex: null};
    withBuilder(engine, row, ({platform, reference}) => {
      const expected = [...row.segments[0]];
      let seed = 336;
      for (let step = 0; step < 500; step++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const index = (seed >>> 8) % (expected.length + 1), value = seed & 0xffff;
        invoke(platform, reference, {...row, index, value});
        expected.splice(index, 0, value);
        assert.deepEqual(content(platform, reference), expected, 'step ' + step);
        if (step % 64 === 0) platform.heap.collect();
      }
    });
  });
}

test('StringBuilder.Insert char: independent CIL matches the complete pinned native matrix', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(builderInsertCharacterAssembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (row.fault) fault(result.fault, row);
      else assert.equal(Boolean(vm.statics.get(0x04000002)), true, row.id);
      assert.deepEqual(content(vm.platform, vm.statics.get(0x04000001)), row.after?.text ?? null, row.id);
    } finally {vm.stop();}
  }
});

test('StringBuilder.Insert char: native provenance and appended exact signature', () => {
  const source = readFileSync(new URL('string-builder-insert-char/Program.cs', directory));
  assert.equal(native.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(native.sourceSha256, '707c32a4b6f2300d452826b6f47adb171dd6d3f9d21c74f2994df406b1590a4b');
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  assert.equal(native.rows.length, 101);
  assert.equal(builderContract('Insert', insertCharacterParameters).id, 524336);
  assert.equal(builderContract('Replace', ['char', 'char', 'int', 'int']).id, 524335);
  for (const row of native.rows) if (row.fault) assert.deepEqual(row.after, row.before, row.id);
  const many = native.rows.find(row => row.id === 'many-chunks');
  assert.equal(many.segments.length, 32);
  assert.equal(many.before.chunks, 1);
  assert.equal(many.after.chunks, 2);
});
