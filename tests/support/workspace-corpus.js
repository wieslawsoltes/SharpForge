import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeWorkspaceFile, encodeWorkspaceFile} from '@sharpforge/archive';

export const corpusRoot = fileURLToPath(new URL('../fixtures/workspace-corpus/', import.meta.url));

export function byteDigest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Read byte-pinned fixture data; assertions deliberately use independently recorded digests. */
export async function loadWorkspaceCorpus() {
  const manifest = JSON.parse(await readFile(join(corpusRoot, 'manifest.json'), 'utf8'));
  return Promise.all(manifest.cases.map(async item => ({
    ...item,
    records: await Promise.all(item.files.map(async file => {
      const bytes = new Uint8Array(await readFile(join(corpusRoot, 'cases', item.id, file.path)));
      if (bytes.length !== file.size || byteDigest(bytes) !== file.sha256) {
        throw new Error(`Workspace fixture changed: ${item.id}/${file.path}`);
      }
      return decodeWorkspaceFile(file.path, bytes);
    })),
  })));
}

/** Materialize only fixture paths into a caller-owned temporary directory. */
export async function materializeCorpus(item, destination) {
  for (const folder of item.folders) await mkdir(join(destination, folder), {recursive: true});
  for (const record of item.records) {
    const pieces = record.path.split('/');
    await mkdir(join(destination, ...pieces.slice(0, -1)), {recursive: true});
    await writeFile(join(destination, ...pieces), encodeWorkspaceFile(record));
  }
}

/** Capture public workspace paths and bytes, excluding the host's private undo journal. */
export async function diskManifest(root) {
  const files = [], folders = [];
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      if (entry.name === '.sharpforge') continue;
      const path = prefix + entry.name;
      if (entry.isDirectory()) {
        folders.push(path);
        await walk(join(directory, entry.name), path + '/');
      } else if (entry.isFile()) {
        const bytes = await readFile(join(directory, entry.name));
        files.push({path, size: bytes.length, sha256: byteDigest(bytes)});
      } else {
        throw new Error('Unexpected non-regular corpus entry: ' + path);
      }
    }
  }
  await walk(root);
  return {files: files.sort((left, right) => left.path.localeCompare(right.path)), folders: folders.sort()};
}
