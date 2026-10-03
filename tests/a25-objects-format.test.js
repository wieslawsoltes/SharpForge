import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getObjectFormat, detectObjectFormat, advertisedObjectFormat, assertCompatibleObjectFormat, validateObjectId
} from '../packages/git/src/object-format.js';
import { parseObject, serializeObject } from '../packages/git/src/objects/framing.js';

const bytes = value => new TextEncoder().encode(value);

test('object format follows Git configuration and wire defaults', () => {
  assert.equal(detectObjectFormat().name, 'sha1');
  assert.equal(detectObjectFormat({ 'core.repositoryformatversion': 1, 'extensions.objectformat': 'sha256' }).name, 'sha256');
  assert.equal(detectObjectFormat({ core: { repositoryFormatVersion: 1 }, extensions: { objectFormat: 'sha256' } }).name, 'sha256');
  assert.equal(advertisedObjectFormat(['agent=git', 'object-format=sha256']).name, 'sha256');
  assert.equal(advertisedObjectFormat(new Map([['object-format', 'sha256']])).name, 'sha256');
  assert.equal(advertisedObjectFormat().name, 'sha1');
  assert.equal(assertCompatibleObjectFormat('sha256', getObjectFormat('sha256')).oidLength, 64);
  assert.throws(() => assertCompatibleObjectFormat('sha1', 'sha256'), { code: 'Unsupported' });
  assert.throws(() => advertisedObjectFormat(['object-format=sha256', 'object-format=sha1']), { code: 'Corrupt' });
  assert.throws(() => advertisedObjectFormat(['object-format=sha512']), { code: 'Unsupported' });
  assert.throws(() => detectObjectFormat({ 'extensions.objectformat': 'sha256' }), { code: 'Corrupt' });
  assert.throws(() => detectObjectFormat({ 'core.repositoryformatversion': 2 }), { code: 'Unsupported' });
  assert.throws(() => validateObjectId('0'.repeat(64), 'sha256', { allowZero: false }), { code: 'Corrupt' });
});

test('loose framing counts bytes and requires canonical object type and decimal size', () => {
  const data = bytes('Zażółć\0日本語');
  const raw = serializeObject('blob', data);
  assert.deepEqual(parseObject(raw), { type: 'blob', data, size: data.length });
  for (const invalid of ['blob 01\0x', 'blob -1\0', 'blob +0\0', 'blob 0\0x', 'blob 1\0', 'thing 0\0', 'blob 1x\0x']) {
    assert.throws(() => parseObject(bytes(invalid)), { code: 'Corrupt' }, invalid);
  }
  assert.throws(() => parseObject(bytes('blob 99\0'), { maxObjectBytes: 10 }), { code: 'Limit' });
  assert.throws(() => serializeObject('blob', data, { maxObjectBytes: 0 }), { code: 'Limit' });
  assert.throws(() => serializeObject('invalid', new Uint8Array()), { code: 'Corrupt' });
});
