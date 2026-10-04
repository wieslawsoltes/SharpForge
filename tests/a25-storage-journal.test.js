import test from 'node:test';
import assert from 'node:assert/strict';
import { GitError } from '../packages/git/src/errors.js';
import { MemoryStore } from '../packages/git/src/memory-odb.js';
import { commitDirectoryJournal, recoverDirectoryJournal } from '../packages/git/src/fs/journal.js';

const encode = text => new TextEncoder().encode(text);

function journalIo({ failWrite } = {}) {
  const store = new MemoryStore();
  return {
    store,
    get: key => store.get(key),
    async set(key, value) { failWrite?.(key, value); await store.set(key, value); },
    async delete(key, { recursive = false } = {}) {
      if (!recursive) return store.delete(key);
      await store.transaction(async tx => {
        await tx.delete(key);
        for (const child of await tx.list(`${key}/`)) await tx.delete(child);
      });
    }
  };
}

test('directory journal restores all original files when publication encounters quota failure', async () => {
  let injected = false;
  const io = journalIo({ failWrite(key) {
    if (key === 'refs/heads/new' && !injected) { injected = true; throw new GitError('Quota', 'Injected full filesystem'); }
  } });
  await io.set('refs/heads/main', encode('before\n'));
  const changes = new Map([['refs/heads/main', encode('after\n')], ['refs/heads/new', encode('new\n')]]);
  await assert.rejects(commitDirectoryJournal(io, changes), { code: 'Quota' });
  assert.deepEqual(await io.get('refs/heads/main'), encode('before\n'));
  assert.equal(await io.get('refs/heads/new'), undefined);
  assert.deepEqual(await io.store.list('.sharpforge-transaction/'), []);
});

test('an interrupted committed journal completes before readers resume', async () => {
  const io = journalIo();
  await io.set('refs/heads/main', encode('before\n'));
  await io.set('.sharpforge-transaction/0', encode('after\n'));
  await io.set('.sharpforge-transaction/manifest', encode(JSON.stringify({ version: 1, state: 'commit',
    changes: [{ key: 'refs/heads/main', before: null, after: 0 }] })));
  await recoverDirectoryJournal(io);
  assert.deepEqual(await io.get('refs/heads/main'), encode('after\n'));
  assert.deepEqual(await io.store.list('.sharpforge-transaction/'), []);
});

test('an interrupted rollback removes newly created files and restores previous versions', async () => {
  const io = journalIo();
  await io.set('new', encode('partially published'));
  await io.set('old', encode('wrong'));
  await io.set('.sharpforge-transaction/0', encode('right'));
  await io.set('.sharpforge-transaction/manifest', encode(JSON.stringify({ version: 1, state: 'revert', changes: [
    { key: 'old', before: 0, after: null }, { key: 'new', before: null, after: null }
  ] })));
  await recoverDirectoryJournal(io);
  assert.equal(await io.get('new'), undefined);
  assert.deepEqual(await io.get('old'), encode('right'));
});

test('corrupt or traversing recovery journals fail explicitly', async () => {
  const io = journalIo();
  await io.set('.sharpforge-transaction/manifest', encode('{invalid'));
  await assert.rejects(recoverDirectoryJournal(io), { code: 'Corrupt' });
  await io.set('.sharpforge-transaction/manifest', encode(JSON.stringify({ version: 1, state: 'commit',
    changes: [{ key: '../outside', before: null, after: null }] })));
  await assert.rejects(recoverDirectoryJournal(io), { code: 'Unsafe' });
  await io.set('untouched', encode('original'));
  await io.set('.sharpforge-transaction/manifest', encode(JSON.stringify({ version: 1, state: 'revert', changes: [
    { key: 'untouched', before: null, after: null }, { key: '.sharpforge-transaction/manifest', before: null, after: null }
  ] })));
  await assert.rejects(recoverDirectoryJournal(io), { code: 'Unsafe' });
  assert.deepEqual(await io.get('untouched'), encode('original'));
});
