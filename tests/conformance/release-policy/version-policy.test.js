import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { temporary } from '../../../scripts/conformance/repro/common.js';
import { checkVersions, releaseVersion } from '../../../scripts/conformance/release-policy/versions.js';
import { immutableRevisions } from '../../../scripts/conformance/release-policy/check-policy.js';
import { previewAdmission, languageInventory, verifyPreviewCoverage, repository } from '../../../scripts/conformance/release-policy/data.js';

async function fixture(root, version = '1.2.3', count = 25) {
  await writeFile(join(root, 'package.json'), JSON.stringify({ version, workspaces: ['packages/*'] }));
  await writeFile(join(root, 'CHANGELOG.md'), `# Changelog\n\n## ${version} — 2026-10-03\n\nOwned fixture release.\n`);
  await mkdir(join(root, 'packages'));
  for (let index = 0; index < count; index++) {
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

test('release versions bind every workspace and a nonempty changelog section', async () => {
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

test('release versions admit an additional workspace while retaining its version and cancellation checks', async () => {
  await temporary(async (root) => {
    await fixture(root, '1.2.3-preview.1');
    assert.equal((await checkVersions({ root, tag: 'v1.2.3-preview.1' })).prerelease, true);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(checkVersions({ root, tag: 'v1.2.3-preview.1', signal: controller.signal }), { name: 'AbortError' });
    await mkdir(join(root, 'packages/extra'));
    await writeFile(join(root, 'packages/extra/package.json'), JSON.stringify({ name: '@sharpforge/extra', version: '1.2.3-preview.1' }));
    assert.equal((await checkVersions({ root, tag: 'v1.2.3-preview.1' })).packages.length, 26);
    await writeFile(join(root, 'packages/extra/package.json'), JSON.stringify({ name: '@sharpforge/extra', version: '1.2.2' }));
    await assert.rejects(checkVersions({ root, tag: 'v1.2.3-preview.1' }), /Workspace version.*packages\/extra\/package\.json/);
  });
});

test('release versions cover every actual workspace manifest in the current repository', async () => {
  const rootManifest = await readFile(join(repository, 'package.json'));
  const { version } = JSON.parse(rootManifest);
  const entries = await readdir(join(repository, 'packages'), { withFileTypes: true });
  const expected = entries.map(entry => `packages/${entry.name}/package.json`).sort();
  await temporary(async (root) => {
    await fixture(root, version, 0);
    await writeFile(join(root, 'package.json'), rootManifest);
    for (const entry of entries) {
      assert(entry.isDirectory() && !entry.isSymbolicLink(), entry.name);
      await mkdir(join(root, 'packages', entry.name));
      const path = `packages/${entry.name}/package.json`;
      await writeFile(join(root, path), await readFile(join(repository, path)));
    }
    const result = await checkVersions({ root, tag: `v${version}` });
    assert.deepEqual(result.packages.map(pkg => pkg.path).sort(), expected);
    const last = expected.at(-1);
    const manifest = JSON.parse(await readFile(join(root, last)));
    await writeFile(join(root, last), JSON.stringify({ ...manifest, version: '0.0.0-mismatch' }));
    await assert.rejects(checkVersions({ root, tag: `v${version}` }), /Workspace version differs from tag/);
  });
});

test('release versions accept a single workspace but reject an empty inventory', async () => {
  await temporary(async (root) => {
    await fixture(root, '1.2.3', 1);
    assert.deepEqual((await checkVersions({ root, tag: 'v1.2.3' })).packages.map(pkg => pkg.path), ['packages/fixture-0/package.json']);
    await rm(join(root, 'packages/fixture-0'), { recursive: true });
    await assert.rejects(checkVersions({ root, tag: 'v1.2.3' }), /at least one workspace package/);
  });
});

test('release workspace discovery cannot omit invalid package entries', async () => {
  const manifest = 'packages/fixture-0/package.json';
  const cases = [
    ['missing manifest', root => rm(join(root, manifest)), /ENOENT/],
    ['malformed manifest', root => writeFile(join(root, manifest), '{'), SyntaxError],
    ['invalid name', root => writeFile(join(root, manifest), JSON.stringify({ name: '@other/fixture-0', version: '1.2.3' })), /Invalid workspace name/],
    ['duplicate name', root => writeFile(join(root, manifest), JSON.stringify({ name: '@sharpforge/fixture-1', version: '1.2.3' })), /Invalid workspace name/],
    ['non-directory', root => writeFile(join(root, 'packages/unlisted'), 'unexpected'), /real package directory/],
    ['symlink', root => symlink(join(root, 'packages/fixture-0'), join(root, 'packages/linked'), process.platform === 'win32' ? 'junction' : 'dir'), /real package directory/],
  ];
  for (const [name, mutate, expected] of cases) {
    await temporary(async (root) => {
      await fixture(root, '1.2.3', 2);
      await mutate(root);
      await assert.rejects(checkVersions({ root, tag: 'v1.2.3' }), expected, name);
    });
  }
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
