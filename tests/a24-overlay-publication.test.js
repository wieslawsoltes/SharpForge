import test from 'node:test';
import assert from 'node:assert/strict';
import {OverlayFileSystemProvider, hashFileBytes} from '@sharpforge/workspace';
import {DelayedProvider} from './support/a24-delayed-provider.js';

const bytes = value => new TextEncoder().encode(value);
const text = value => new TextDecoder().decode(value);

class DelayedMutationProvider extends DelayedProvider {
  async writeFile(path, value, options) {
    const result = await super.writeFile(path, value, options);
    await this.waitFor('save', path);
    return result;
  }
  async delete(path, options) {
    const result = await super.delete(path, options);
    await this.waitFor('delete', path);
    return result;
  }
  async rename(from, to, options) {
    const result = await super.rename(from, to, options);
    await this.waitFor('rename', from);
    return result;
  }
}

async function fixture(options) {
  const base = new DelayedMutationProvider();
  await base.writeFile('A.cs', bytes('original'));
  return {base, overlay: new OverlayFileSystemProvider(base, options)};
}

for (const action of ['replace', 'discard', 'abort', 'dispose']) {
  test(`A24 delayed overlay admission rejects ${action} without republishing stale bytes`, async () => {
    const {base, overlay} = await fixture();
    const gate = base.pause('read');
    const controller = new AbortController();
    const pending = overlay.setBuffer('A.cs', 'stale', {signal: controller.signal});
    await gate.entered;
    if (action === 'replace') await overlay.setBuffer('A.cs', 'newest');
    else if (action === 'discard') overlay.discard('A.cs');
    else if (action === 'abort') controller.abort();
    else overlay.dispose();
    gate.release();
    await assert.rejects(pending, error => action === 'abort' ? error.name === 'AbortError'
      : error.code === (action === 'dispose' ? 'Disposed' : 'Conflict'));
    assert.equal(overlay.usedBytes, action === 'replace' ? 6 : 0);
    assert.equal(overlay.buffers.get('a.cs')?.record.text, action === 'replace' ? 'newest' : undefined);
    assert.equal(overlay.publications.size, 0);
    overlay.dispose();
    base.dispose();
  });
}

test('A24 concurrent generated publication enforces the final shared byte budget', async () => {
  const {base, overlay} = await fixture({maxOverlayBytes: 4});
  const results = await Promise.allSettled([
    overlay.setGenerated('generated://one', 'aaaa'), overlay.setGenerated('generated://two', 'bbbb')
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'QuotaExceeded');
  assert.equal(overlay.usedBytes, 4);
  assert.equal(overlay.generated.size, 1);
  overlay.dispose();
  base.dispose();
});

test('A24 later same-URI generated intent wins without duplicate byte accounting', async () => {
  const {base, overlay} = await fixture();
  const results = await Promise.allSettled([
    overlay.setGenerated('generated://one', 'old'), overlay.setGenerated('generated://one', 'newest')
  ]);
  assert.equal(results[0].reason.code, 'Conflict');
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(text(await overlay.readFile('generated://one')), 'newest');
  assert.equal(overlay.usedBytes, 6);
  const pending = overlay.setGenerated('generated://two', 'discarded');
  overlay.dispose();
  await assert.rejects(pending, error => error.code === 'Disposed');
  assert.equal(overlay.generated.size, 0);
  assert.equal(overlay.usedBytes, 0);
  base.dispose();
});

for (const action of ['discard', 'replace', 'dispose']) {
  test(`A24 completed save remains successful after concurrent overlay ${action}`, async () => {
    const {base, overlay} = await fixture();
    await overlay.setBuffer('A.cs', 'saved');
    const gate = base.pause('save');
    const pending = overlay.save('A.cs');
    await gate.entered;
    if (action === 'discard') overlay.discard('A.cs');
    else if (action === 'replace') await overlay.setBuffer('A.cs', 'newer edit');
    else overlay.dispose();
    gate.release();
    assert.equal((await pending).hash, await hashFileBytes(bytes('saved')));
    assert.equal(text(await base.readFile('A.cs')), 'saved');
    if (action === 'replace') {
      assert.equal(text(await overlay.readFile('A.cs')), 'newer edit');
      await overlay.save('A.cs');
      assert.equal(text(await base.readFile('A.cs')), 'newer edit');
    }
    assert.equal(overlay.usedBytes, 0);
    overlay.dispose();
    base.dispose();
  });
}

test('A24 delete preserves a newer dirty buffer written while physical deletion finishes', async () => {
  const {base, overlay} = await fixture();
  await overlay.setBuffer('A.cs', 'first edit');
  const gate = base.pause('delete');
  const pending = overlay.delete('A.cs', {discardDirty: true});
  await gate.entered;
  await overlay.setBuffer('A.cs', 'newer edit');
  gate.release();
  await pending;
  assert.equal(text(await overlay.readFile('A.cs')), 'newer edit');
  await assert.rejects(base.readFile('A.cs'), error => error.code === 'NotFound');
  overlay.dispose();
  base.dispose();
});

test('A24 rename carries the newest buffer and does not overwrite a concurrent destination buffer', async () => {
  for (const collision of [false, true]) {
    const {base, overlay} = await fixture();
    await overlay.setBuffer('A.cs', 'first edit');
    const gate = base.pause('rename');
    const pending = overlay.rename('A.cs', 'B.cs');
    await gate.entered;
    await overlay.setBuffer('A.cs', 'newer edit');
    if (collision) await overlay.setBuffer('B.cs', 'destination edit');
    gate.release();
    if (collision) {
      await assert.rejects(pending, error => error.code === 'Conflict' && /Disk rename completed/.test(error.message));
      assert.equal(text(await overlay.readFile('A.cs')), 'newer edit');
      assert.equal(text(await overlay.readFile('B.cs')), 'destination edit');
    } else {
      await pending;
      await assert.rejects(overlay.readFile('A.cs'), error => error.code === 'NotFound');
      assert.equal(text(await overlay.readFile('B.cs')), 'newer edit');
      assert.equal(overlay.usedBytes, 10);
    }
    overlay.dispose();
    base.dispose();
  }
});
