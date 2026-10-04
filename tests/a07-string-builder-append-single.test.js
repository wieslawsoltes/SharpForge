import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {float, int32BitsToSingle} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderPlatform} from './fixtures/string-builder/append-char.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-append-single-net10.json', directory), 'utf8'));
const rows = native.rows.filter(row => !row.nullReceiver);

for (const engine of ['source', 'cil']) {
  test(`Single append prerequisite ${engine}: existing typed default formatter matches exact native Single bits`, () => {
    const builder = builderPlatform(engine);
    try {
      const actual = rows.map(row => {
        const value = int32BitsToSingle(Number.parseInt(row.bits, 16) | 0);
        return {bits: row.bits, text: builder.vm.format(value, 'float')};
      });
      assert.deepEqual(actual, rows.map(row => ({bits: row.bits, text: row.text})));
    } finally { builder.stop(); }
  });

  test(`Single append prerequisite ${engine}: explicitly widened Double controls retain binary64 output`, () => {
    const builder = builderPlatform(engine);
    try {
      const actual = rows.map(row => {
        const value = int32BitsToSingle(Number.parseInt(row.bits, 16) | 0);
        return {bits: row.bits, text: builder.vm.format(float(value.value, 'r8'), 'double')};
      });
      assert.deepEqual(actual, rows.map(row => ({bits: row.bits, text: row.doubleText})));
    } finally { builder.stop(); }
  });
}

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`Single append prerequisite ${pipeline}/${engine}: existing typed Console path honors Single notation`, () => {
      const program = compileToIL('using System; float value = 1000000000f; Console.WriteLine(value);', {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        const row = rows.find(value => value.bits === '4e6e6b28');
        assert.equal(result.output, row.text + '\n');
      } finally { vm.stop(); }
    });
  }
}

test('Single append evidence preserves pinned native source and exact-bit input transport', () => {
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  assert.equal(native.rows.length, 44);
  for (const row of native.rows) {
    assert.match(row.bits, /^[0-9a-f]{8}$/);
    assert.match(row.observedBits, /^[0-9a-f]{8}$/);
  }
  const source = readFileSync(new URL('string-builder-append-single/Program.cs', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), native.sourceSha256);
});
