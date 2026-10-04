import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

const forwarderFlag = 0x00200000;
const maxNameBytes = 16384;
const maxExpandedCharacters = 16 * 1024 * 1024;
const invalid = message => loadError(LoadErrorCode.InvalidImage, message);
const limit = message => loadError(LoadErrorCode.LimitExceeded, message);

/** Module-local ExportedType indices and successful bindings; these retain canonical target modules, never copies of types. */
export class TypeForwarders {
  #indices = new WeakMap();
  #bindings = new WeakMap();
  #maxRows;
  #maxHops;
  #maxDepth;
  constructor({ maxMetadataRows, maxForwarderHops, maxDepth }) {
    this.#maxRows = maxMetadataRows;
    this.#maxHops = maxForwarderHops;
    this.#maxDepth = maxDepth;
  }

  #readEntry(module, rid) {
    const [flags, , nameIndex, namespaceIndex, implementation] = module.row(0x27000000 + rid);
    const name = module.string(nameIndex, { maxBytes: maxNameBytes });
    const namespace = module.string(namespaceIndex, { maxBytes: maxNameBytes });
    const tag = implementation & 3;
    const target = implementation >>> 2;
    const table = [38, 35, 39][tag];
    if (!name || table === undefined || !target || target > module.rowCount(table)) {
      throw invalid(`Invalid ExportedType implementation at row ${rid}`);
    }
    if (tag === 1 && !(flags & forwarderFlag)) {
      throw invalid(`AssemblyRef ExportedType row ${rid} is missing its Forwarder flag`);
    }
    if (tag !== 1 && (flags & forwarderFlag)) {
      throw invalid(`ExportedType row ${rid} has a Forwarder flag without an AssemblyRef`);
    }
    if (tag === 2 && (namespace || (flags & 7) !== 2)) {
      throw invalid(`Nested ExportedType row ${rid} requires NestedPublic visibility and an empty namespace`);
    }
    return { rid, name, namespace, parent: tag === 2 ? target : 0,
      reference: tag === 1 ? target : 0, file: tag === 0 ? target : 0, fullName: null, depth: 0 };
  }

  #completeName(entry, entries) {
    const chain = [];
    const active = new Set();
    for (let current = entry; current && current.fullName === null; current = entries[current.parent]) {
      if (active.has(current.rid)) throw invalid(`Circular nested ExportedType ownership at row ${current.rid}`);
      if (chain.length >= this.#maxDepth) throw limit('Nested ExportedType depth exceeded');
      active.add(current.rid);
      chain.push(current);
    }
    let characters = 0;
    for (let index = chain.length - 1; index >= 0; index--) {
      const current = chain[index];
      const parent = entries[current.parent];
      current.depth = (parent?.depth ?? 0) + 1;
      if (current.depth > this.#maxDepth) throw limit('Nested ExportedType depth exceeded');
      current.fullName = parent ? `${parent.fullName}+${current.name}`
        : `${current.namespace ? current.namespace + '.' : ''}${current.name}`;
      if (current.fullName.length > 4096) throw limit('ExportedType name length exceeded');
      characters += current.fullName.length;
      if (parent) {
        current.reference = parent.reference;
        current.file = parent.file;
      }
    }
    return characters;
  }

  #index(module, signal) {
    const cached = this.#indices.get(module);
    if (cached) return cached;
    const count = module.rowCount(39);
    if (count + module.rowCount(35) + module.rowCount(38) > this.#maxRows) {
      throw limit('ExportedType metadata row limit exceeded');
    }
    const entries = new Array(count + 1);
    for (let rid = 1; rid <= count; rid++) {
      checkCancellation(signal);
      entries[rid] = this.#readEntry(module, rid);
    }
    const names = new Map();
    let characters = 0;
    for (let rid = 1; rid <= count; rid++) {
      checkCancellation(signal);
      const entry = entries[rid];
      characters += this.#completeName(entry, entries);
      if (characters > maxExpandedCharacters) throw limit('ExportedType expanded name budget exceeded');
      if (names.has(entry.fullName)) throw invalid(`Duplicate ExportedType ${entry.fullName}`);
      names.set(entry.fullName, entry);
    }
    this.#indices.set(module, names);
    return names;
  }

  #publish(path, fullName, result, suffixHops = 0) {
    for (const module of path) {
      const bindings = this.#bindings.get(module);
      if (bindings && !bindings.has(fullName) && bindings.size >= this.#maxRows) {
        throw limit('Type forwarder binding count exceeded');
      }
    }
    for (let index = 0; index < path.length; index++) {
      const module = path[index];
      let bindings = this.#bindings.get(module);
      if (!bindings) this.#bindings.set(module, bindings = new Map());
      bindings.set(fullName, Object.freeze({ result, hops: path.length - index + suffixHops }));
    }
    return result;
  }

  #entry(module, fullName, signal) {
    const names = this.#index(module, signal);
    let depth = 0;
    for (let name = fullName; name; ) {
      const entry = names.get(name);
      if (entry) return entry;
      const separator = name.lastIndexOf('+');
      if (separator < 0) return null;
      if (++depth >= this.#maxDepth) throw limit('Nested forwarded name depth exceeded');
      name = name.slice(0, separator);
    }
    return null;
  }

  /** Resolve one exact metadata name through AssemblyRef forwarders; failures and cancellation are never cached. */
  async resolve(module, fullName, lookupDefinition, { signal, resolveReference } = {}) {
    const path = [];
    const visited = new Set();
    while (true) {
      checkCancellation(signal);
      module.assembly.ensureUsable();
      const cached = this.#bindings.get(module)?.get(fullName);
      if (cached) {
        if (path.length + cached.hops > this.#maxHops) throw limit(`Type forwarder hop limit exceeded for ${fullName}`);
        return this.#publish(path, fullName, cached.result, cached.hops);
      }
      const token = lookupDefinition(module, fullName);
      if (token) return this.#publish(path, fullName, Object.freeze({ module, token }));
      if (visited.has(module)) {
        const chain = [...path, module].map(item => item.assembly.identity.name).join(' -> ');
        throw loadError(LoadErrorCode.TypeLoad, `Circular type forwarding for ${fullName}: ${chain}`);
      }
      const entry = this.#entry(module, fullName, signal);
      if (!entry) {
        throw loadError(LoadErrorCode.TypeLoad, `Type ${fullName} was not found in assembly ${module.assembly.fullName}`);
      }
      if (entry.file) {
        throw loadError(LoadErrorCode.TypeLoad, `ExportedType ${fullName} requires linked netmodule loading`);
      }
      if (path.length >= this.#maxHops) throw limit(`Type forwarder hop limit exceeded for ${fullName}`);
      visited.add(module);
      path.push(module);
      const assembly = resolveReference ? await resolveReference(module.assembly, entry.reference)
        : await module.assembly.resolveReference(entry.reference, { signal });
      module = assembly.manifestModule;
    }
  }
}
