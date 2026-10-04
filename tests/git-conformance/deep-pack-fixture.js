import assert from 'node:assert/strict';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Deterministic incompressible base with small cumulative revisions, never a generated PACK. */
export function revisionBytes(length = 32768) {
  const bytes = Buffer.alloc(length);
  let state = 0x73a25d1e;
  for (let index = 0; index < bytes.length; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 255;
  }
  return bytes;
}

function importStream() {
  const chunks = [];
  const bytes = revisionBytes();
  for (let version = 0; version <= 50; version++) {
    if (version) bytes[version * 509] ^= 0x5a;
    chunks.push(Buffer.from(`blob\nmark :${version + 1}\ndata ${bytes.length}\n`), Buffer.from(bytes), Buffer.from('\n'));
  }
  const message = 'Native depth-50 fixture\n';
  chunks.push(Buffer.from('commit refs/heads/main\ncommitter Fixture <fixture@example.test> 1700000000 +0000\n' +
    `data ${Buffer.byteLength(message)}\n${message}`));
  for (let version = 0; version <= 50; version++) {
    chunks.push(Buffer.from(`M 100644 :${version + 1} version-${String(version).padStart(2, '0')}.bin\n`));
  }
  chunks.push(Buffer.from('\ndone\n'));
  return Buffer.concat(chunks);
}

/** Git fast-import deltifies each blob against its predecessor; verify-pack is the independent depth oracle.
 * Contract: https://git-scm.com/docs/git-fast-import#_packfile_optimization
 * Output fields: https://git-scm.com/docs/git-verify-pack#_output_format
 */
export async function createDeepPackFixture(workspace, algorithm) {
  const directory = join(workspace.root, algorithm + '-deep');
  await mkdir(directory);
  const git = (args, options = {}) => workspace.git(args, { cwd: directory, ...options });
  await git(['init', '-q', '--bare', '--initial-branch=main', `--object-format=${algorithm}`]);
  await git(['-c', 'fastimport.unpackLimit=0', 'fast-import', '--quiet', '--depth=50', '--done'], { input: importStream() });
  const packDirectory = join(directory, 'objects', 'pack');
  const packNames = (await readdir(packDirectory)).filter(name => name.endsWith('.pack'));
  assert.equal(packNames.length, 1, 'Native fast-import must retain exactly one fixture pack');
  const packPath = join(packDirectory, packNames[0]);
  const indexPath = packPath.slice(0, -5) + '.idx';
  const verified = await git(['verify-pack', '-v', indexPath]);
  const entries = verified.text.split('\n').flatMap(line => {
    const fields = line.trim().split(/\s+/);
    if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(fields[0])) return [];
    return [{ oid: fields[0], type: fields[1], offset: Number(fields[4]), depth: fields[5] ? Number(fields[5]) : 0 }];
  });
  assert.equal(entries.length, 53, 'The native fixture has 51 blobs, one tree and one commit');
  assert.equal(Math.max(...entries.map(entry => entry.depth)), 50, 'The native fixture must actually contain depth 50');
  assert.equal(entries.filter(entry => entry.depth === 50).length, 1);
  return { directory, git, entries, pack: new Uint8Array(await readFile(packPath)), index: new Uint8Array(await readFile(indexPath)) };
}
