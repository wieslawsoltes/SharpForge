import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileToIL } from '@sharpforge/compiler';
import { readManagedResources, readPE } from '@sharpforge/cil';

const evidence = JSON.parse(readFileSync(new URL('./fixtures/a03-managed-resources/native.json', import.meta.url), 'utf8'));
const managedResources = [
  { name: 'public.binary', bytes: Uint8Array.from({ length: 256 }, (_, index) => index) },
  { name: 'private.空', bytes: new TextEncoder().encode('embedded\0resource'), visibility: 'private' },
  { name: 'empty', bytes: new Uint8Array() },
];

test('A03 resource fixture records native GetManifestResourceStream observations', () => {
  assert.match(evidence.runtime, /^\.NET /);
  assert.equal(evidence.observations.length, 4);
  assert(evidence.observations.some(observation => observation.execution === 'passed'));
  for (const observation of evidence.observations) {
    const result = compileToIL('public class ResourceContainer {}', {
      name: `ResourceFixture_${observation.platform}`, outputKind: 'library',
      platform: observation.platform, portablePdb: false, managedResources,
    });
    assert(result.success, JSON.stringify(result.diagnostics));
    const resources = readManagedResources(readPE(result.assembly), { includeBytes: true });
    assert.deepEqual(resources.map(({ name, flags, offset }) => ({ name, flags, offset })), observation.resources);
    if (observation.execution === 'unsupported-host') {
      assert.deepEqual(observation.payloads, []);
      continue;
    }
    assert.equal(observation.execution, 'passed');
    assert.deepEqual(resources.map(({ name, bytes }) => ({ name, bytes: Buffer.from(bytes).toString('base64') })), observation.payloads);
  }
});
