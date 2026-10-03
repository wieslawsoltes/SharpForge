import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeTree, decodeTree, encodeCommit, decodeCommit, encodeTag, decodeTag,
  encodeLooseObject, decodeLooseObject, formatIdentity, parseIdentity
} from '../packages/git/src/objects.js';

const encoder = new TextEncoder();
const bytes = value => encoder.encode(value);
const oid = 'a'.repeat(40);
const who = 'Example Person <person@example.test> 1234567890 -0730';
const join = (...parts) => new Uint8Array(Buffer.concat(parts));

test('trees preserve all Git modes and sort directories by their implicit slash', () => {
  const entries = [
    { mode: 0o40000, name: 'foo', oid }, { mode: 0o100644, name: 'foo.bar', oid },
    { mode: 0o100755, name: 'executable', oid }, { mode: 0o120000, name: 'link', oid },
    { mode: 0o160000, name: 'submodule', oid }, { mode: 0o100644, name: 'żółw', oid }
  ];
  const encoded = encodeTree(entries);
  const decoded = decodeTree(encoded);
  assert.deepEqual(decoded.map(entry => entry.name), ['executable', 'foo.bar', 'foo', 'link', 'submodule', 'żółw']);
  assert.deepEqual(encodeTree(decoded), encoded);
  assert.equal(decoded.find(entry => entry.name === 'submodule').mode, 0o160000);
  const binary = encodeTree([{ mode: '100644', nameBytes: new Uint8Array([255, 254]), oid }]);
  assert.equal(decodeTree(binary)[0].name, null);
  assert.deepEqual(encodeTree(decodeTree(binary)), binary);
});

test('trees reject traversal, duplicate identities, invalid modes, order and format-width errors', () => {
  const single = name => encodeTree([{ mode: 0o100644, name, oid }]);
  const raw = name => join(bytes(`100644 ${name}\0`), new Uint8Array(20).fill(1));
  for (const name of ['', '.', '..', 'parent/child', 'nul\0name']) {
    assert.throws(() => encodeTree([{ mode: 0o100644, name, oid }]), { code: 'Corrupt' });
    if (!name.includes('\0')) assert.throws(() => decodeTree(raw(name)), { code: 'Corrupt' });
  }
  assert.throws(() => decodeTree(join(single('z'), single('a'))), { code: 'Corrupt' });
  assert.throws(() => decodeTree(join(single('a'), single('a'))), { code: 'Corrupt' });
  assert.throws(() => encodeTree([{ mode: 0o100600, name: 'bad', oid }]), { code: 'Corrupt' });
  assert.throws(() => decodeTree(join(bytes('040000 folder\0'), new Uint8Array(20).fill(1))), { code: 'Corrupt' });
  assert.throws(() => decodeTree(single('a').subarray(0, 12)), { code: 'Corrupt' });
  assert.throws(() => decodeTree(single('a'), { algorithm: 'sha256' }), { code: 'Corrupt' });
  assert.throws(() => encodeTree([{ mode: 0o100644, name: 'abcd', oid }], { maxNameBytes: 3 }), { code: 'Limit' });
  assert.throws(() => decodeTree(single('abcd'), { maxNameBytes: 3 }), { code: 'Limit' });
});

test('signed continued headers, mergetags, extension headers and legacy encodings round-trip exactly', () => {
  const text = `tree ${oid}\nparent ${oid}\nparent ${'b'.repeat(40)}\nauthor ${who}\ncommitter ${who}\n`
    + 'encoding ISO-8859-1\nx-extension first\nx-extension second\n'
    + 'gpgsig -----BEGIN PGP SIGNATURE-----\n \n abcdef\n -----END PGP SIGNATURE-----\n'
    + `mergetag object ${oid}\n type commit\n tag v1\n tagger ${who}\n \n tag message\n\n`;
  const raw = join(bytes(text), new Uint8Array([0x63, 0x61, 0x66, 0xe9, 10]));
  const commit = decodeCommit(raw);
  assert.equal(commit.parents.length, 2);
  assert.equal(commit.encoding, 'ISO-8859-1');
  assert.equal(commit.message, 'café\n');
  assert.equal(commit.headers.filter(header => header.key === 'x-extension').length, 2);
  assert.ok(commit.headers.find(header => header.key === 'gpgsig').value.includes('\n\n'));
  assert.deepEqual(encodeCommit(commit), raw);
  assert.throws(() => encodeCommit({ ...commit, message: 'edited text' }), { code: 'Unsupported' });
  const utf8 = decodeCommit(encodeCommit({ tree: oid, author: who, committer: who, message: 'before' }));
  assert.equal(decodeCommit(encodeCommit({ ...utf8, message: 'after' })).message, 'after');
});

test('annotated tags preserve multiline signed messages and historical tagger omission', () => {
  const raw = bytes(`object ${oid}\ntype commit\ntag v1\ntagger ${who}\n\nrelease\n-----BEGIN PGP SIGNATURE-----\n...\n`);
  assert.deepEqual(encodeTag(decodeTag(raw)), raw);
  const historical = bytes(`object ${oid}\ntype tree\ntag old\n\nold tag\n`);
  assert.deepEqual(encodeTag(decodeTag(historical)), historical);
  assert.equal(parseIdentity(formatIdentity({ name: 'A', email: 'b', timestamp: -1 })).timestamp, -1);
  assert.throws(() => formatIdentity({ name: 'bad\nname', email: 'a', timestamp: 0 }), { code: 'Corrupt' });
  assert.throws(() => decodeCommit(bytes(`tree ${oid}\n\nmissing identities`)), { code: 'Corrupt' });
  assert.throws(() => decodeTag(bytes(`object ${oid}\ntype mystery\ntag v1\n\n`)), { code: 'Corrupt' });
});

test('loose codec verifies IDs and handles SHA-256 object references without truncating IDs', async () => {
  for (const algorithm of ['sha1', 'sha256']) {
    const blob = await decodeLooseObject(await encodeLooseObject('blob', bytes('payload'), { algorithm }), { algorithm });
    assert.equal(blob.oid.length, algorithm === 'sha1' ? 40 : 64);
    const tree = encodeTree([{ mode: 0o100644, name: 'file.txt', oid: blob.oid }], { algorithm });
    const encoded = await encodeLooseObject('tree', tree, { algorithm, backend: 'portable' });
    const decoded = await decodeLooseObject(encoded, { algorithm, backend: 'portable' });
    assert.equal(decodeTree(decoded.data, { algorithm })[0].oid, blob.oid);
    await assert.rejects(decodeLooseObject(encoded, { algorithm, oid: 'f'.repeat(blob.oid.length) }), { code: 'Corrupt' });
    await assert.rejects(encodeLooseObject('blob', bytes('too long'), { maxObjectBytes: 2 }), { code: 'Limit' });
  }
});
