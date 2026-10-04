/** Ordered, disposable filters run before an artifact leaves Studio. A failed filter blocks delivery. */
export function createArtifactFilters() {
  const filters = new Map();
  let closed = false;
  const assertOpen = () => { if (closed) throw new Error('Artifact filters are disposed'); };
  return {
    register(name, filter) {
      assertOpen();
      if (typeof name !== 'string' || !name || typeof filter !== 'function') throw new TypeError('Invalid artifact filter');
      if (filters.has(name)) throw new Error('Duplicate artifact filter: ' + name);
      filters.set(name, filter);
      return () => filters.delete(name);
    },
    async prepare({ name, content, mimeType = 'application/octet-stream', signal }) {
      assertOpen();
      signal?.throwIfAborted();
      if (typeof name !== 'string' || !name) throw new TypeError('An artifact filename is required');
      const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
      let artifact = { name, bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type || mimeType };
      for (const filter of [...filters.values()]) {
        assertOpen();
        signal?.throwIfAborted();
        const result = await filter(Object.freeze({ ...artifact }), { signal });
        if (!result || !(result.bytes instanceof Uint8Array) || typeof result.mimeType !== 'string') {
          throw new TypeError('An artifact filter returned an invalid result');
        }
        artifact = { name, bytes: result.bytes, mimeType: result.mimeType };
      }
      assertOpen();
      signal?.throwIfAborted();
      return artifact;
    },
    dispose() { closed = true; filters.clear(); }
  };
}
