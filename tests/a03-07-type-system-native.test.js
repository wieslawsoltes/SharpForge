import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AssemblyInspector, createMetadataVerificationTypeSystem } from '@sharpforge/cil';

const capture = JSON.parse(readFileSync(new URL('./fixtures/a03-verifier-types/native.json', import.meta.url), 'utf8'));

test('resolved metadata relations agree with retained CoreCLR reflection; external dependencies remain unknown', () => {
  assert.equal(capture.execution.exitCode, 0);
  assert.equal(capture.execution.signal, null);
  const native = JSON.parse(capture.execution.stdout);
  const adapter = createMetadataVerificationTypeSystem(new AssemblyInspector(Buffer.from(capture.assembly, 'base64')));
  const counts = { true: 0, false: 0, unknown: 0 };
  for (const pair of native.pairs) {
    const result = adapter.isAssignable(adapter.resolveType(pair.source).value, adapter.resolveType(pair.target).value);
    if (result.status === 'unknown') counts.unknown++;
    else {
      assert.equal(result.value, pair.assignable, JSON.stringify(pair));
      counts[String(result.value)]++;
    }
  }
  assert(counts.true > 0 && counts.false > 0 && counts.unknown > 0);
  for (const type of native.types.filter(type => type.baseToken !== null)) {
    assert.equal(adapter.baseType(adapter.resolveType(type.token).value).value.token, type.baseToken);
  }
});
