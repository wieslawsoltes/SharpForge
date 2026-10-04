import { directoryName } from '@sharpforge/project-system';
import { documentSource } from './document-source.js';

function diagnostic(item, uri, source, severity = 'error') {
  const start = Math.max(0, item.start ?? item.span?.start ?? 0);
  const end = Math.max(start, item.end ?? item.span?.end ?? start + (item.length ?? 0));
  const range = item.range ?? (source && end <= source.length ? {
    start: source.positionAt(start), end: source.positionAt(end)
  } : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } });
  return { ...item, uri: item.uri ?? item.path ?? uri, start, length: end - start, range,
    severity: item.severity ?? severity, code: item.code ?? 'SFSTUDIO_DESIGNER', message: item.message ?? String(item) };
}

/** Publishes immutable producer results using the same loaded-project and document ownership as Studio compilation. */
export class StudioDiagnostics {
  constructor(services, state) {
    this.services = services;
    this.state = state;
    this.loading = new Map();
    this.designers = new Map();
    this.signatures = new Map();
    this.inputs = null;
    this.revision = 0;
    this.disposed = false;
    this.unsubscribe = services.documents.subscribe(event => {
      if (['changed', 'removed', 'reset', 'membership'].includes(event.type)) this.invalidate();
    });
  }

  owners(uri, projectId) {
    const { documents, builds } = this.services;
    if (projectId && builds.get(projectId)) return [projectId];
    const members = documents.projectsFor(uri).filter(id => builds.get(id));
    if (members.length) return members;
    const system = this.state().projectSystem;
    if (system?.projects.has(uri)) return [uri];
    const projects = [...(system?.projects.values() ?? [])];
    const explicit = projects.filter(project => [...(project.imports ?? []), ...(project.projectReferences ?? []).map(item => item.path),
      ...(project.items ?? []).map(item => item.path)].includes(uri));
    if (explicit.length) return explicit.map(project => project.path).filter(id => builds.get(id));
    const containing = projects.filter(project => {
      const directory = directoryName(project.path);
      return directory && uri?.startsWith(directory + '/');
    }).sort((left, right) => directoryName(right.path).length - directoryName(left.path).length);
    if (containing.length) {
      const directory = directoryName(containing[0].path);
      return containing.filter(project => directoryName(project.path) === directory).map(project => project.path);
    }
    return system ? [] : builds.get('$workspace') ? ['$workspace'] : [];
  }

  sync() {
    if (this.disposed) return;
    const state = this.state();
    const declared = state.projectSnapshot?.solution?.projectPaths ?? state.projectSystem?.solution?.projectPaths ?? [];
    const ids = [...new Set([...this.services.builds.list().map(service => service.id), ...declared])];
    const items = state.projectSnapshot?.diagnostics ?? state.projectSystem?.diagnostics ?? state.projectDiagnostics ?? [];
    const input = [state.projectSystem, state.workspaceEpoch, items, items.length, ids.join('\0')];
    if (this.inputs?.every((value, index) => value === input[index])) return;
    if (this.inputs && (this.inputs[0] !== input[0] || this.inputs[1] !== input[1])) this.signatures.clear();
    this.inputs = input;
    const loading = new Map(ids.map(id => [id, []]));
    for (const item of items) {
      const uri = item.uri ?? item.path ?? state.projectSnapshot?.solution?.path ?? '';
      const explicit = item.projectId ?? item.project;
      const owners = explicit ? ids.includes(explicit) ? [explicit] : [] : ids.includes(uri) ? [uri] : this.owners(uri);
      const solutionPath = state.projectSnapshot?.solution?.path ?? state.projectSystem?.solution?.path;
      const projects = owners.length ? owners : !uri || uri === solutionPath ? ids : [];
      for (const id of projects) loading.get(id)?.push(diagnostic(item, uri, null, 'warning'));
    }
    for (const [id, values] of loading) {
      const signature = JSON.stringify(values);
      if (this.signatures.get(id) !== signature) {
        if (this.signatures.has(id)) this.services.builds.get(id)?.invalidate('project-diagnostics');
        this.services.diagnostics.replace(id, 'project', values, { revision: ++this.revision });
        this.signatures.set(id, signature);
      }
    }
    for (const id of this.loading.keys()) if (!loading.has(id)) {
      this.signatures.delete(id);
      this.services.diagnostics.removeProject(id);
    }
    this.loading = loading;
    this.invalidate();
  }

  forProject(id) { return this.loading.get(id) ?? []; }

  capture(uri, { projectId } = {}) {
    if (this.disposed || typeof uri !== 'string' || !uri) return null;
    const state = this.state();
    const record = this.services.documents.get(uri) ?? state.projectSystem?.files.get(uri) ?? null;
    const owners = this.owners(uri);
    const projectIds = owners.length ? owners : this.owners(uri, projectId);
    return Object.freeze({ uri, record, version: record?.version, projectIds: Object.freeze(projectIds),
      memberships: Object.freeze(this.services.documents.projectsFor(uri)),
      system: state.projectSystem, epoch: state.workspaceEpoch,
      source: documentSource(record, this.services.documents.models.get(uri)) });
  }

  current(target) {
    if (!target || this.disposed) return false;
    const state = this.state();
    const record = this.services.documents.get(target.uri) ?? state.projectSystem?.files.get(target.uri) ?? null;
    const memberships = this.services.documents.projectsFor(target.uri);
    return state.projectSystem === target.system && state.workspaceEpoch === target.epoch && record === target.record
      && record?.version === target.version && target.projectIds.length > 0
      && target.projectIds.every(id => this.services.builds.get(id))
      && memberships.length === target.memberships.length && memberships.every(id => target.memberships.includes(id));
  }

  publish(target, items) {
    if (!this.current(target)) return false;
    if (!Array.isArray(items) || items.length > this.services.diagnostics.maxDiagnostics) throw new RangeError('Invalid designer diagnostics');
    const previous = this.designers.get(target.uri);
    const values = items.map(item => diagnostic(item, target.uri, target.source));
    if (values.length) this.designers.set(target.uri, { target, values });
    else this.designers.delete(target.uri);
    this.flush(new Set([...target.projectIds, ...(previous?.target.projectIds ?? [])]));
    return true;
  }

  clear(target) {
    if (!target || this.disposed) return;
    const current = this.designers.get(target.uri);
    if (!current || current.target !== target) return;
    this.designers.delete(target.uri);
    this.flush(new Set(target.projectIds));
  }

  invalidate() {
    const changed = new Set();
    for (const [uri, value] of this.designers) if (!this.current(value.target)) {
      this.designers.delete(uri);
      for (const id of value.target.projectIds) changed.add(id);
    }
    this.flush(changed);
  }

  flush(projectIds) {
    for (const id of projectIds) {
      if (!this.services.builds.get(id)) continue;
      const values = [...this.designers.values()].filter(value => value.target.projectIds.includes(id)).flatMap(value => value.values);
      this.services.diagnostics.replace(id, 'designer', values, { revision: ++this.revision });
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.designers.clear();
    this.loading.clear();
    this.signatures.clear();
    this.inputs = null;
  }
}
