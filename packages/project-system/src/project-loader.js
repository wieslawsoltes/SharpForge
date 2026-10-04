import { parseXml } from './xml.js';
import { normalizePath, directoryName, baseName } from './paths.js';
import { readLegacySolution } from './legacy-solution.js';

function readSlnx(system, entry, solution) {
  const root = parseXml(system.text(entry));
  if (root.name !== 'Solution') throw new Error('Expected <Solution> root');
  const visit = (node, folder = '', depth = 0) => {
    if (depth > 64) throw new Error('Solution folder nesting limit exceeded');
    for (const child of node.children) {
      const attributes = child.attributes;
      try {
        if (child.name === 'Folder') {
          const name = attributes.Name ?? '';
          if (!name) throw new Error('Solution Folder requires Name');
          const next = name.startsWith('/') ? name : (folder + '/' + name).replace(/\/+/g, '/');
          solution.folders.push(next);
          visit(child, next, depth + 1);
        } else if (child.name === 'Project') {
          const path = normalizePath(attributes.Path ?? '', directoryName(entry));
          solution.projectPaths.push(path);
          solution.items.push({ kind: 'project', path, folder });
          for (const option of child.children) system.diagnostic(entry, `Solution project option '${option.name}' is retained for inspection.`);
        } else if (child.name === 'File') {
          solution.items.push({ kind: 'file', path: normalizePath(attributes.Path ?? '', directoryName(entry)), folder });
        } else system.diagnostic(entry, `Solution element '${child.name}' is not evaluated.`);
      } catch (error) { system.diagnostic(entry, error.message, 'error'); }
    }
  };
  visit(root);
  return solution;
}

function unloadedProject(path, reason) {
  return { path, name: baseName(path).replace(/\.[^.]+$/, ''), unloaded: true, supported: false, reason,
    properties: {}, compile: [], projectReferences: [], allProjectReferences: [], items: [],
    packageReferences: [], references: [], analyzers: [], additionalFiles: [], targetFrameworks: [],
    targetFramework: '', outputType: 'Library' };
}

/** Load the solution graph while retaining projects whose native language toolchain is unavailable. */
export function loadProjectSystem(system, entry) {
  entry = normalizePath(entry);
  system.projects.clear();
  system.evaluationContexts.clear();
  system.evaluationContextVariants.clear();
  system.contextSelection.clear();
  system.diagnostics = [];
  let solution = { path: entry, name: baseName(entry).replace(/\.(?:slnx?|[A-Za-z]+proj)$/i, ''),
    folders: [], items: [], projectPaths: [] };
  if (/\.sln$/i.test(entry)) {
    solution = readLegacySolution(system.text(entry), entry);
    system.diagnostics.push(...solution.diagnostics);
    delete solution.diagnostics;
  } else if (/\.slnx$/i.test(entry)) solution = readSlnx(system, entry, solution);
  else if (/\.[A-Za-z]+proj$/i.test(entry)) solution.projectPaths = [entry];
  else throw new Error('Select a project, .slnx or .sln file');
  const visiting = new Set();
  const ordered = [];
  const loadProject = (path, chain = []) => {
    if (visiting.has(path)) {
      system.diagnostic(path, 'ProjectReference cycle: ' + [...chain, path].join(' → '), 'error', 'SFP1002');
      return;
    }
    if (system.projects.has(path)) return;
    if (system.projects.size >= (system.options.maxProjects ?? 100)) {
      system.diagnostic(path, `Project limit (${system.options.maxProjects ?? 100}) exceeded`, 'error');
      return;
    }
    if (!/\.csproj$/i.test(path)) {
      const reason = 'Project type requires its native toolchain: ' + path;
      system.projects.set(path, unloadedProject(path, reason));
      system.diagnostic(path, reason, 'warning', 'SFP1301');
      return;
    }
    visiting.add(path);
    try {
      const project = system.evaluateProject(path);
      system.projects.set(path, project);
      const contexts = project.contexts ?? [project];
      for (const context of contexts) for (const reference of context.allProjectReferences ?? context.projectReferences) {
        loadProject(reference.path, [...chain, path]);
      }
      ordered.push(path);
    } catch (error) { system.diagnostic(path, error.message, 'error', error.code); }
    visiting.delete(path);
  };
  const extraProjects = (solution.projects ?? []).map(project => project.path);
  for (const path of new Set([...solution.projectPaths, ...extraProjects])) loadProject(path);
  system.solution = { ...solution, projectPaths: [...new Set(solution.projectPaths)], buildOrder: ordered };
  return system.snapshot();
}
