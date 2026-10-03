import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {releaseManifest, verifyManifest} from '../../scripts/conformance/source-manifest.js';

test('release inventory verifies exact bytes and fails changed, missing or added payloads', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sf-release-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await assert.rejects(releaseManifest(root, 'fixture'), /No release/);
  await writeFile(join(root, 'payload.tgz'), Buffer.from([0, 255, 42]));
  const manifest = await releaseManifest(root, 'fixture');
  await verifyManifest(root, manifest);
  await writeFile(join(root, 'payload.tgz'), Buffer.from([0, 255, 43]));
  await assert.rejects(verifyManifest(root, manifest), /differs/);
  await writeFile(join(root, 'payload.tgz'), Buffer.from([0, 255, 42]));
  await writeFile(join(root, 'extra.html'), 'unexpected');
  await assert.rejects(verifyManifest(root, manifest), /differs/);
  await rm(join(root, 'payload.tgz'));
  await assert.rejects(verifyManifest(root, manifest), /differs/);
});
