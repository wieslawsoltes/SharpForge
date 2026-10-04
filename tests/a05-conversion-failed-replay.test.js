import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {numericDifferential} from './support/numeric-differential.js';
import {conversionMatrixCases} from './support/numeric-conversion-matrix.js';
import {replayConversionCapture} from '../scripts/numeric/conversion-replay.js';
import {saveConversionChunk} from '../scripts/numeric/conversion-capture.js';
import {conversionDigest} from '../scripts/numeric/conversion-proof.js';
import {finalizeConversions} from '../scripts/numeric/qualify-conversions.js';

const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

test('a failed ABI32 replay retains the actual emitted CIL and cannot finalize as qualified', () => {
  const directory = mkdtempSync(join(tmpdir(), 'a05-failed-conversion-'));
  try {
    const cases = conversionMatrixCases(32).filter(row =>
      row.source === 'native' && row.input === '2147483647' && row.opcode === 'conv.i');
    assert.equal(cases.length, 1);
    const writes = [];
    const record = (row, artifacts) => {
      saveConversionChunk(directory, row, artifacts);
      writes.push({status: row.status, assemblySha256: row.assemblySha256});
      if (artifacts.assembly) {
        assert.equal(conversionDigest(readFileSync(join(directory, 'replay/0000.dll'))), row.assemblySha256);
      }
    };
    // Deliberately incorrect authored answer exercises retained failure evidence, not a native parity claim.
    assert.throws(() => replayConversionCapture(cases, '2147483646\n', record), /native conversion ABI32/);
    assert.deepEqual(writes.map(row => row.status), ['running', 'running', 'failed']);
    assert.equal(writes[0].assemblySha256, undefined);
    assert.match(writes[1].assemblySha256, /^[a-f0-9]{64}$/);
    assert.equal(writes[2].assemblySha256, writes[1].assemblySha256);
    const failed = JSON.parse(readFileSync(join(directory, 'replay/0000.json')));
    assert.equal(failed.status, 'failed');
    assert.equal(failed.routes, undefined, 'Failed routes must not be invented');
    const assembly = readFileSync(join(directory, 'replay/0000.dll'));
    assert.equal(conversionDigest(assembly), failed.assemblySha256);
    const vm = new CilVirtualMachine(assembly, {nativeIntBits: 32});
    try {
      vm.run();
      assert.equal(vm.state, 'terminated');
      assert.equal(vm.output.join(''), '2147483647\n', 'Retained DLL is executable CIL for the original operand');
    } finally { vm.stop(); }

    const expected = {bits: 32, sdk: '10.0.201'};
    writeJson(join(directory, 'qualification.json'), {
      format: 'SharpForge.NativeConversionQualification/1', status: 'failed', expected, error: failed.error
    });
    const paths = ['qualification.json', ...['cs', 'dll', 'txt', 'json'].map(extension => 'replay/0000.' + extension)];
    const inventory = paths.map(path => {
      const bytes = readFileSync(join(directory, path));
      return {path, bytes: bytes.length, sha256: conversionDigest(bytes)};
    }).sort((left, right) => left.path.localeCompare(right.path));
    writeJson(join(directory, 'artifacts.json'), inventory);
    const outcome = finalizeConversions({...expected, output: directory});
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.error.message, /Conversion qualification did not complete/);
    assert.deepEqual(readFileSync(join(directory, 'replay/0000.dll')), assembly);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('the pre-execution assembly observer receives a copy without changing any differential route', () => {
  let observations = 0;
  const result = numericDifferential('using System; Console.WriteLine(7);', '7\n', {
    onAssembly(assembly) {
      observations++;
      assert.equal(assembly[0], 0x4d);
      assert.equal(assembly[1], 0x5a);
      assembly.fill(0);
    }
  });
  assert.equal(observations, 1);
  assert.equal(result.compiled.assembly[0], 0x4d);
  assert.deepEqual(Object.keys(result.outputs), ['source', 'reloaded source', 'direct CIL']);
  for (const route of Object.values(result.outputs)) assert(route.instructions > 0);
});
