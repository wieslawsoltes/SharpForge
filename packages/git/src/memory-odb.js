import { ObjectDatabase } from './odb.js';
import { MemoryStore } from './storage/memory-store.js';

/** Isolated, dependency-free ODB for tests, ephemeral repositories and previews. */
export class MemoryObjectDatabase extends ObjectDatabase {
  constructor(options = {}) {
    super({ ...options, store: options.store ?? new MemoryStore(options) });
  }
}

export { MemoryStore } from './storage/memory-store.js';
