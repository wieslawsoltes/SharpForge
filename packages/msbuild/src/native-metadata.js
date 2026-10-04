import { open } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectMetadataReference } from '@sharpforge/compiler';

/** Read only the assembly paths returned by an authorized design-time context; never accept arbitrary host files. */
export class NativeMetadataReferenceService {
  constructor(designTime, { maxReferences = 512, maxFileBytes = 8388608, maxTotalBytes = 33554432 } = {}) {
    for (const value of [maxReferences, maxFileBytes, maxTotalBytes]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Invalid native metadata limit');
    }
    Object.assign(this, { designTime, maxReferences, maxFileBytes, maxTotalBytes });
  }

  async read(request, options = {}) {
    const { context } = await this.designTime.context(request, options);
    const available = new Map(context.references.map(reference => [reference.path, reference]));
    const requested = request.references ?? [...available.keys()];
    if (!Array.isArray(requested) || requested.length > this.maxReferences || requested.some(path => typeof path !== 'string')) {
      throw new RangeError('Invalid native metadata reference selection or count');
    }
    const selected = [...new Set(requested)];
    for (const path of selected) {
      if (!available.has(path)) throw Object.assign(new Error('Reference is not part of the selected project context'),
        { code: 'SFMSB_METADATA_REFERENCE', status: 403, path });
    }
    let totalBytes = 0;
    const references = [];
    for (const path of selected) {
      options.signal?.throwIfAborted();
      await this.designTime.engine.authorize(request);
      const absolute = resolve(this.designTime.engine.workspace.root, dirname(context.project), path);
      const file = await open(absolute, 'r');
      try {
        const before = await file.stat();
        if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size > this.maxFileBytes
          || totalBytes + before.size > this.maxTotalBytes) {
          throw Object.assign(new Error('Native metadata reference byte limit exceeded'), { code: 'SFMSB_METADATA_LIMIT', path });
        }
        // Allocate once from the admitted stat size. A file growing during this read cannot exceed the budget.
        const bytes = Buffer.alloc(before.size);
        let offset = 0;
        while (offset < bytes.length) {
          options.signal?.throwIfAborted();
          const { bytesRead } = await file.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        options.signal?.throwIfAborted();
        const after = await file.stat();
        if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
          throw Object.assign(new Error('Native metadata reference changed while reading'), { code: 'Conflict', status: 409, path });
        }
        let identity;
        try { identity = inspectMetadataReference(bytes); }
        catch (error) {
          throw Object.assign(new Error('Invalid native metadata reference: ' + error.message), { code: 'SFMSB_METADATA_INVALID', path });
        }
        totalBytes += bytes.length;
        references.push({ path, display: basename(path), aliases: available.get(path).aliases,
          base64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, identity });
      } finally {
        await file.close();
      }
    }
    return { contextId: context.id, references, totalBytes };
  }
}
