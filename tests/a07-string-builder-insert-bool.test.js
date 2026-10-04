import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {disassemble, frameworkBuiltin} from '@sharpforge/bytecode';
import {MAX} from '@sharpforge/bcl-core';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderContract, builderPlatform, units} from './fixtures/string-builder/append-char.js';
import {createInsertBuilder} from './fixtures/string-builder/insert-char.js';
import {insertBooleanParameters, builderInsertBooleanSource, builderInsertBooleanAssembly,
  booleanInsertionFluentSource} from './fixtures/string-builder/insert-bool.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-insert-bool-net10.json', directory), 'utf8'));
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
function valueFor(platform, reference, row) {
  return row.sourceIndex === null ? row.value
    : platform.invoke(builderContract('get_Chars', ['int']), [reference, row.sourceIndex]) !== 0;
}
function invoke(platform, reference, row, engine) {
  const value = valueFor(platform, reference, row);
  const argument = engine === 'cil' ? Number(value) : value;
  return platform.invoke(builderContract('Insert', insertBooleanParameters), [reference, row.index, argument]);
}
const metadata = (platform, reference) => ['$data', '$count', '$length', '$capacity', '$version'].map(key => platform.get(reference, key));

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`StringBuilder.Insert bool ${pipeline}/${engine}: typed Boolean locals select the exact native contract`, () => {
      const rows = native.rows.filter(row => !row.fault);
      const program = compile(rows.map(builderInsertBooleanSource).join('\n'), pipeline);
      const instructions = disassemble(program.image).flatMap(method => method.instructions);
      const id = frameworkBuiltin(builderContract('Insert', insertBooleanParameters)).id;
      assert(instructions.some(item => item.op === 'BUILTIN' && item.a === id));
      const vm = create(program);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'True\nTrue\n'.repeat(rows.length));
      } finally {vm.stop();}
    });
    test(`StringBuilder.Insert bool ${pipeline}/${engine}: null/index/getter faults retain evaluation order`, () => {
      for (const id of ['null-minimum-False', 'empty-negative-True', 'flat-past-False', 'chunks-maximum-True', 'alias-invalid-getter-first']) {
        const row = native.rows.find(value => value.id === id);
        const vm = create(compile(builderInsertBooleanSource(row), pipeline));
        try {
          const result = vm.run();
          assert.equal(result.state, 'faulted', id);
          fault(result.fault, row);
        } finally {vm.stop();}
      }
    });
    test(`StringBuilder.Insert bool ${pipeline}/${engine}: receiver and arguments evaluate once in a mixed fluent chain`, () => {
      const vm = create(compile(booleanInsertionFluentSource, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, native.fluent.calls + '\n' + String.fromCharCode(...native.fluent.text) + '\n13\nTrue\n');
      } finally {vm.stop();}
    });
  }
  test(`StringBuilder.Insert bool ${engine}: all native text/fault rows and released string storage policy`, () => {
    for (const row of native.rows) withBuilder(engine, row, ({platform, reference}) => {
      const before = reference === null ? null : metadata(platform, reference);
      if (row.fault) {
        assert.throws(() => invoke(platform, reference, row, engine), error => fault(error, row));
        assert.deepEqual(reference === null ? null : metadata(platform, reference), before, row.id);
      } else {
        const value = valueFor(platform, reference, row);
        assert.deepEqual(invoke(platform, reference, row, engine), reference, row.id);
        const control = createInsertBuilder(platform, row);
        const text = platform.heap.string(value ? 'True' : 'False');
        platform.invoke(builderContract('Insert', ['int', 'string']), [control, row.index, text]);
        assert.equal(platform.get(reference, '$capacity'), platform.get(control, '$capacity'), row.id);
        assert.equal(platform.get(reference, '$count'), platform.get(control, '$count'), row.id);
        assert.equal(platform.get(reference, '$length'), row.after.length, row.id);
      }
      assert.deepEqual(content(platform, reference), row.after?.text ?? null, row.id);
    });
  });
  test(`StringBuilder.Insert bool ${engine}: replacement roots survive observer collection and snapshot restore`, () => {
    const row = native.rows.find(value => value.id === 'chunks-middle-True');
    withBuilder(engine, row, ({platform, vm, reference}) => {
      const {heap} = platform;
      const snapshot = heap.snapshot();
      const storage = platform.get(reference, '$data');
      const allocations = heap.stats.allocations;
      const events = [];
      vm.onWrite = event => {heap.collect(); events.push(event.property);};
      try {invoke(platform, reference, row, engine);}
      finally {vm.onWrite = null;}
      assert.equal(heap.stats.allocations - allocations, 1, 'one replacement string with spare backing capacity');
      assert.deepEqual(platform.get(reference, '$data'), storage);
      assert.equal(platform.get(reference, '$count'), 1);
      assert.deepEqual(events, ['$count', '$version', '$length', '$capacity']);
      assert.deepEqual(content(platform, reference), row.after.text);
      heap.restore(snapshot);
      assert.deepEqual(content(platform, reference), row.before.text);
    });
  });
  test(`StringBuilder.Insert bool ${engine}: first-allocation OOM and index faults leave builder unchanged`, () => {
    const row = native.rows.find(value => value.id === 'flat-middle-False');
    withBuilder(engine, row, ({platform, reference}) => {
      const {heap} = platform;
      const before = metadata(platform, reference);
      const budget = heap.maxBytes;
      try {
        heap.maxBytes = 1;
        assert.throws(() => invoke(platform, reference, row, engine), {name: 'OutOfMemoryException'});
        assert.throws(() => invoke(platform, reference, {...row, index: -1}, engine), error =>
          fault(error, {...row, fault: 'ArgumentOutOfRangeException', parameter: 'index'}));
        assert.deepEqual(metadata(platform, reference), before);
      } finally {heap.maxBytes = budget;}
      assert.deepEqual(content(platform, reference), row.before.text);
      invoke(platform, reference, row, engine);
      assert.deepEqual(content(platform, reference), row.after.text);
    });
  });
  test(`StringBuilder.Insert bool ${engine}: Boolean text lengths respect the host ceiling before allocation`, () => {
    for (const [length, value, succeeds] of [[MAX - 4, true, true], [MAX - 4, false, false], [MAX - 5, false, true]]) {
      const row = {segments: [], capacity: 16, index: length, value, sourceIndex: null};
      withBuilder(engine, row, ({platform, reference}) => {
        platform.invoke(builderContract('set_Length', ['int']), [reference, length]);
        const before = metadata(platform, reference);
        const allocations = platform.heap.stats.allocations;
        if (succeeds) {
          assert.deepEqual(invoke(platform, reference, row, engine), reference);
          assert.equal(platform.get(reference, '$length'), MAX);
          assert(platform.native(platform.invoke(builderContract('ToString'), [reference])).endsWith(value ? 'True' : 'False'));
        } else {
          assert.throws(() => invoke(platform, reference, row, engine), {name: 'OutOfMemoryException'});
          assert.deepEqual(metadata(platform, reference), before);
          assert.equal(platform.heap.stats.allocations, allocations);
        }
      });
    }
  });
  test(`StringBuilder.Insert bool ${engine}: throwing observers retain the released partial-progress policy and release roots`, () => {
    const row = native.rows.find(value => value.id === 'chunks-middle-False');
    withBuilder(engine, row, ({platform, vm, reference}) => {
      const {heap} = platform;
      const text = heap.string('False', [reference]);
      heap.pins.push(text);
      const snapshot = heap.snapshot();
      const pins = heap.pins.length;
      for (const property of ['$count', '$version', '$length', '$capacity']) {
        const states = [];
        const failure = new Error('observer stop');
        for (const boolean of [true, false]) {
          heap.restore(snapshot);
          vm.onWrite = event => {if (event.property === property) {heap.collect(); throw failure;}};
          try {
            assert.throws(() => boolean ? invoke(platform, reference, row, engine)
              : platform.invoke(builderContract('Insert', ['int', 'string']), [reference, row.index, text]), error => error === failure);
          } finally {vm.onWrite = null;}
          assert.equal(heap.pins.length, pins);
          states.push({metadata: metadata(platform, reference), text: content(platform, reference)});
        }
        assert.deepEqual(states[0], states[1], property);
      }
    });
  });
}

test('StringBuilder.Insert bool: independent CIL matches every pinned native text/fault result', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(builderInsertBooleanAssembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (row.fault) fault(result.fault, row);
      else assert.equal(Boolean(vm.statics.get(0x04000002)), true, row.id);
      assert.deepEqual(content(vm.platform, vm.statics.get(0x04000001)), row.after?.text ?? null, row.id);
    } finally {vm.stop();}
  }
});

test('StringBuilder.Insert bool: frozen native provenance and append-only signature', () => {
  const source = readFileSync(new URL('string-builder-insert-bool/Program.cs', directory));
  assert.equal(native.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(native.sourceSha256, '4c11d26614fdc5a7ebff5e662cff257a287ed0746a37b587bc2d0a446b6069d1');
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  assert.equal(native.rows.length, 71);
  assert.equal(builderContract('Insert', insertBooleanParameters).id, 524338);
  assert.equal(builderContract('Insert', ['int', 'char']).id, 524336);
  assert.equal(builderContract('Replace', ['string', 'string', 'int', 'int']).id, 524337);
  assert.equal(builderContract('Insert', ['int', 'string']).id, 814);
  for (const row of native.rows) if (row.fault) assert.deepEqual(row.after, row.before, row.id);
  const many = native.rows.find(row => row.id === 'many-segments-True');
  assert.equal(many.segments.length, 32);
  assert.equal(many.before.chunks, 1);
  assert.equal(many.after.chunks, 2);
  assert.equal(native.fluent.calls, 123);
  assert.equal(native.fluent.identity, true);
  assert.equal(native.fluent.length, 13);
});
