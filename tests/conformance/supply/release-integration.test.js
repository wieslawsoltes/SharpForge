import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { temporary, run } from '../../../scripts/conformance/repro/common.js';
import { packageRelease } from '../../../scripts/conformance/repro/package-release.js';
import { releaseSubjects } from '../../../scripts/conformance/supply/attestation.js';
import { needsOrigin } from '../../../scripts/conformance/supply/license-gate.js';

const manifestCommand = fileURLToPath(new URL('../../../scripts/conformance/source-manifest.js', import.meta.url));
const epoch = 1767225601;

async function manifest(root, mode) {
  return run(process.execPath, [manifestCommand, mode], { cwd: root });
}

async function fixture(root) {
  await run('git', ['init'], { cwd: root });
  await run('git', [
    '-c', 'user.name=Release integration fixture',
    '-c', 'user.email=fixture@example.invalid',
    'commit', '--allow-empty', '-m', 'Owned release fixture',
  ], { cwd: root });
  await mkdir(join(root, 'dist'));
  await mkdir(join(root, 'artifacts'));
  await writeFile(join(root, 'dist/main.js'), 'export const owned = 42;');
  await writeFile(join(root, 'artifacts/SharpForge-standalone.html'), '<!doctype html><title>Owned fixture</title>');
  await writeFile(join(root, 'artifacts/SBOM.cdx.json'), '{}');
  await packageRelease({ root, epoch });
  await manifest(root, '--generate');
}

test('combined producer binds dist while publisher verifies the identical signed subject bytes without dist', async () => {
  await temporary(async (root) => {
    await fixture(root);
    const source = JSON.parse(await readFile(join(root, 'artifacts/SOURCE-MANIFEST.json'), 'utf8'));
    assert.equal(source.schemaVersion, 2);
    assert.equal(source.tree.root, 'dist');
    await manifest(root, '--verify');
    const subjects = await releaseSubjects({ root });
    assert.equal(subjects.length, 5);
    assert(subjects.some((subject) => subject.path === 'artifacts/SharpForge-browser.zip'));
    await temporary(async (publisher) => {
      await cp(join(root, '.git'), join(publisher, '.git'), { recursive: true });
      await cp(join(root, 'artifacts'), join(publisher, 'artifacts'), { recursive: true });
      await manifest(publisher, '--verify-payloads');
      assert.deepEqual(await releaseSubjects({ root: publisher }), subjects);
      await assert.rejects(manifest(publisher, '--verify'), /ENOENT/);
      await writeFile(join(publisher, 'artifacts/SharpForge-browser.zip'), 'changed owned payload');
      await assert.rejects(manifest(publisher, '--verify-payloads'), /payload inventory/);
      await assert.rejects(releaseSubjects({ root: publisher }), /payload inventory/);
    });
    await writeFile(join(root, 'dist/main.js'), 'export const owned = 43;');
    await assert.rejects(manifest(root, '--verify'), /Release dist tree differs/);
    await manifest(root, '--verify-payloads');
  });
});

test('artifact-only publisher rejects changed checksums and a missing release payload', async () => {
  await temporary(async (root) => {
    await fixture(root);
    const checksums = await readFile(join(root, 'artifacts/SHA256SUMS'));
    await writeFile(join(root, 'artifacts/SHA256SUMS'), 'changed owned checksums');
    await assert.rejects(manifest(root, '--verify-payloads'), /SHA256SUMS differs/);
    await writeFile(join(root, 'artifacts/SHA256SUMS'), checksums);
    await rm(join(root, 'artifacts/SharpForge-browser.zip'));
    await assert.rejects(manifest(root, '--verify-payloads'), /payload inventory/);
  });
});

test('managed executable assets require explicit license and origin review', () => {
  assert.equal(needsOrigin('examples/managed/Hello.exe'), true);
  assert.equal(needsOrigin('download/Unknown.EXE'), true);
  assert.equal(needsOrigin('examples/managed/Program.cs'), false);
});
