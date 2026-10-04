import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Existing unchanged MIT .NET runtime test resource; no network or native execution is involved. */
export const pinnedPortablePdb = Object.freeze({
  path: 'tests/fixtures/portable-pdb/Documents.pdb',
  bytes: 712,
  sha256: 'fc1f588948504f3ad379af668dbddeab21e0a27f117c66ded6fba61b85d9f701',
  gitBlob: 'ee0a1421085feeebf829e4f3b0ad972cc2e9c22c',
  license: 'MIT',
  provenance: 'tests/fixtures/portable-pdb/README.md',
});

const retainedFiles = Object.freeze([
  pinnedPortablePdb,
  Object.freeze({
    path: 'tests/fixtures/portable-pdb/LICENSE', bytes: 1111,
    sha256: '3139c517c09e23a2839e85318f59d6c3a0d196b98d9dbcc67809de98bfd3831d',
  }),
  Object.freeze({
    path: pinnedPortablePdb.provenance, bytes: 632,
    sha256: '0261a89a60384fab8f1a7ce704356485771dd65c6eaff1260a9acd4775876e66',
  }),
]);

function checkBytes(input, pin) {
  if (!(input instanceof Uint8Array)) throw new TypeError('Pinned fixture must be bytes');
  if (input.length !== pin.bytes) throw new RangeError('Pinned Portable PDB fixture size changed');
  if (createHash('sha256').update(input).digest('hex') !== pin.sha256) throw new Error('Pinned Portable PDB fixture digest changed');
}

/** Verify literal PDB data against both the retained SHA-256 and the documented upstream Git blob identity. */
export function verifyPinnedPortablePdb(input) {
  checkBytes(input, pinnedPortablePdb);
  const blob = createHash('sha1').update(`blob ${input.length}\0`).update(input).digest('hex');
  if (blob !== pinnedPortablePdb.gitBlob) throw new Error('Pinned Portable PDB Git blob identity changed');
}

function readFixedFile(root, pin) {
  const path = join(root, pin.path);
  if (lstatSync(path).isSymbolicLink() || realpathSync(path) !== path) throw new Error('Pinned fixture path contains a symlink');
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size !== pin.bytes) throw new RangeError('Pinned fixture is not the expected bounded regular file');
    const input = new Uint8Array(pin.bytes + 1);
    let length = 0;
    while (length < input.length) {
      const count = readSync(descriptor, input, length, input.length - length, length);
      if (!count) break;
      length += count;
    }
    const bytes = input.subarray(0, length);
    checkBytes(bytes, pin);
    return bytes.slice();
  } finally {
    closeSync(descriptor);
  }
}

/** Read only three fixed, digest-pinned repository files; missing or changed provenance fails closed. */
export function createPinnedPortablePdbSeed() {
  const root = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
  const input = readFixedFile(root, retainedFiles[0]);
  readFixedFile(root, retainedFiles[1]);
  readFixedFile(root, retainedFiles[2]);
  verifyPinnedPortablePdb(input);
  return { name: 'dotnet-documents', input };
}
