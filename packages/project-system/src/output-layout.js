import { normalizePath } from './paths.js';
import { EvaluationError, getCaseInsensitive, toBoolean } from './evaluation/errors.js';
import { resolveProjectReferenceContext } from './context-selection.js';

function copyMode(value) {
  if (!value) return 'Never';
  const modes = ['Never', 'Always', 'PreserveNewest', 'IfDifferent'];
  const mode = modes.find(mode => mode.toLowerCase() === String(value).toLowerCase());
  if (!mode) throw new EvaluationError(`Unknown copy behavior '${value}'.`, 'SFP1601');
  return mode;
}

/** Produce output/publish/package copy plans, including referenced-project content, without performing I/O. */
export function createOutputLayout(projects, startup) {
  const lookup = projects instanceof Map ? projects : new Map(projects.map(project => [project.path, project]));
  const output = [];
  const publish = [];
  const pack = [];
  const seen = new Set();
  const destinations = new Map();
  const visit = (path, project = lookup.get(path)) => {
    if (!project) throw new EvaluationError(`Output project '${path}' is missing.`, 'SFP1601');
    const id = project.contextId ?? path;
    if (seen.has(id)) return;
    seen.add(id);
    for (const reference of project.allProjectReferences ?? project.projectReferences) {
      if (toBoolean(getCaseInsensitive(reference.metadata, 'Private'), true)
        && toBoolean(getCaseInsensitive(reference.metadata, 'BuildReference'), true)) {
        const dependency = lookup.get(reference.path);
        if (!dependency) throw new EvaluationError(`Output project '${reference.path}' is missing.`, 'SFP1601');
        visit(reference.path, resolveProjectReferenceContext(project, dependency, reference));
      }
    }
    const items = project.evaluatedItems ? Object.values(project.evaluatedItems).flat() : project.items;
    for (const item of items) {
      if (!['Content', 'None'].includes(item.itemType)) continue;
      const metadata = item.metadata ?? {};
      const target = normalizePath(getCaseInsensitive(metadata, 'TargetPath') ?? getCaseInsensitive(metadata, 'Link') ?? item.identity ?? item.path);
      const mode = copyMode(getCaseInsensitive(metadata, 'CopyToOutputDirectory'));
      const publishMode = copyMode(getCaseInsensitive(metadata, 'CopyToPublishDirectory') ?? mode);
      const record = { source: item.path, target, project: path, mode, contextId: project.contextId };
      if (mode !== 'Never' || publishMode !== 'Never') {
        const existing = destinations.get(target);
        if (existing && existing !== item.path) throw new EvaluationError(`Output destination '${target}' has conflicting sources.`, 'SFP1601');
        destinations.set(target, item.path);
      }
      if (mode !== 'Never') output.push(record);
      if (publishMode !== 'Never') publish.push({ ...record, mode: publishMode });
      if (toBoolean(getCaseInsensitive(metadata, 'Pack'))) pack.push({ ...record,
        target: getCaseInsensitive(metadata, 'PackagePath') ?? 'content/' + target });
    }
  };
  visit(startup);
  return { project: startup, output, publish, pack };
}
