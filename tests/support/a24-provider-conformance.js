import assert from 'node:assert/strict';
import {hashFileBytes} from '@sharpforge/workspace';

const bytes = value => new TextEncoder().encode(value);

/** Shared byte, path, mutation, cancellation and lifecycle checks for complete provider implementations. */
export async function assertProviderConformance(provider) {
  assert.equal((await provider.stat('')).type, 'directory');
  await provider.createDirectory('src');
  assert.equal((await provider.stat('src')).type, 'directory');
  const original = Uint8Array.of(0, 255, 13, 10, 128, 1);
  const written = await provider.writeFile('src/opaque.bin', original, {expectedHash: null});
  assert.equal(written.hash, await hashFileBytes(original));
  original[0] = 10;
  assert.equal((await provider.readFile('src/opaque.bin'))[0], 0);
  const read = await provider.readFile('src/opaque.bin');
  read[1] = 0;
  assert.equal((await provider.readFile('src/opaque.bin'))[1], 255);
  assert.equal((await provider.readDirectory('src')).length, 1);
  await assert.rejects(provider.writeFile('src/opaque.bin', bytes('wrong'), {expectedHash: null}), error => error.code === 'Conflict');
  await assert.rejects(provider.writeFile('src/opaque.bin', bytes('wrong'), {overwrite: false}), error => error.code === 'AlreadyExists');
  await assert.rejects(provider.writeFile('missing.bin', bytes('x'), {create: false}), error => error.code === 'NotFound');
  await assert.rejects(provider.readFile('missing.bin'), error => error.code === 'NotFound');
  await assert.rejects(provider.delete('src'), error => error.code === 'DirectoryNotEmpty');
  await provider.rename('src/opaque.bin', 'src/moved.bin', {expectedHash: written.hash});
  await assert.rejects(provider.readFile('src/opaque.bin'), error => error.code === 'NotFound');
  assert.deepEqual(await provider.readFile('src/moved.bin'), Uint8Array.of(0, 255, 13, 10, 128, 1));
  await provider.writeFile('src/empty.txt', new Uint8Array());
  assert.equal((await provider.readFile('src/empty.txt')).length, 0);
  await provider.delete('src', {recursive: true});
  assert.equal((await provider.readDirectory('')).length, 0);
  for (const path of ['../outside', '/outside', 'C:\\outside', 'con.txt', 'a/../b']) {
    await assert.rejects(provider.writeFile(path, bytes('x')), error => error.code === 'InvalidPath');
  }
  const controller = new AbortController();
  controller.abort();
  for (const action of [() => provider.stat('', {signal: controller.signal}),
    () => provider.writeFile('cancelled.txt', bytes('x'), {signal: controller.signal}),
    () => provider.createDirectory('cancelled', {signal: controller.signal})]) {
    await assert.rejects(action, error => error.name === 'AbortError');
  }
  provider.dispose();
  await assert.rejects(provider.stat(''), error => error.code === 'Disposed');
}
