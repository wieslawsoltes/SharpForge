import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createMetadataVerificationTypeSystem as create } from '@sharpforge/cil';
import { nativeCategoryInput } from './fixtures/a03-type-categories/native-input.js';

test('real pinned core-module metadata and local class/value/enum/interface categories agree with CoreCLR', () => {
  const capture = JSON.parse(readFileSync(new URL('./fixtures/a03-type-categories/native.json', import.meta.url), 'utf8'));
  assert.equal(capture.execution.exitCode, 0);
  assert.equal(capture.execution.signal, null);
  assert.equal(capture.comparisons.fullInspectorAndOwnedReplay, true);
  const bytes = gunzipSync(Buffer.from(capture.coreMetadata, 'base64'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), capture.coreMetadataSHA256);
  const prepared = nativeCategoryInput(capture);
  const core = create(prepared.coreInspector, { coreTypes: prepared.coreAuthority });
  const local = create(prepared.inspector, { coreTypes: prepared.coreTypes });
  for (const [adapter, observations] of [[core, prepared.native.coreTypes], [local, prepared.native.localTypes]]) {
    for (const observed of observations)
      assert.deepEqual(adapter.typeCategory(adapter.resolveType(observed.token).value),
        { status: 'known', value: observed.category }, observed.name);
  }
  assert.equal(prepared.native.runtime, capture.toolchain.runtime);
  assert.deepEqual([capture.comparisons.core, capture.comparisons.local], [7, 7]);
});
