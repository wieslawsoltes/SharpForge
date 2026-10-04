import { WorkbenchEvents, abortError, workbenchError } from './state-events.js';

/** Deterministic dependency order. Unknown projects and cycles fail before a worker is touched. */
export function projectBuildOrder(projectIds, getProject) {
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, path) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw workbenchError('PROJECT_CYCLE', `Project dependency cycle: ${[...path, id].join(' → ')}`);
    const project = getProject(id);
    if (!project) throw workbenchError('PROJECT_MISSING', `Unknown project '${id}'`);
    if (path.length > 256) throw workbenchError('PROJECT_DEPTH', 'Project dependency depth exceeds 256');
    visiting.add(id);
    for (const dependency of project.dependencies ?? project.projectReferences ?? []) {
      visit(typeof dependency === 'string' ? dependency : dependency.path ?? dependency.id, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(id);
  };
  for (const id of projectIds) visit(id, []);
  return ordered;
}

export class BuildQueue {
  constructor(builds, { output, getProject = id => builds.get(id)?.project } = {}) {
    this.builds = builds;
    this.output = output;
    this.getProject = getProject;
    this.events = new WorkbenchEvents();
    this.operations = new Map();
    this.projectOperations = new Map();
    this.projectTails = new Map();
    this.nextId = 0;
  }

  subscribe(listener, options) { return this.events.subscribe(listener, options); }

  async run(projectIds, { signal, background = false } = {}) {
    if (this.operations.size >= 128) throw workbenchError('BUILD_QUEUE_LIMIT', 'Build queue operation limit reached');
    const order = projectBuildOrder(projectIds, this.getProject);
    const controller = new AbortController();
    const id = `build:${++this.nextId}`;
    const operation = { id, controller, projectIds: order, current: null };
    const summary = { id, succeeded: [], failed: [], skipped: [], cancelled: [], results: new Map() };
    const cancel = () => controller.abort(signal.reason);
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
    this.operations.set(id, operation);
    this.events.emit({ type: 'queued', operation });
    try {
      for (const projectId of order) {
        if (controller.signal.aborted) { summary.skipped.push(projectId); continue; }
        const project = this.getProject(projectId);
        const dependencies = (project.dependencies ?? project.projectReferences ?? []).map(value => {
          return typeof value === 'string' ? value : value.path ?? value.id;
        });
        if (dependencies.some(dependency => {
          return summary.failed.includes(dependency) || summary.skipped.includes(dependency) || summary.cancelled.includes(dependency);
        })) {
          summary.skipped.push(projectId);
          continue;
        }
        operation.current = projectId;
        this.output?.append('Build Order', `${projectId}\n`, { projectId });
        try {
          const service = this.builds.get(projectId);
          if (!service) throw workbenchError('PROJECT_MISSING', `No build service for '${projectId}'`);
          const result = await this.runProject(projectId, operation, () => service.build({ signal: controller.signal, background }));
          summary.results.set(projectId, result);
          summary[result.success ? 'succeeded' : 'failed'].push(projectId);
        } catch (error) {
          summary.results.set(projectId, { success: false, error });
          summary[controller.signal.aborted || error.name === 'AbortError' ? 'cancelled' : 'failed'].push(projectId);
        } finally {
          if (this.projectOperations.get(projectId) === operation) this.projectOperations.delete(projectId);
        }
        this.events.emit({ type: 'progress', operation, summary, projectId });
      }
      this.output?.append('Build', this.summaryText(summary));
      this.events.emit({ type: 'completed', operation, summary });
      return summary;
    } finally {
      signal?.removeEventListener('abort', cancel);
      this.operations.delete(id);
    }
  }

  summaryText(summary) {
    return `Build: ${summary.succeeded.length} succeeded, ${summary.failed.length} failed, ` +
      `${summary.skipped.length} skipped, ${summary.cancelled.length} cancelled.\n`;
  }

  runProject(projectId, operation, action) {
    const execute = () => {
      if (operation.controller.signal.aborted) throw abortError(operation.controller.signal.reason);
      this.projectOperations.set(projectId, operation);
      return action();
    };
    const previous = this.projectTails.get(projectId) ?? Promise.resolve();
    const pending = previous.then(execute, execute);
    this.projectTails.set(projectId, pending);
    const cleanup = () => {
      if (this.projectTails.get(projectId) === pending) this.projectTails.delete(projectId);
      if (this.projectOperations.get(projectId) === operation) this.projectOperations.delete(projectId);
    };
    pending.then(cleanup, cleanup);
    return pending;
  }

  cancel(id, reason = 'Build cancelled') {
    const operation = this.operations.get(id) ?? this.projectOperations.get(id) ??
      [...this.operations.values()].find(value => value.projectIds.includes(id));
    if (operation) operation.controller.abort(abortError(reason));
    return !!operation;
  }

  /** Return a cancellation callback for the exact currently executing operation, never a later queue sharing its project id. */
  captureCancellation(projectId) {
    const operation = this.projectOperations.get(projectId);
    if (!operation) return null;
    return reason => {
      if (this.projectOperations.get(projectId) !== operation || operation.controller.signal.aborted) return false;
      operation.controller.abort(abortError(reason ?? 'Build cancelled'));
      return true;
    };
  }

  dispose() {
    for (const operation of this.operations.values()) operation.controller.abort(abortError('Build queue disposed'));
    this.events.dispose();
  }
}
