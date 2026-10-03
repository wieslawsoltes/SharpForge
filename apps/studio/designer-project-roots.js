import {DesignerRootRegistry, designScene, projectDesignerAuthoringScene} from '@sharpforge/designer';

/** Versioned, lazy previews for project controls. Compilation and source reads stay in the compiler worker. */
export class DesignerProjectRoots {
  constructor({analyze, revision, workspaceId, refresh, report = () => {}}) {
    Object.assign(this, {analyze, revision, workspaceId, refresh, report});
    this.registry = new DesignerRootRegistry();
    this.catalog = new Map();
    this.attempted = new Set();
    this.pending = new Map();
    this.queue = [];
    this.generation = 0;
    this.disposed = false;
  }

  setCatalog(descriptors, version) {
    if (this.disposed || version !== this.revision()) return;
    this.generation++;
    this.version = version;
    this.catalog = new Map(descriptors.map(descriptor => [descriptor.type, descriptor]));
    this.attempted.clear();
    this.queue.length = 0;
    for (const type of this.registry.entries.keys()) if (!this.catalog.has(type)) this.registry.entries.delete(type);
    this.refresh();
  }

  ensure(type) {
    if (this.disposed || this.version !== this.revision() || this.attempted.has(type) || !this.catalog.has(type)) return;
    this.attempted.add(type);
    this.queue.push({descriptor: this.catalog.get(type), generation: this.generation, workspace: this.workspaceId()});
    this.pump();
  }

  pump() {
    while (!this.disposed && this.pending.size < 2 && this.queue.length) {
      const entry = this.queue.shift();
      const key = entry.generation + ':' + entry.descriptor.type;
      const request = this.load(entry).catch(error => this.report(entry.descriptor, error)).finally(() => {
        this.pending.delete(key);
        this.pump();
      });
      this.pending.set(key, request);
    }
  }

  async load(entry) {
    const {descriptor, generation, workspace} = entry;
    const result = await this.analyze({operation: 'analyze', uri: descriptor.uri, className: descriptor.type});
    if (this.disposed || generation !== this.generation || workspace !== this.workspaceId() || this.version !== this.revision()) return;
    if (!result.success) throw Object.assign(new Error(result.diagnostics?.[0]?.message ?? 'Project control preview could not be analyzed'), {
      code: 'SFD1862', diagnostics: result.diagnostics ?? []
    });
    const document = result.analysis.document;
    this.registry.register(descriptor, document, {analysisVersion: this.version, successful: true});
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
    this.registry = new DesignerRootRegistry();
    this.catalog.clear();
    this.queue.length = 0;
    this.attempted.clear();
  }

  dispose() { this.disposed = true; this.reset(); }
}
