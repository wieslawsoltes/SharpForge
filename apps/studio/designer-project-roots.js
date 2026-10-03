import {DesignerRootRegistry, designScene, projectDesignerAuthoringScene} from '@sharpforge/designer';

/** Versioned, lazy previews for project controls. Compilation and source reads stay in the compiler worker. */
export class DesignerProjectRoots {
  constructor({analyze, revision, workspaceId, refresh, report = () => {}}) {
    Object.assign(this, {analyze, revision, workspaceId, refresh, report});
    this.registry = new DesignerRootRegistry();
    this.catalog = new Map();
    this.attempted = new Set();
    this.pending = new Map();
    this.controllers = new Set();
    this.queue = [];
    this.generation = 0;
    this.disposed = false;
  }

  setCatalog(descriptors, version) {
    if (this.disposed || version !== this.revision()) return;
    if (!Array.isArray(descriptors) || descriptors.length > 256) throw new RangeError('Project preview catalog exceeds 256 controls.');
    if (new Set(descriptors.map(descriptor => descriptor.type)).size !== descriptors.length) {
      throw new TypeError('Project preview catalog contains duplicate types.');
    }
    this.generation++;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.version = version;
    this.catalog = new Map(descriptors.map(descriptor => [descriptor.type, structuredClone(descriptor)]));
    this.attempted.clear();
    this.queue.length = 0;
    this.registry = new DesignerRootRegistry();
    this.refresh();
  }

  ensure(type) {
    if (this.disposed || this.version !== this.revision() || this.attempted.has(type) || !this.catalog.has(type)) return;
    this.attempted.add(type);
    const controller = new AbortController();
    this.controllers.add(controller);
    this.queue.push({descriptor: this.catalog.get(type), generation: this.generation, workspace: this.workspaceId(), controller});
    this.pump();
  }

  pump() {
    while (!this.disposed && this.pending.size < 2 && this.queue.length) {
      const entry = this.queue.shift();
      const key = entry.generation + ':' + entry.descriptor.type;
      const request = this.load(entry).catch(error => {
        if (!entry.controller.signal.aborted && entry.generation === this.generation) this.report(entry.descriptor, error);
      }).finally(() => {
        this.controllers.delete(entry.controller);
        this.pending.delete(key);
        this.pump();
      });
      this.pending.set(key, request);
    }
  }

  async load(entry) {
    const {descriptor, generation, workspace, controller} = entry;
    const result = await this.analyze({operation: 'analyze', uri: descriptor.uri, className: descriptor.type,
      methodName: descriptor.rootAssignment?.methodName, projectTypes: [...this.catalog.values()], signal: controller.signal,
      requestOwner: 'component:' + descriptor.type, workspaceId: workspace, generation});
    if (this.disposed || generation !== this.generation || workspace !== this.workspaceId() || this.version !== this.revision()) return;
    if (result.workspaceRevision !== undefined && result.workspaceRevision !== this.version
      || result.revision !== undefined && result.revision !== this.version) return;
    if (!result.success && !result.previewAvailable) throw Object.assign(new Error(result.diagnostics?.[0]?.message ??
      'Project control preview could not be analyzed'), {
      code: 'SFD1862', diagnostics: result.diagnostics ?? []
    });
    const document = result.analysis.document;
    if (result.success) this.registry.register(descriptor, document, {analysisVersion: this.version, successful: true});
    else this.registry.registerPreview(descriptor, result.analysis, {analysisVersion: this.version});
    for (const node of document.nodes) if (node.projectType) this.ensure(node.projectType);
    this.refresh();
  }

  project(design, scene, options = {}) {
    for (const node of design.nodes) if (node.projectType) this.ensure(node.projectType);
    return this.registry.project(design, scene, {
      createScene: document => projectDesignerAuthoringScene(document, designScene(document), options)
    });
  }

  definition(node) {
    return this.registry.definition(node) ?? (this.catalog.has(node.projectType) ? {
      type: node.projectType, uri: this.catalog.get(node.projectType).uri
    } : null);
  }

  reset() {
    this.generation++;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.registry = new DesignerRootRegistry();
    this.catalog.clear();
    this.queue.length = 0;
    this.attempted.clear();
  }

  dispose() { this.disposed = true; this.reset(); }
}
