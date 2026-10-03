/** Explicit tool-kind factories create independent panel content and bounded serializable identities. */
export class ToolWindowFactories {
  constructor({ layout, content, onCreated = () => {} } = {}) {
    this.layout = layout;
    this.content = content;
    this.onCreated = onCreated;
    this.factories = new Map();
    this.layout.state.panelInstances ??= {};
  }

  register(kind, factory, { limit = 4, title = kind } = {}) {
    if (typeof kind !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(kind) || typeof factory !== 'function') {
      throw new TypeError('A tool kind needs a stable identifier and factory');
    }
    if (this.factories.has(kind)) throw new Error('Tool kind is already registered');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Invalid tool instance limit');
    this.factories.set(kind, { factory, limit, title });
    return () => this.factories.delete(kind);
  }

  create(kind, instance = 1, { sessionId = null, activate = true } = {}) {
    const definition = this.factories.get(kind);
    if (!definition) throw new Error(`Unknown tool kind '${kind}'`);
    if (!Number.isSafeInteger(instance) || instance < 1 || instance > definition.limit) throw new RangeError(`Invalid ${kind} instance`);
    if (sessionId !== null && (typeof sessionId !== 'string' || !sessionId || sessionId.length > 128)) throw new TypeError('Invalid session identity');
    const id = `tool:${kind}:${instance}${sessionId ? `:${encodeURIComponent(sessionId)}` : ''}`;
    if (!this.layout.panels.has(id)) {
      const record = { id, kind, instance, sessionId };
      const element = definition.factory(record);
      if (!element || typeof element.append !== 'function') throw new TypeError('Tool factory must return a DOM element');
      this.layout.register({ id, title: `${definition.title} ${instance}${sessionId ? ` · ${sessionId}` : ''}`, kind: 'tool',
        toolKind: kind, instance, sessionId });
      this.content.set(id, element);
      this.layout.state.panelInstances ??= {};
      this.layout.state.panelInstances[id] = record;
      this.onCreated(record);
    }
    if (activate) this.layout.open(id);
    return id;
  }

  restore(records = {}) {
    const diagnostics = [];
    if (!records || typeof records !== 'object' || Object.keys(records).length > 256) throw new Error('Invalid tool instance records');
    for (const [id, record] of Object.entries(records)) {
      try {
        if (!this.factories.has(record.kind)) throw new Error(`Unavailable tool factory '${record.kind}'`);
        const actual = this.create(record.kind, record.instance, { sessionId: record.sessionId, activate: false });
        if (actual !== id) throw new Error('Tool instance identity mismatch');
      } catch (error) { diagnostics.push({ code: 'SFDOCK005', panelId: id, message: error.message }); }
    }
    return diagnostics;
  }
}
