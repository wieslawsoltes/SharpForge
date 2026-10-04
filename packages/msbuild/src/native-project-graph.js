import { projectGraphFromContexts } from './project-graph.js';

/** Cache graph structure between source edits; changed project/import files trigger authoritative context discovery. */
export class NativeProjectGraphService {
  constructor(engine, designTime, { maxProjects = 512, maxGraphs = 16 } = {}) {
    Object.assign(this, { engine, designTime, maxProjects, maxGraphs });
    this.graphs = new Map();
  }
  key(request) {
    return JSON.stringify([request.project, request.configuration, request.platform, request.framework, request.runtime,
      Object.entries(request.properties ?? {}).sort(([left], [right]) => left.localeCompare(right))]);
  }
  async graph(request, options = {}) {
    await this.engine.authorize(request);
    const key = this.key(request);
    if (this.graphs.has(key) && !request.refresh) return this.graphs.get(key);
    const pending = [request.project];
    const seen = new Set();
    const contexts = [];
    for (let index = 0; index < pending.length; index++) {
      options.signal?.throwIfAborted();
      const project = pending[index];
      if (seen.has(project)) continue;
      if (seen.size >= this.maxProjects) throw new Error('Native graph project limit exceeded');
      seen.add(project);
      await this.engine.workspace.path(project);
      const evaluated = await this.designTime.contexts({ ...request, project }, options);
      for (const context of evaluated) {
        contexts.push(context);
        for (const reference of context.projectReferences) pending.push(reference.project);
      }
    }
    const graph = projectGraphFromContexts(contexts);
    while (this.graphs.size >= this.maxGraphs) this.graphs.delete(this.graphs.keys().next().value);
    this.graphs.set(key, graph);
    return graph;
  }
  async inspect(request, options) {
    const graph = await this.graph(request, options);
    return { nodes: [...graph.nodes.values()], order: graph.order };
  }
  async build(request, options = {}) {
    if (!Array.isArray(request.changedPaths) || request.changedPaths.length > 20000) throw new Error('Changed path limit exceeded');
    const cached = this.graphs.get(this.key(request));
    const refresh = request.refresh || request.changedPaths.some(path => /\.(?:[a-z]*proj|props|targets|json)$/i.test(path) ||
      cached && !cached.owners.has(path));
    const graph = await this.graph({ ...request, refresh }, options);
    const affected = graph.affected(request.changedPaths);
    const results = await graph.build(this.engine, request.changedPaths, { ...request, ...options });
    return { affected: affected.map(node => node.id), results,
      status: results.every(result => result.status === 'succeeded') ? 'succeeded' : 'failed' };
  }
  close() { this.graphs.clear(); }
}
