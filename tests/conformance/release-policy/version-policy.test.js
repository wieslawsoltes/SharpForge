import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { temporary } from '../../../scripts/conformance/repro/common.js';
import { checkVersions, releaseVersion } from '../../../scripts/conformance/release-policy/versions.js';
import { immutableRevisions } from '../../../scripts/conformance/release-policy/check-policy.js';
import { previewAdmission, languageInventory, verifyPreviewCoverage } from '../../../scripts/conformance/release-policy/data.js';

async function fixture(root, version = '1.2.3') {
  await writeFile(join(root, 'package.json'), JSON.stringify({ version, workspaces: ['packages/*'] }));
  await writeFile(join(root, 'CHANGELOG.md'), `# Changelog\n\n## ${version} — 2026-10-03\n\nOwned fixture release.\n`);
  for (let index = 0; index < 25; index++) {
    const path = join(root, 'packages', 'fixture-' + index);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'package.json'), JSON.stringify({ name: '@sharpforge/fixture-' + index, version }));
  }
}

test('stable and preview tags use exact semantic versions without implicit promotion', () => {
  assert.equal(releaseVersion('v1.2.3').channel, 'stable');
  assert.equal(releaseVersion('v1.2.3-preview.1').channel, 'preview');
  for (const tag of ['1.2.3', 'v01.2.3', 'v1.2', 'v1.2.3-', 'v1.2.3-preview.01', 'v1.2.3+mutable', 'v' + '9'.repeat(129)]) {
    assert.throws(() => releaseVersion(tag));
  }
});

test('release versions bind every one of the 25 workspaces and a nonempty changelog section', async () => {
  await temporary(async (root) => {
    await fixture(root);
    assert.equal((await checkVersions({ root, tag: 'v1.2.3' })).packages.length, 25);
    const target = join(root, 'packages/fixture-24/package.json');
    const original = await readFile(target);
    await writeFile(target, JSON.stringify({ name: '@sharpforge/fixture-24', version: '1.2.2' }));
    await assert.rejects(checkVersions({ root, tag: 'v1.2.3' }), /Workspace version/);
    await writeFile(target, original);
    await assert.rejects(checkVersions({ root, tag: 'v1.2.4' }), /Root package/);
    for (const text of ['## 1.2.2\nOld', '## 1.2.3\n', '## 1.2.3\nOne\n## 1.2.3\nDuplicate', '## 2.0.0\nNew\n## 1.2.3\nOld']) {
      await writeFile(join(root, 'CHANGELOG.md'), text);
      await assert.rejects(checkVersions({ root, tag: 'v1.2.3' }), /Changelog|changelog/);
    }
  });
});

test('release version boundary and cancellation reject incomplete package sets', async () => {
  await temporary(async (root) => {
    await fixture(root, '1.2.3-preview.1');
    assert.equal((await checkVersions({ root, tag: 'v1.2.3-preview.1' })).prerelease, true);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(checkVersions({ root, tag: 'v1.2.3-preview.1', signal: controller.signal }), { name: 'AbortError' });
    await mkdir(join(root, 'packages/extra'));
    await writeFile(join(root, 'packages/extra/package.json'), JSON.stringify({ name: '@sharpforge/extra', version: '1.2.3-preview.1' }));
    await assert.rejects(checkVersions({ root, tag: 'v1.2.3-preview.1' }), /exactly 25/);
  });
});

test('existing preview specification identities cannot be rewritten or removed even with review', () => {
  const entry = { id: 'csharp-preview-frozen', version: '15-preview', source: 'https://example.invalid/frozen' };
  const before = { schemaVersion: 1, revisions: [entry] };
  immutableRevisions(before, { ...before, revisions: [entry, { id: 'new-stable-id', version: '15' }] });
  assert.throws(() => immutableRevisions(before, { ...before, revisions: [{ ...entry, version: '15' }] }), /immutable/);
  assert.throws(() => immutableRevisions(before, { ...before, revisions: [] }), /immutable/);
  assert.throws(() => immutableRevisions(before, { ...before, revisions: [entry, entry] }), /Duplicate/);
  assert.throws(() => previewAdmission({ preview: false }, 'preview'), /explicit preview/);
});

test('inventory loading supports cancellation without reading or promoting a target', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(languageInventory({ signal: controller.signal }), { name: 'AbortError' });
});

test('shared preview inventory cannot silently add, remove or redefine a projected proposal', () => {
  const row = { id: 'owned', langVersion: 'preview', probeSHA256: 'a'.repeat(64), specRevision: 'owned-preview' };
  verifyPreviewCoverage([row], [row]);
  assert.throws(() => verifyPreviewCoverage([], [row]), /membership/);
  assert.throws(() => verifyPreviewCoverage([row, { ...row, id: 'new' }], [row]), /membership/);
  assert.throws(() => verifyPreviewCoverage([{ ...row, probeSHA256: 'b'.repeat(64) }], [row]), /changed/);
});
