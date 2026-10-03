export class TestDirectory {
  constructor(name = 'Destination', state = null) {
    this.name = name;
    this.kind = 'directory';
    this.children = new Map();
    this.state = state ?? { writes: 0, permissions: 'granted', failAt: -1, removeFailures: new Set() };
  }
  async queryPermission() { return this.state.permissions; }
  async requestPermission() { return this.state.permissions; }
  async *entries() { yield* this.children; }
  async getDirectoryHandle(name, { create = false } = {}) {
    const existing = this.children.get(name);
    if (existing && existing.kind !== 'directory') throw new DOMException('Not a directory', 'TypeMismatchError');
    if (existing) return existing;
    if (!create) throw new DOMException('Missing directory', 'NotFoundError');
    const directory = new TestDirectory(name, this.state);
    this.children.set(name, directory);
    return directory;
  }
  async getFileHandle(name, { create = false } = {}) {
    const existing = this.children.get(name);
    if (existing && existing.kind !== 'file') throw new DOMException('Not a file', 'TypeMismatchError');
    if (existing) return existing;
    if (!create) throw new DOMException('Missing file', 'NotFoundError');
    const file = new TestFile(name, this.state);
    this.children.set(name, file);
    return file;
  }
  async removeEntry(name) {
    if (this.state.removeFailures.has(name)) throw new Error('Injected cleanup failure');
    const child = this.children.get(name);
    if (child?.kind === 'directory' && child.children.size) throw new DOMException('Directory not empty', 'InvalidModificationError');
    this.children.delete(name);
  }
}

class TestFile {
  constructor(name, state) { this.name = name; this.kind = 'file'; this.bytes = new Uint8Array(); this.state = state; this.version = 1; }
  async getFile() { return new File([this.bytes], this.name, { lastModified: this.version }); }
  async createWritable() {
    let pending;
    return {
      write: async bytes => { if (++this.state.writes === this.state.failAt) throw new Error('Injected write failure'); pending = bytes.slice(); },
      close: async () => { this.bytes = pending ?? new Uint8Array(); this.version++; },
      abort: async () => { pending = null; }
    };
  }
}
