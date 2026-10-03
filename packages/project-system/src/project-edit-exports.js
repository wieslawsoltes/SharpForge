export { relativeTo, removeSolutionProject, buildSolutionTree, validateItemPath,
  addSolutionProject, addSolutionFolder, rewriteProjectPath } from './explorer.js';
export { sourcePreservingProjectMembership as editProjectMembership,
  sourcePreservingNamedProjectItem as editNamedProjectItem } from './project-edit/index.js';
export * from './project-edit/index.js';
