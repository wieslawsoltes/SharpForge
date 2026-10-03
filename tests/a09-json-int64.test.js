import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compile, compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';

const directory = new URL('./fixtures/json-int64/', import.meta.url);
const source = readFileSync(new URL('Cases.cs', directory), 'utf8');
const oracle = JSON.parse(readFileSync(new URL('oracle.json', directory), 'utf8'));

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`SF-A09-B02 ${pipeline}/${engine} GetInt64 matches native exact integers and failures`, () => {
      const options = {pipeline, includeDebug: false};
      const compiled = engine === 'source' ? compile(source, options) : compileToIL(source, options);
      assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
      const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, oracle.lines.join('\n') + '\n');
      } finally {
        vm.stop();
      }
    });
  }
}

test('SF-A09-B02 GetInt64 uses the A09 reservation and an actual managed Int64 return', () => {
  const contracts = findContracts('System.Text.Json.JsonElement', 'GetInt64', false);
  assert.equal(contracts.length, 1);
  assert.equal(contracts[0].id, 655360);
  assert.equal(contracts[0].result, 'long');
});

test('SF-A09-B02 Int64 reference pins source bytes, SDK, runtime and precision boundaries', () => {
  assert.equal(oracle.sdk, '10.0.201');
  assert.equal(oracle.runtime, '10.0.5');
  assert.equal(oracle.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.ok(oracle.lines.includes('9007199254740993'));
  assert.ok(oracle.lines.includes('-9223372036854775808'));
  assert.ok(oracle.lines.includes('FormatException'));
  assert.equal(oracle.lines.at(-1), 'ObjectDisposedException');
});
