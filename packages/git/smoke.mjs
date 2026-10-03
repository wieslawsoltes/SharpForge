import assert from 'node:assert/strict';

/** Package-owned smoke for the published object surface. */
export async function smoke({ api, report }) {
  assert.equal(await api.hashObject('blob', new Uint8Array()), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  const encoded = api.encodeTree([]);
  assert.equal(encoded.length, 0);
  report.git = { surface: 'object-codecs', hash: 'sha1dc' };
}
