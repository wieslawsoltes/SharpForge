import test from 'node:test';
import assert from 'node:assert/strict';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { manifestImage, openManifest, binaryResource } from './clr-manifest-fixtures.js';

const failure = expected => error => error.code === expected;
const image = hashValue => manifestImage('HashLength', { hashAlgorithm: 0x800e,
  files: [{ name: 'payload.bin', bytes: binaryResource, ...(hashValue ? { hashValue } : {}) }],
  resources: [{ name: 'payload', file: 0 }],
});

test('File hashes admit exact SHA-512 length and reject malformed boundary lengths before requesting bytes', async () => {
  const valid = await openManifest(image(), { fileProvider: () => binaryResource });
  try {
    assert.deepEqual(valid.reader.names, ['payload']);
    assert.deepEqual(await valid.reader.read('payload'), binaryResource);
  } finally { valid.reader.dispose(); }
  for (const length of [63, 65]) {
    let requests = 0;
    const { reader } = await openManifest(image(new Uint8Array(length)), {
      fileProvider: () => { requests++; return binaryResource; },
    });
    try {
      assert.throws(() => reader.names, failure(LoadErrorCode.InvalidImage), `hash length ${length}`);
      await assert.rejects(reader.read('payload'), failure(LoadErrorCode.InvalidImage));
      await assert.rejects(reader.getInfo('payload'), failure(LoadErrorCode.InvalidImage));
      assert.equal(requests, 0, 'Malformed hash metadata must not request a file');
    } finally { reader.dispose(); }
  }
});

test('File hash admission preserves explicit metadata budgets and pre-aborted operation diagnostics', async () => {
  const limited = await openManifest(image(), { maxNameBytes: 6 });
  try {
    assert.throws(() => limited.reader.names, failure(LoadErrorCode.LimitExceeded));
  } finally { limited.reader.dispose(); }
  const { reader } = await openManifest(image());
  const signal = AbortSignal.abort();
  try {
    assert.throws(() => reader.getNames({ signal }), failure(LoadErrorCode.Cancelled));
    await assert.rejects(reader.read('payload', { signal }), failure(LoadErrorCode.Cancelled));
    await assert.rejects(reader.getInfo('payload', { signal }), failure(LoadErrorCode.Cancelled));
  } finally { reader.dispose(); }
});
