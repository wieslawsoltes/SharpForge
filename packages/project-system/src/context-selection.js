import { nearestTargetFramework } from './tfm.js';
import { EvaluationError, getCaseInsensitive } from './evaluation/errors.js';

/** Stable identity shared by portable evaluation, native design time and launch artifacts. */
export function projectContextId({ project, path, configuration = 'Debug', platform = 'AnyCPU',
  targetFramework = '', runtimeIdentifier = '' }) {
  return JSON.stringify([project ?? path, configuration, platform, targetFramework, runtimeIdentifier]);
}

const same = (left, right) => String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase();

/** Match a context ID or an explicit subset of configuration/platform/framework/runtime dimensions. */
export function findProjectContext(contexts, selector) {
  if (typeof selector === 'string') return contexts.find(context => (context.id ?? context.contextId) === selector) ?? null;
  const keys = ['configuration', 'platform', 'targetFramework', 'runtimeIdentifier'];
  return contexts.find(context => keys.every(key => selector?.[key] === undefined || same(context[key], selector[key]))) ?? null;
}

/** Replace project contexts atomically; old diagnostics and IDs never survive a new evaluation. */
export class ProjectContextSelection {
  constructor() {
    this.contexts = new Map();
    this.active = new Map();
  }

  update(contexts) {
    const projects = new Set(contexts.map(context => context.project ?? context.path));
    for (const [id, context] of this.contexts) {
      if (projects.has(context.project ?? context.path)) this.contexts.delete(id);
    }
    for (const context of contexts) this.contexts.set(context.id ?? context.contextId, context);
    for (const project of projects) {
      if (!this.contexts.has(this.active.get(project))) {
        const context = contexts.find(context => (context.project ?? context.path) === project);
        this.active.set(project, context.id ?? context.contextId);
      }
    }
  }

  select(project, selector) {
    const contexts = [...this.contexts.values()].filter(context => (context.project ?? context.path) === project);
    const selected = findProjectContext(contexts, selector);
    if (!selected) throw new EvaluationError('Context does not belong to project or is unavailable.', 'SFP1903');
    this.active.set(project, selected.id ?? selected.contextId);
    return selected;
  }

  get(project) {
    return this.contexts.get(this.active.get(project)) ?? null;
  }

  diagnostics() {
    return [...this.contexts.values()].flatMap(context => context.diagnostics ?? []);
  }

  clear() {
    this.contexts.clear();
    this.active.clear();
  }
}

function requestedFramework(metadata) {
  const direct = getCaseInsensitive(metadata, 'TargetFramework');
  if (direct) return direct;
  const assignments = [getCaseInsensitive(metadata, 'SetTargetFramework'), getCaseInsensitive(metadata, 'AdditionalProperties')];
  for (const assignment of assignments) for (const property of String(assignment ?? '').split(';')) {
    const match = /^\s*TargetFramework\s*=\s*(.+?)\s*$/i.exec(property);
    if (match) return match[1];
  }
  return null;
}

/** Select the nearest compatible dependency TFM while retaining runtime-neutral library fallback. */
export function resolveProjectReferenceContext(source, dependency, reference = {}) {
  const contexts = dependency.contexts ?? [dependency];
  const explicit = requestedFramework(reference.metadata);
  const framework = explicit ?? (source.targetFramework
    ? nearestTargetFramework(source.targetFramework, [...new Set(contexts.map(context => context.targetFramework).filter(Boolean))])
    : dependency.targetFramework);
  const matching = contexts.filter(context => same(context.targetFramework, framework));
  const candidates = matching.length ? matching : contexts.filter(context => !context.targetFramework);
  if (!candidates.length || explicit && !matching.length) {
    throw new EvaluationError(`No compatible target framework in '${dependency.path}' for '${source.targetFramework}'.`, 'SFP1904');
  }
  return candidates.find(context => same(context.runtimeIdentifier, source.runtimeIdentifier))
    ?? candidates.find(context => !context.runtimeIdentifier)
    ?? candidates[0];
}

/** Retain the active facade shape while exposing every independently evaluated framework context. */
export function projectWithContexts(contexts, active, runtimeIdentifiers = []) {
  return { ...active, contexts, activeContextId: active.id, runtimeIdentifiers: [...runtimeIdentifiers] };
}
