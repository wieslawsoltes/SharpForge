import { resolveProjectReferenceContext } from '@sharpforge/project-system';

/** Build graph identity is a project context, so two TFMs never share references or diagnostics. */
export class ProjectBuildGraph {
  constructor(nodes, { maxNodes = 20000 } = {}) {
    if (!Array.isArray(nodes) || nodes.length > maxNodes) throw new Error('Project graph node limit exceeded');
    this.nodes = new Map();
    this.dependents = new Map();
    this.owners = new Map();
    for (const node of nodes) {
      if (!node.id || this.nodes.has(node.id)) throw new Error('Duplicate or missing graph node identity');
      this.nodes.set(node.id, { ...node, dependencies: [...new Set(node.dependencies ?? [])] });
      this.dependents.set(node.id, new Set());
      for (const path of [node.project, ...node.inputs ?? []].filter(Boolean)) {
        if (!this.owners.has(path)) this.owners.set(path, new Set());
        this.owners.get(path).add(node.id);
      }
    }
    for (const node of this.nodes.values()) for (const dependency of node.dependencies) {
      if (!this.nodes.has(dependency)) throw new Error('Missing project graph dependency: ' + dependency);
      this.dependents.get(dependency).add(node.id);
    }
    this.order = this.topological(new Set(this.nodes.keys()));
  }
  topological(selected) {
    const indegrees = new Map(), ready = [], result = [];
    for (const id of selected) {
      const count = this.nodes.get(id).dependencies.filter(dependency => selected.has(dependency)).length;
      indegrees.set(id, count);
      if (!count) ready.push(id);
    }
    for (let position = 0; position < ready.length; position++) {
      const id = ready[position];
      result.push(id);
      for (const dependent of this.dependents.get(id)) {
        if (!selected.has(dependent)) continue;
        const count = indegrees.get(dependent) - 1;
        indegrees.set(dependent, count);
        if (!count) ready.push(dependent);
      }
    }
    if (result.length !== selected.size) throw Object.assign(new Error('Project graph contains a dependency cycle'), { code: 'MSB4251' });
    return result;
  }
  affected(changedPaths) {
    const selected = new Set(), queue = [];
    for (const path of changedPaths) for (const id of this.owners.get(path) ?? []) {
      if (!selected.has(id)) { selected.add(id); queue.push(id); }
    }
    for (let position = 0; position < queue.length; position++) for (const id of this.dependents.get(queue[position])) {
      if (!selected.has(id)) { selected.add(id); queue.push(id); }
    }
    return this.topological(selected).map(id => this.nodes.get(id));
  }
  async build(engine, changedPaths, options = {}) {
    const results = [];
    for (const node of this.affected(changedPaths)) {
      options.signal?.throwIfAborted();
      const started = await engine.start({ ...options, project: node.project,
        configuration: node.configuration, platform: node.platform,
        framework: node.targetFramework, runtime: node.runtimeIdentifier,
        graphBuild: false, properties: { ...options.properties, ...node.properties, BuildProjectReferences: 'false' } });
      const abort = () => engine.cancel(started.id);
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      let result;
      try { result = await engine.wait(started.id); }
      finally { options.signal?.removeEventListener('abort', abort); }
      results.push({ contextId: node.id, ...result });
      if (result.status !== 'succeeded') break;
    }
    return results;
  }
}

/** Construct the static dependency graph from evaluated contexts; references select the nearest compatible library TFM. */
export function projectGraphFromContexts(contexts) {
  const projects = new Map();
  for (const context of contexts) {
    if (!projects.has(context.project)) projects.set(context.project, []);
    projects.get(context.project).push(context);
  }
  const nodes = contexts.map(context => {
    const dependencies = [];
    for (const reference of context.projectReferences ?? []) {
      const path = reference.project ?? reference.path ?? reference.FullPath ?? reference.Identity;
      const candidates = (projects.get(path) ?? []).filter(candidate => candidate.configuration === context.configuration &&
        candidate.platform === context.platform);
      const selected = resolveProjectReferenceContext(context, { path, contexts: candidates },
        { metadata: reference.metadata ?? reference });
      dependencies.push(selected.id);
    }
    return { id: context.id, project: context.project, configuration: context.configuration, platform: context.platform,
      targetFramework: context.targetFramework, runtimeIdentifier: context.runtimeIdentifier, dependencies,
      inputs: [...context.sources.map(source => source.path), ...context.generatedSources.map(source => source.path), ...context.imports],
      properties: context.globalProperties ?? {} };
  });
  return new ProjectBuildGraph(nodes);
}

/** Adapt the public portable project system closure without reaching into evaluator implementation modules. */
export function projectGraphFromProjectSystem(system, startup, adaptContext) {
  if (typeof adaptContext !== 'function') throw new Error('A ProjectContext adapter is required');
  const contexts = [];
  for (const path of system.closure(startup)) {
    const project = system.projects.get(path) ?? system.evaluateProject(path);
    for (const context of project.contexts ?? [project]) contexts.push(adaptContext(context));
  }
  return projectGraphFromContexts(contexts);
}
