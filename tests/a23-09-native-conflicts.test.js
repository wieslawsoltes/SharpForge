import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeWorkspace} from '../packages/msbuild/src/workspace.js';
import {applyProjectEdit} from '../packages/msbuild/src/project-edits/conflicts.js';

for (const timing of ['before-read', 'before-save']) {
  test(`A23 T09.4 real external write ${timing} preserves disk bytes and returns both hashes`, async context => {
    const root = await mkdtemp(join(tmpdir(), 'sharpforge-edit-conflict-'));
    context.after(() => rm(root, {recursive: true, force: true}));
    const path = join(root, 'App.csproj');
    const original = '<Project><PropertyGroup><Nullable>disable</Nullable></PropertyGroup></Project>';
    const external = '<Project><!-- external writer --></Project>';
    await writeFile(path, original);
    const workspace = await NativeWorkspace.open(root);
    const base = await workspace.read('App.csproj');
    if (timing === 'before-read') await writeFile(path, external);
    const writer = timing === 'before-save' ? {
      read: relative => workspace.read(relative),
      save: async writes => { await writeFile(path, external); return workspace.save(writes); }
    } : workspace;
    const result = await applyProjectEdit(writer, {path: 'App.csproj', baseText: base.text,
      expectedHash: base.hash, text: original.replace('disable', 'enable')});
    assert.equal(result.applied, false);
    assert.equal(result.expectedHash, base.hash);
    assert.notEqual(result.actualHash, base.hash);
    assert.equal(result.actualHash, (await workspace.read('App.csproj')).hash);
    assert.equal(result.conflict.remote, external);
    assert.equal(await readFile(path, 'utf8'), external);
  });
}
