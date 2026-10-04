const identity = (context, level) => {
  if (!context || level === 'build') return 'build';
  let result = `project:${context.nodeId}:${context.projectContextId}`;
  if (level === 'target' || level === 'task') result += ':target:' + context.targetId;
  if (level === 'task') result += ':task:' + context.taskId;
  return result;
};

/** Retain only structural nodes/timings; arbitrarily many messages remain in the paged disk spool. */
export class BuildEventModel {
  constructor({ maxNodes = 100000, maxModelBytes = 33554432 } = {}) {
    if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 1000000
      || !Number.isSafeInteger(maxModelBytes) || maxModelBytes < 1024 || maxModelBytes > 268435456) {
      throw new Error('Invalid binlog model limit');
    }
    this.maxNodes = maxNodes;
    this.maxModelBytes = maxModelBytes;
    this.modelBytes = 1024;
    this.nodes = new Map();
    this.nodes.set('build', { id: 'build', kind: 'build', name: 'Build', parentId: null, children: [], start: null, end: null, durationMs: null });
    this.eventCount = 0;
    this.warningCount = 0;
    this.errorCount = 0;
    this.readerWarnings = [];
  }
  accept(event) {
    this.eventCount++;
    if (event.kind === 'ReaderWarning') {
      if (this.readerWarnings.length < 100) {
        this.admitStrings([event.message]);
        this.readerWarnings.push(event.message);
      }
      return;
    }
    if (event.severity === 'warning') this.warningCount++;
    if (event.severity === 'error') this.errorCount++;
    const match = /^(Build|Project|Target|Task)(Started|Finished)$/.exec(event.kind ?? '');
    if (!match) return;
    const level = match[1].toLowerCase(), id = identity(event.context, level);
    let node = this.nodes.get(id);
    if (!node) {
      if (this.nodes.size >= this.maxNodes) throw new Error('Binlog structural node limit exceeded');
      const parentId = level === 'project' ? event.parentContext ? identity(event.parentContext, 'project') : 'build'
        : identity(event.context, level === 'task' ? 'target' : 'project');
      node = { id, parentId: parentId === id ? 'build' : parentId, kind: level, name: event.name ?? level,
        project: event.projectFile ?? null, children: [], start: null, end: null, durationMs: null };
      this.admitStrings([node.id, node.parentId, node.name, node.project]);
      this.nodes.set(id, node);
    }
    if (match[2] === 'Started') node.start = event.timestamp;
    else { node.end = event.timestamp; node.succeeded = event.succeeded; }
    if (node.start !== null && node.end !== null) node.durationMs = Math.max(0, node.end - node.start);
  }
  admitStrings(values) {
    let bytes = 1024;
    for (const value of values) {
      if (value == null) continue;
      if (typeof value !== 'string' || value.length > 8192) throw new Error('Binlog structural string limit exceeded');
      bytes += value.length * 2;
    }
    if (this.modelBytes + bytes > this.maxModelBytes) throw new Error('Binlog model byte limit exceeded');
    this.modelBytes += bytes;
  }
  finish() {
    for (const node of this.nodes.values()) node.children = [];
    for (const node of this.nodes.values()) {
      if (!node.parentId) continue;
      const parent = this.nodes.get(node.parentId) ?? this.nodes.get('build');
      parent.children.push(node.id);
    }
    return this;
  }
  page(parentId = 'build', { offset = 0, limit = 100 } = {}) {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid binlog page');
    const parent = this.nodes.get(parentId);
    if (!parent) throw new Error('Unknown binlog node');
    return { parent, total: parent.children.length, nodes: parent.children.slice(offset, offset + limit).map(id => this.nodes.get(id)),
      nextOffset: offset + limit < parent.children.length ? offset + limit : null };
  }
  timings({ kind = 'target', limit = 20 } = {}) {
    if (!['project', 'target', 'task'].includes(kind) || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid timing query');
    return [...this.nodes.values()].filter(node => node.kind === kind && node.durationMs !== null)
      .sort((a, b) => b.durationMs - a.durationMs).slice(0, limit);
  }
  summary() {
    return { events: this.eventCount, nodes: this.nodes.size, warnings: this.warningCount, errors: this.errorCount,
      durationMs: this.nodes.get('build').durationMs, modelBytes: this.modelBytes, readerWarnings: this.readerWarnings,
      timingSemantics: 'Wall-clock node durations overlap for parallel targets; their sum is not build wall time' };
  }
}
