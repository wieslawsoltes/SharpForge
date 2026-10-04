import {MemoryFileSystemProvider} from '@sharpforge/workspace';

function barrier() {
  const entered = Promise.withResolvers();
  const released = Promise.withResolvers();
  return {
    entered: entered.promise,
    release: released.resolve,
    reject: released.reject,
    wait() {
      entered.resolve();
      return released.promise;
    }
  };
}

/** Finish an already-started read after its caller changes the workspace or aborts. */
export class DelayedProvider extends MemoryFileSystemProvider {
  constructor() {
    super({caseSensitive: false});
    this.gates = new Map();
    this.reads = 0;
    this.handleReads = 0;
  }

  pause(phase, path = 'A.cs') {
    const gate = barrier();
    this.gates.set(phase + ':' + path, gate);
    return gate;
  }

  async waitFor(phase, path) {
    const key = phase + ':' + path;
    const gate = this.gates.get(key);
    if (!gate) return;
    this.gates.delete(key);
    await gate.wait();
  }

  async readFile(path, options) {
    const result = await super.readFile(path, options);
    this.reads++;
    await this.waitFor('read', path);
    return result;
  }

  async fileHandle(path, options) {
    const handle = this.find(this.check(path, options));
    this.handleReads++;
    await this.waitFor('handle', path);
    return handle;
  }

  async stat(path, options) {
    const metadata = await super.stat(path, options);
    await this.waitFor('stat', path);
    return metadata;
  }
}
