import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryFileSystemProvider, OverlayFileSystemProvider} from '@sharpforge/workspace';

const bytes = value => new TextEncoder().encode(value);

test('A24 overlay keeps dirty buffers consistent and generated URIs read-only', async () => {
  const base = new MemoryFileSystemProvider();
  await base.writeFile('a.cs', bytes('old'));
  const overlay = new OverlayFileSystemProvider(base);
  await overlay.setBuffer('a.cs', 'dirty');
  assert.equal(new TextDecoder().decode(await overlay.readFile('a.cs')), 'dirty');
  assert.equal(new TextDecoder().decode(await base.readFile('a.cs')), 'old');
  await overlay.save('a.cs');
  assert.equal(new TextDecoder().decode(await base.readFile('a.cs')), 'dirty');
  await overlay.setBuffer('a.cs', 'user text');
  await base.writeFile('a.cs', bytes('external'));
  await assert.rejects(overlay.save('a.cs'), error => error.code === 'Conflict');
  assert.equal(new TextDecoder().decode(await overlay.readFile('a.cs')), 'user text');
  await overlay.setGenerated('generated://source/a.cs', 'generated');
  assert.equal(new TextDecoder().decode(await overlay.readFile('generated://source/a.cs')), 'generated');
  await assert.rejects(overlay.writeFile('generated://source/a.cs', bytes('x')), error => error.code === 'ReadOnly');
  await overlay.writeFile('new.cs', bytes('new'));
  assert((await overlay.readDirectory('')).some(entry => entry.name === 'new.cs'));
  await overlay.save('new.cs');
  assert.equal(new TextDecoder().decode(await base.readFile('new.cs')), 'new');
});
