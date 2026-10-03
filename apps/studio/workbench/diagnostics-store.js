import { WorkbenchEvents, requireIdentifier } from './state-events.js';

export const diagnosticSources = Object.freeze(['build', 'analysis', 'project', 'designer']);

/** Versioned replacement is scoped to exactly one project and producer. */
export class DiagnosticsStore {
  constructor({ maxDiagnostics = 100_000 } = {}) {
    if (!Number.isSafeInteger(maxDiagnostics) || maxDiagnostics < 1) throw new RangeError('Invalid diagnostic limit');
    this.maxDiagnostics = maxDiagnostics;
    this.projects = new Map();
    this.events = new WorkbenchEvents();
    this.revision = 0;
  }

  subscribe(listener, options) { return this.events.subscribe(listener, options); }

  replace(projectId, source, diagnostics, { revision = 0 } = {}) {
    requireIdentifier(projectId, 'Project id');
    if (!diagnosticSources.includes(source)) throw new TypeError('Unknown diagnostic source');
    if (!Array.isArray(diagnostics) || diagnostics.length > this.maxDiagnostics) throw new RangeError('Diagnostic limit exceeded');
    if (!Number.isSafeInteger(revision) || revision < 0) throw new RangeError('Invalid diagnostic revision');
    const producers = this.projects.get(projectId) ?? new Map();
    if ((producers.get(source)?.revision ?? -1) > revision) return false;
    const items = diagnostics.map((diagnostic, index) => {
      if (!diagnostic || typeof diagnostic.message !== 'string') throw new TypeError('A diagnostic requires a message');
      const severity = diagnostic.severity ?? 'error';
      if (!['error', 'warning', 'info', 'information', 'hint', 'message'].includes(severity)) throw new TypeError('Invalid severity');
      return Object.freeze({
        ...diagnostic,
        id: `${projectId}:${source}:${revision}:${index}`,
        projectId,
        source,
        severity,
        producerRevision: revision
      });
    });
    producers.set(source, { revision, items });
    this.projects.set(projectId, producers);
    this.events.emit({ type: 'diagnostics', projectId, source, revision: ++this.revision, items });
    return true;
  }

  query({ projectId, source, uri, severities, search = '', openUris, deduplicate = false } = {}) {
    const projects = projectId === undefined ? this.projects : [[projectId, this.projects.get(projectId)]];
    const query = search.toLocaleLowerCase();
    const visible = openUris === undefined ? null : new Set(openUris);
    const allowedSeverities = severities === undefined ? null : new Set(severities);
    const result = [];
    const seen = deduplicate ? new Set() : null;
    for (const [, producers] of projects) {
      if (!producers) continue;
      for (const [producer, value] of producers) {
        if (source !== undefined && producer !== source) continue;
        for (const diagnostic of value.items) {
          if (uri !== undefined && diagnostic.uri !== uri) continue;
          if (visible && !visible.has(diagnostic.uri)) continue;
          if (allowedSeverities && !allowedSeverities.has(diagnostic.severity)) continue;
          if (query && !`${diagnostic.code ?? ''} ${diagnostic.message} ${diagnostic.uri ?? ''}`.toLocaleLowerCase().includes(query)) continue;
          const identity = seen && JSON.stringify([diagnostic.projectId, diagnostic.uri, diagnostic.start, diagnostic.code, diagnostic.message]);
          if (seen?.has(identity)) continue;
          seen?.add(identity);
          result.push(diagnostic);
        }
      }
    }
    return result;
  }

  removeProject(projectId) {
    if (this.projects.delete(projectId)) this.events.emit({ type: 'removed', projectId, revision: ++this.revision });
  }

  clear(projectId, source) {
    if (!this.projects.get(projectId)?.delete(source)) return;
    this.events.emit({ type: 'diagnostics', projectId, source, revision: ++this.revision, items: [] });
  }

  dispose() { this.projects.clear(); this.events.dispose(); }
}
