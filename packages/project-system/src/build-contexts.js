import { EvaluationError, getCaseInsensitive, toBoolean } from './evaluation/errors.js';
import { resolveProjectReferenceContext } from './context-selection.js';

/** Resolve dependency contexts without reading source contents, so hosts can hydrate only the selected compile graph. */
export function resolveBuildContextGraph(system, startup = system.solution?.projectPaths[0]) {
  const states = new Map();
  const nodes = [];
  const lookup = new Map();
  const visit = (project, depth = 0) => {
    if (!project || project.unloaded) throw new EvaluationError('A referenced project is unavailable for compilation.', 'SFP1403');
    if (depth > 100) throw new EvaluationError('Build graph depth limit exceeded.', 'SFP1002');
    const id = project.contextId ?? project.path;
    if (states.get(id) === 'active') throw new EvaluationError(`ProjectReference cycle contains '${project.path}'.`, 'SFP1002');
    if (states.get(id) === 'complete') return lookup.get(id);
    if (states.size >= (system.options.maxBuildContexts ?? 512)) throw new EvaluationError('Build context count limit exceeded.', 'SFP1903');
    states.set(id, 'active');
    const references = [];
    for (const reference of project.allProjectReferences ?? project.projectReferences) {
      if (!toBoolean(getCaseInsensitive(reference.metadata, 'BuildReference'), true)) continue;
      const dependency = system.projects.get(reference.path);
      if (!dependency) throw new EvaluationError(`Project '${reference.path}' is unavailable for compilation.`, 'SFP1403');
      const context = resolveProjectReferenceContext(project, dependency, reference);
      references.push({ reference, node: visit(context, depth + 1) });
    }
    const node = { id, project, references };
    lookup.set(id, node);
    nodes.push(node);
    states.set(id, 'complete');
    return node;
  };
  const entry = visit(system.projects.get(startup));
  return { startup, startupContextId: entry.id, nodes };
}
