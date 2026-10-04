import { dirname, resolve } from 'node:path';
import { createProjectContext } from './project-context.js';

/** IDE documents use granted workspace paths; SDK references retain their authoritative absolute identity. */
export function normalizeWorkspaceContext(workspace, context, generatedSources) {
  const directory = dirname(resolve(workspace.root, context.project));
  const absolutePath = path => resolve(directory, path.replaceAll('\\', '/'));
  const generated = new Map(generatedSources.map(source => [source.path, source]));
  const diagnostics = [...context.diagnostics];
  const sources = [];
  for (const source of context.sources) {
    const absolute = absolutePath(source.path);
    const path = workspace.relative(absolute);
    if (path && generated.has(path)) continue;
    if (path) sources.push({ ...source, path, readOnly: false });
    else {
      sources.push({ ...source, path: absolute, readOnly: true, external: true });
      diagnostics.push({ code: 'SFMSB_CONTEXT_SOURCE_OUTSIDE_ROOT', severity: 'warning', file: absolute,
        message: 'This source is outside the granted workspace. Open a containing workspace to inspect its text.' });
    }
  }
  const projectReferences = context.projectReferences.map(reference => {
    const absolute = absolutePath(reference.FullPath ?? reference.Identity ?? reference.path);
    return { ...reference, project: workspace.relative(absolute) ?? absolute };
  });
  const imports = context.imports.map(path => {
    const absolute = absolutePath(path);
    return workspace.relative(absolute) ?? absolute;
  });
  return createProjectContext({ ...context, sources, generatedSources: [...generated.values()], diagnostics, projectReferences, imports });
}
