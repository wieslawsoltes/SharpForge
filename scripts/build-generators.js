import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { safePath } from './planning/lib/paths.js';

/** Run trusted repository build contributions in order, writing only their declared output files. */
export async function runBuildGenerators(generators, { root, destination, signal } = {}) {
  const written = [];
  for (const contribution of generators) {
    signal?.throwIfAborted();
    for (const field of ['source', 'target']) {
      if (safePath(contribution[field]) !== contribution[field]) throw new Error('Invalid build generator ' + field);
    }
    const module = await import(pathToFileURL(resolve(root, contribution.source)).href);
    if (typeof module.generate !== 'function') throw new Error('Build generator must export generate(): ' + contribution.source);
    const content = await module.generate({ root, signal });
    if (typeof content !== 'string' && !(content instanceof Uint8Array)) {
      throw new Error('Build generator must return UTF-8 text or bytes: ' + contribution.source);
    }
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Generated build asset exceeds 4 MiB: ' + contribution.target);
    signal?.throwIfAborted();
    const target = resolve(destination, contribution.target);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    written.push(contribution.target);
  }
  return written;
}
