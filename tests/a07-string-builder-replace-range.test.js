import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {MAX} from '@sharpforge/bcl-core';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderContract, builderPlatform, units} from './fixtures/string-builder/append-char.js';
import {createEditBuilder} from './fixtures/string-builder/replace-char.js';
import {builderReplaceRangeSource, builderReplaceRangeAssembly} from './fixtures/string-builder/replace-range.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-replace-range-net10.json', directory), 'utf8'));
const parameters = ['string', 'string', 'int', 'int'];
const engines = {source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly)};
const programs = new Map();
function compile(source, pipeline) {
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
function withBuilder(engine, segments, action) {
  const runner = builderPlatform(engine, '');
  try {
    runner.platform.heap.withRoots([], () => action({...runner, reference: createEditBuilder(runner.platform, segments)}));
    assert.equal(runner.platform.heap.pins.length, 0);
  } finally {runner.stop();}
}
function managedArguments(platform, values) {
  return values.map((value, index) => {
    if (index > 1 || value === null) return value;
    const reference = platform.heap.string(value);
    platform.heap.pins.push(reference);
    return reference;
  });
}
const state = (platform, reference) => ['$data', '$count', '$length', '$capacity', '$version'].map(key => platform.get(reference, key));
const invoke = (platform, reference, args) => platform.invoke(builderContract('Replace', parameters), [reference, ...args]);
const text = value => value === null ? null : String.fromCharCode(...value);

function referenceReplace(source, oldValue, replacement, start, count) {
  const end = start + count;
  const pieces = [source.slice(0, start)];
  for (let index = start; index < end;) {
    if (index + oldValue.length <= end && source.slice(index, index + oldValue.length) === oldValue) {
      pieces.push(replacement ?? '');
      index += oldValue.length;
    } else pieces.push(source[index++]);
  }
  pieces.push(source.slice(end));
  return pieces.join('');
}

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`StringBuilder.Replace range ${pipeline}/${engine}: every native successful text and fluent identity`, () => {
      const rows = native.rows.filter(row => !row.fault);
      const vm = create(compile(rows.map(builderReplaceRangeSource).join('\n'), pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'True\nTrue\n'.repeat(rows.length));
      } finally {vm.stop();}
    });
    test(`StringBuilder.Replace range ${pipeline}/${engine}: oldValue validation precedes ranges`, () => {
      for (const id of ['null-null-old-both-negative', 'flat-null-old-both-negative', 'flat-empty-old-past-negative',
        'flat-text-old-both-negative', 'flat-text-old-negative-count', 'flat-text-old-past-zero',
        'empty-empty-old-end-zero', 'flat-text-old-maximum-start']) {
        const row = native.rows.find(value => value.id === id);
        const vm = create(compile(builderReplaceRangeSource(row), pipeline));
        try {
          const result = vm.run();
          assert.equal(result.state, 'faulted', id);
          fault(result.fault, row);
        } finally {vm.stop();}
      }
    });
    test(`StringBuilder.Replace range ${pipeline}/${engine}: released whole-string and character overloads stay distinct`, () => {
      const vm = create(compile('var builder = new StringBuilder("a.a"); builder.Replace("a", "$&");' +
        'Console.WriteLine(builder.ToString()); builder.Replace((char)46, (char)33);' +
        'Console.WriteLine(builder.ToString());', pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '$&.$&\n$&!$&\n');
      } finally {vm.stop();}
    });
  }
  test(`StringBuilder.Replace range ${engine}: every native content/fault row with the existing runtime capacity profile`, () => {
    for (const row of native.rows) withBuilder(engine, row.segments, ({platform, reference}) => {
      const args = managedArguments(platform, [text(row.oldValue), text(row.newValue), row.start, row.count]);
      const before = reference === null ? null : state(platform, reference);
      if (row.fault) assert.throws(() => invoke(platform, reference, args), error => fault(error, row));
      else assert.deepEqual(invoke(platform, reference, args), reference, row.id);
      if (reference !== null) {
        assert.equal(platform.get(reference, '$length'), row.after.length, row.id);
        assert.equal(platform.get(reference, '$capacity'), Math.max(before[3], row.after.length), row.id);
        if (row.fault || row.count === 0) assert.deepEqual(state(platform, reference), before, row.id);
      }
      assert.deepEqual(content(platform, reference), row.after?.text ?? null, row.id);
    });
  });
  test(`StringBuilder.Replace range ${engine}: no-op paths need no managed budget or writes; metadata shortcuts avoid chunk reads`, () => {
    withBuilder(engine, ['aba', '\0\ud800\udc00', 'aba'].map(units), ({platform, vm, reference}) => {
      const {heap} = platform;
      const length = platform.get(reference, '$length');
      const args = [['a', 'x', length, 0], ['a', 'a', 0, length], ['aba', 'x', 1, 1], ['missing', 'x', 0, length]]
        .map(values => managedArguments(platform, values));
      const records = heap.get(platform.get(reference, '$data')).data.filter(Boolean).map(value => heap.get(value));
      const descriptors = records.map(record => Object.getOwnPropertyDescriptor(record, 'data'));
      let reads = 0, writes = 0;
      records.forEach((record, index) => Object.defineProperty(record, 'data', {
        configurable: true, get() {reads++; return descriptors[index].value;}
      }));
      const before = [state(platform, reference), heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision];
      const budget = heap.maxBytes;
      vm.onWrite = () => {writes++;};
      try {
        heap.maxBytes = 1;
        for (const values of args.slice(0, 3)) assert.deepEqual(invoke(platform, reference, values), reference);
        assert.equal(reads, 0);
        assert.deepEqual(invoke(platform, reference, args[3]), reference);
        assert.equal(writes, 0);
        assert.deepEqual([state(platform, reference), heap.stats.allocations, heap.stats.allocatedBytes, heap.mutationRevision], before);
      } finally {
        heap.maxBytes = budget;
        vm.onWrite = null;
        records.forEach((record, index) => Object.defineProperty(record, 'data', descriptors[index]));
      }
    });
  });
  test(`StringBuilder.Replace range ${engine}: final output includes the preserved prefix/suffix in its host limit`, () => {
    withBuilder(engine, ['aa'].map(units), ({platform, reference}) => {
      const {heap} = platform;
      const args = managedArguments(platform, ['a', 'x'.repeat(MAX), 0, 1]);
      const before = [state(platform, reference), heap.stats.allocations, heap.mutationRevision];
      assert.throws(() => invoke(platform, reference, args), {name: 'OutOfMemoryException'});
      args[3] = 2;
      assert.throws(() => invoke(platform, reference, args), {name: 'OutOfMemoryException'});
      assert.deepEqual([state(platform, reference), heap.stats.allocations, heap.mutationRevision], before);
      args[0] = heap.string('missing');
      heap.pins.push(args[0]);
      assert.deepEqual(invoke(platform, reference, args), reference, 'unused large replacement is not rejected');
      assert.deepEqual(content(platform, reference), units('aa'));
    });
  });
  test(`StringBuilder.Replace range ${engine}: invalid inputs and failed result allocation cannot mutate chunks`, () => {
    withBuilder(engine, ['aba', 'aba'].map(units), ({platform, reference}) => {
      const {heap} = platform;
      const args = managedArguments(platform, ['a', 'xx', 0, 6]);
      const before = state(platform, reference);
      const chunks = [...heap.get(before[0]).data];
      const budget = heap.maxBytes;
      heap.collect();
      try {
        heap.maxBytes = heap.stats.liveBytes;
        assert.throws(() => invoke(platform, reference, [null, args[1], -1, -1]), error => fault(error,
          {id: 'old before ranges and budget', fault: 'ArgumentNullException', parameter: 'oldValue'}));
        assert.throws(() => invoke(platform, reference, args), {name: 'OutOfMemoryException'});
      } finally {heap.maxBytes = budget;}
      assert.deepEqual(state(platform, reference), before);
      assert.deepEqual(heap.get(before[0]).data, chunks);
      assert.deepEqual(content(platform, reference), units('abaaba'));
    });
  });
  test(`StringBuilder.Replace range ${engine}: one managed result uses existing rooted commit and snapshot behavior`, () => {
    withBuilder(engine, ['ab', 'cd', 'ef'].map(units), ({platform, vm, reference}) => {
      const {heap} = platform;
      const args = managedArguments(platform, ['bcde', '$&', 1, 4]);
      const snapshot = heap.snapshot();
      const allocations = heap.stats.allocations;
      const pins = heap.pins.length;
      vm.onWrite = () => {
        heap.collect();
        assert.equal(platform.native(args[0]), 'bcde');
        assert.equal(platform.native(args[1]), '$&');
      };
      try {assert.deepEqual(invoke(platform, reference, args), reference);}
      finally {vm.onWrite = null;}
      assert.equal(heap.stats.allocations - allocations, 1);
      assert.equal(heap.pins.length, pins);
      assert.deepEqual(content(platform, reference), units('a$&f'));
      heap.restore(snapshot);
      assert.deepEqual(content(platform, reference), units('abcdef'));
    });
  });
  test(`StringBuilder.Replace range ${engine}: throwing length observers retain committed text and release temporary roots`, () => {
    withBuilder(engine, ['ab', 'cd', 'ef'].map(units), ({platform, vm, reference}) => {
      const args = managedArguments(platform, ['bcde', 'X', 1, 4]);
      const pins = platform.heap.pins.length;
      vm.onWrite = event => {
        if (event.property === '$length') {
          platform.heap.collect();
          throw new Error('observer stopped');
        }
      };
      try {assert.throws(() => invoke(platform, reference, args), /observer stopped/);}
      finally {vm.onWrite = null;}
      assert.equal(platform.heap.pins.length, pins);
      assert.equal(platform.get(reference, '$length'), 3);
      assert.deepEqual(content(platform, reference), units('aXf'));
    });
  });
  test(`StringBuilder.Replace range ${engine}: bounded deterministic trace matches an independent UTF-16 scan`, () => {
    withBuilder(engine, ['a\0\ud800', '\udc00aabab'].map(units), ({platform, reference}) => {
      let expected = 'a\0\ud800\udc00aabab';
      let seed = 0x337;
      const random = maximum => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return (seed >>> 8) % maximum;
      };
      const needles = ['a', 'aa', 'ab', '\0', '\ud800', '\udc00', '\ud800\udc00', 'b\0'];
      const replacements = [null, '', 'a', '$$', '$&', '\ud800', 'ab', '\0'];
      for (let step = 0; step < 10000; step++) {
        if (step % 31 === 0 || expected.length > 96) {
          expected = 'a\0\ud800\udc00aabab';
          platform.invoke(builderContract('Clear'), [reference]);
          platform.invoke(builderContract('Append', ['string']), [reference, platform.heap.string(expected)]);
        }
        const start = random(expected.length + 1), count = random(expected.length - start + 1);
        const oldValue = needles[random(needles.length)], newValue = replacements[random(replacements.length)];
        platform.heap.withRoots([], () => {
          const args = managedArguments(platform, [oldValue, newValue, start, count]);
          assert.deepEqual(invoke(platform, reference, args), reference);
        });
        expected = referenceReplace(expected, oldValue, newValue, start, count);
        assert.deepEqual(content(platform, reference), units(expected), 'step ' + step);
        if (step % 128 === 0) platform.heap.collect();
      }
    });
  });
}

test('StringBuilder.Replace range: independent CIL matches every native result and fault', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(builderReplaceRangeAssembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (row.fault) fault(result.fault, row);
      else assert.equal(Boolean(vm.statics.get(0x04000002)), true, row.id);
      assert.deepEqual(content(vm.platform, vm.statics.get(0x04000001)), row.after?.text ?? null, row.id);
    } finally {vm.stop();}
  }
});

test('StringBuilder.Replace range: fixed native provenance and appended ID preserve all earlier signatures', () => {
  const source = readFileSync(new URL('string-builder-replace-range/Program.cs', directory));
  assert.equal(native.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(native.sourceSha256, 'be99c84c6665ecbc82119145ff14517d33ef9eff5c0be96efcf6ce05ceec8588');
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  assert.equal(native.rows.length, 230);
  assert.equal(builderContract('Replace', ['string', 'string']).id, 816);
  assert.equal(builderContract('Replace', ['char', 'char', 'int', 'int']).id, 524335);
  assert.equal(builderContract('Insert', ['int', 'char']).id, 524336);
  assert.equal(builderContract('Replace', parameters).id, 524337);
  const row = native.rows.find(value => value.id === 'chunks-full-delete');
  assert.equal(row.before.capacity, 8);
  assert.equal(row.after.capacity, 5, 'native capacity changes remain explicit evidence, not runtime parity');
});
