import { StudioDiagnostics } from './studio-diagnostics.js';

/** Maps the loaded project system onto isolated compiler services without selecting background work. */
export class StudioProjects {
  constructor(services, { state, onError = () => {} }) {
    this.services = services;
    this.state = state;
    this.onError = onError;
    this.signatures = new Map();
    this.workspace = null;
    this.epoch = null;
    this.diagnostics = new StudioDiagnostics(services, state);
  }

  get selectedId() {
    const state = this.state();
    return state.projectSystem?.projects.has(state.startupProject) ? state.startupProject : '$workspace';
  }

  get currentProjectId() {
    const memberships = this.services.documents.projectsFor(this.state().active);
    return memberships.includes(this.selectedId) ? this.selectedId : memberships[0] ?? this.selectedId;
  }

  definitions() {
    const state = this.state();
    if (state.projectSystem?.projects.size) return [...state.projectSystem.projects.values()].map(project => ({
      id: project.path, name: project.name, outputType: project.outputType,
      dependencies: project.projectReferences.map(reference => reference.path)
    }));
    return [{ id: '$workspace', name: state.name, outputType: 'exe', dependencies: [] }];
  }

  sourceUris(projectId) {
    const state = this.state();
    return state.projectSystem?.projects.has(projectId)
      ? state.projectSystem.compilationFiles(projectId).map(file => file.uri)
      : state.files.map(file => file.uri);
  }

  snapshot(projectId) {
    const state = this.state();
    const project = state.projectSystem?.projects.get(projectId);
    const uris = new Set(this.sourceUris(projectId));
    const compilationOptions = project ? state.projectSystem.compilationOptions(projectId)
      : { outputKind: 'exe', langVersion: state.langVersion };
    return {
      files: state.files.filter(file => uris.has(file.uri)).map(file => ({ uri: file.uri, text: file.text, version: file.version })),
      compilationOptions, assemblyName: project?.name ?? state.name, extensions: state.extensionConfig,
      outputKind: project?.outputType?.toLowerCase() === 'library' ? 'library' : 'exe',
      loadingDiagnostics: this.diagnostics.forProject(projectId)
    };
  }

  sync() {
    const state = this.state();
    const epoch = state.workspaceEpoch ?? 0;
    const identity = state.projectSystem?.solution?.path ?? `${state.nativeMode ? 'native' : 'source'}:${state.name}`;
    if (this.workspace !== identity || this.epoch !== epoch) {
      for (const session of this.services.sessions.list()) this.services.sessions.remove(session.id);
      for (const service of this.services.builds.list()) this.services.builds.remove(service.id);
      for (const id of this.services.documents.projectMembership.keys()) this.removeMembership(id);
      if (this.workspace !== null) {
        this.services.profiles.projects.clear();
        this.services.profiles.selected.clear();
        this.services.startup.configure({ mode: 'single', entries: [] });
      }
      this.signatures.clear();
      this.workspace = identity;
      this.epoch = epoch;
    }
    const definitions = this.definitions();
    const valid = new Set(definitions.map(project => project.id));
    const removedProfiles = [];
    for (const old of this.services.builds.list()) if (!valid.has(old.id)) {
      if (this.services.profiles.removeProject(old.id, { notify: false })) removedProfiles.push(old.id);
      this.services.builds.remove(old.id);
      this.removeMembership(old.id);
      this.services.breakpoints.removeProject(old.id);
      this.signatures.delete(old.id);
    }
    for (const project of definitions) {
      const uris = this.sourceUris(project.id);
      const signature = JSON.stringify([project, uris, state.configuration, state.langVersion, state.extensionConfig]);
      if (this.signatures.get(project.id) !== signature) {
        this.services.builds.register(project);
        this.services.documents.setProjectMembership(project.id, uris);
        this.signatures.set(project.id, signature);
      }
    }
    this.diagnostics.sync();
    this.services.builds.setActive(valid.has(this.selectedId) ? this.selectedId : definitions[0]?.id ?? null);
    const existing = this.services.startup.entries.filter(entry => valid.has(entry.projectId));
    const runnable = definitions.find(project => project.id === this.selectedId && project.outputType.toLowerCase() !== 'library')
      ?? definitions.find(project => project.outputType.toLowerCase() !== 'library');
    if (!existing.length && runnable) this.services.startup.select(runnable.id);
    else if (existing.length !== this.services.startup.entries.length) this.services.startup.configure({ entries: existing });
    if (removedProfiles.length) this.services.profiles.notifyRemoved(removedProfiles);
    this.services.locks.refresh();
  }

  removeMembership(id) {
    this.services.documents.setProjectMembership(id, []);
    this.services.documents.projectMembership.delete(id);
  }

  serviceFor(uri, explicitProject) {
    this.sync();
    const memberships = uri ? this.services.documents.projectsFor(uri) : [];
    const id = explicitProject ?? (memberships.includes(this.selectedId) ? this.selectedId : memberships[0]) ?? this.selectedId;
    const service = this.services.builds.get(id);
    if (!service) throw new Error(`No compiler service for project '${id}'`);
    return service;
  }

  request(method, params = {}, options) {
    const { projectId, ...request } = params;
    const service = this.serviceFor(params.uri, projectId);
    return service.request(method, {...request, projectId: service.id}, options);
  }

  async syncBreakpoints(uri) {
    const values = this.state().breakpoints[uri] ?? [];
    const results = await Promise.all(this.services.documents.projectsFor(uri).map(id => this.services.breakpoints.set(id, uri, values)));
    for (const result of results) for (const failure of result.failures) this.onError(failure.error);
    return results;
  }

  primeBreakpoints() {
    for (const [projectId, uris] of this.services.documents.projectMembership) {
      const source = this.state().breakpoints;
      this.services.breakpoints.projects.set(projectId, new Map([...uris].map(uri => [uri, (source[uri] ?? []).map(value => ({ ...value }))])));
    }
  }

  dispose() { this.diagnostics.dispose(); }
}
