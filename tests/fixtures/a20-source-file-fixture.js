const encoder = new TextEncoder();

/** Actual Node File/Blob slicing, with whole-file calls deliberately rejected. */
export class SlicedFile extends File {
  constructor(parts, name, {reads = [], ...options} = {}) {
    super(parts, name, options);
    this.reads = reads;
  }
  async arrayBuffer() { throw new Error('A whole-file arrayBuffer read is forbidden'); }
  async text() { throw new Error('A whole-file text read is forbidden'); }
  slice(start, end) {
    this.reads.push({start, end});
    return super.slice(start, end);
  }
}

/** File System Access handle double: a writable stream appends chunks and publishes only on close. */
export function sourceFileHandle(name, original, {permission, failWrite = false} = {}) {
  let bytes = typeof original === 'string' ? encoder.encode(original) : original.slice();
  const reads = [];
  const metrics = {opened: 0, written: 0, aborted: 0, chunks: 0, maximumChunkBytes: 0};
  const handle = {
    name, kind: 'file', reads, metrics,
    get bytes() { return bytes; },
    setExternal(content) { bytes = typeof content === 'string' ? encoder.encode(content) : content.slice(); },
    async getFile() { return new SlicedFile([bytes], name, {reads}); },
    async queryPermission() { return permission ? permission(handle) : 'granted'; },
    async createWritable() {
      metrics.opened++;
      const chunks = [];
      return {
        async write(value) {
          if (failWrite) throw new Error('write unavailable');
          const chunk = typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value);
          chunks.push(chunk.slice());
          metrics.chunks++;
          metrics.maximumChunkBytes = Math.max(metrics.maximumChunkBytes, chunk.byteLength);
        },
        async close() {
          bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          metrics.written++;
        },
        async abort() { metrics.aborted++; }
      };
    }
  };
  return handle;
}

export function sourceDirectory(files) {
  return {name: 'Prepared sources', kind: 'directory', async *entries() { yield* Object.entries(files); }};
}
