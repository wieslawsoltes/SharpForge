/** Instance-owned dispatch table. Registrations replace a type only with explicit override. */
export class RendererRegistry {
  constructor({ resolveType = () => null } = {}) {
    this.resolveType = resolveType;
    this.entries = new Map();
    this.cache = new Map();
    this.version = 0;
  }

  register(types, renderer, { override = false } = {}) {
    if (typeof types === 'object' && !Array.isArray(types)) {
      renderer = types;
      types = renderer.types;
    }
    const names = Array.isArray(types) ? types : [types];
    if (!renderer || names.some(name => typeof name !== 'string' || !name)) {
      throw new TypeError('Renderer registration requires named types and a descriptor');
    }
    for (const name of names) {
      if (!override && this.entries.has(name)) throw new Error(`Renderer already registered: ${name}`);
    }
    const entry = Object.freeze({ ...renderer });
    for (const name of names) this.entries.set(name, entry);
    this.cache.clear();
    this.version++;
    return this;
  }

  resolve(type) {
    if (typeof type !== 'string') return this.entries.get('*') ?? null;
    if (this.cache.has(type)) return this.cache.get(type);
    const seen = new Set();
    let current = type;
    let renderer = null;
    while (current && !seen.has(current)) {
      seen.add(current);
      renderer = this.entries.get(current) ?? this.entries.get(current.slice(current.lastIndexOf('.') + 1));
      if (renderer) break;
      current = this.resolveType(current)?.base;
    }
    renderer ??= this.entries.get('*') ?? null;
    this.cache.set(type, renderer);
    return renderer;
  }

  /** Fork registration state so one application cannot replace another application's renderer. */
  clone(options = {}) {
    const registry = new RendererRegistry({ resolveType: options.resolveType ?? this.resolveType });
    for (const [name, entry] of this.entries) registry.entries.set(name, entry);
    registry.version = this.version;
    return registry;
  }
}
