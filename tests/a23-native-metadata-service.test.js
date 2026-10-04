import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { NativeMetadataReferenceService } from '@sharpforge/msbuild/node';

test('native metadata reads require an authorized context reference and enforce file/count/total budgets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sf-metadata-budget-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = await readFile(new URL('fixtures/metadata/VersionedLib.1.0.0.0.dll', import.meta.url));
  await writeFile(join(root, 'Library.dll'), bytes);
  await writeFile(join(root, 'Malformed.dll'), 'invalid');
  let authorized = 0;
  const context = { id: 'context', project: 'App.csproj', references: [{ path: 'Library.dll' }, { path: 'Malformed.dll' }] };
  const designTime = { async context(request) {
    assert.equal(request.trusted, true);
    return { context };
  }, engine: { workspace: { root }, async authorize() { authorized++; } } };
  const service = new NativeMetadataReferenceService(designTime);
  const request = { trusted: true, references: ['Library.dll'] };
  const result = await service.read(request);
  assert.equal(result.contextId, 'context');
  assert.deepEqual(Buffer.from(result.references[0].base64, 'base64'), bytes);
  assert.equal(result.references[0].sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(authorized, 1);
  await assert.rejects(service.read({ ...request, references: [join(root, 'Library.dll')] }), { code: 'SFMSB_METADATA_REFERENCE' });
  await assert.rejects(service.read({ ...request, references: ['Malformed.dll'] }), { code: 'SFMSB_METADATA_INVALID' });
  await assert.rejects(new NativeMetadataReferenceService(designTime, { maxFileBytes: 1 }).read(request), { code: 'SFMSB_METADATA_LIMIT' });
  await assert.rejects(new NativeMetadataReferenceService(designTime, { maxTotalBytes: 1 }).read(request), { code: 'SFMSB_METADATA_LIMIT' });
  await assert.rejects(new NativeMetadataReferenceService(designTime, { maxReferences: 1 }).read({ ...request, references: ['Library.dll', 'Malformed.dll'] }),
    /count/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(service.read(request, { signal: controller.signal }), { name: 'AbortError' });
});
