import {rewriteProjectPaths, editProjectMembership, addSolutionItem} from '@sharpforge/project-system';
import {pathWithin, pathDirectory, mapExplorerPath, xmlWorkspacePath, inspectMoveBatch, confirmMoveBatch} from './guards.js';

/** Plan path/reference and membership changes together, so one journal entry owns the entire operation and its inverse. */
export async function moveExplorerItems(commands, mappings, copy, destinationProject = null, options = {}) {
  const context = commands.context();
  const results = inspectMoveBatch(context, mappings, {copy, allowProjectRename: options.allowProjectRename});
  const accepted = await confirmMoveBatch(commands.host, results);
  if (!accepted.length) return {completed: [], rejected: results.filter(item => item.status === 'rejected')};
  const operations = accepted.map(mapping => ({kind: copy ? 'copy' : 'move', path: mapping.from, destination: mapping.to}));
  const projectEdits = new Map();
  if (!copy) {
    for (const record of context.records.filter(record => xmlWorkspacePath(record.path))) {
      const original = await commands.readText(record.path);
      const target = mapExplorerPath(record.path, accepted);
      const text = rewriteProjectPaths(original, {documentPath: record.path, mappings: accepted, newDocumentPath: target});
      if (text !== original) projectEdits.set(target, text);
    }
  }
  const sourceProjects = context.snapshot?.projects ?? [];
  for (const project of sourceProjects) {
    if (copy || project.path === destinationProject) continue;
    const departing = (project.compile ?? []).filter(item => accepted.some(mapping => pathWithin(item.path, mapping.from)));
    if (!departing.length || !destinationProject) continue;
    let text = projectEdits.get(project.path) ?? await commands.readText(project.path);
    for (const item of departing) {
      text = editProjectMembership(text, {projectPath: project.path, path: item.path, include: false});
      text = editProjectMembership(text, {projectPath: project.path, path: mapExplorerPath(item.path, accepted), include: false});
    }
    projectEdits.set(project.path, text);
  }
  if (destinationProject) {
    let text = projectEdits.get(destinationProject) ?? await commands.readText(destinationProject);
    for (const record of context.records) {
      const mapping = accepted.find(item => pathWithin(record.path, item.from));
      if (!mapping) continue;
      const path = mapping.to + record.path.slice(mapping.from.length);
      const itemType = /\.cs$/i.test(path) ? 'Compile' : 'None';
      text = editProjectMembership(text, {projectPath: destinationProject, path, itemType});
    }
    projectEdits.set(destinationProject, text);
  }
  if (options.destinationNode?.kind === 'solution-folder' && context.solutionPath) {
    let text = projectEdits.get(context.solutionPath) ?? await commands.readText(context.solutionPath);
    for (const record of context.records) {
      const mapping = accepted.find(item => pathWithin(record.path, item.from));
      if (mapping) text = addSolutionItem(text, {solutionPath: context.solutionPath,
        path: mapping.to + record.path.slice(mapping.from.length), folder: options.destinationNode.solutionFolder ?? 'Solution Items'});
    }
    projectEdits.set(context.solutionPath, text);
  }
  for (const [path, text] of projectEdits) operations.push({kind: 'write', path, text});
  for (const operation of options.additionalOperations ?? []) {
    operations.push({...operation, path: mapExplorerPath(operation.path, accepted)});
  }
  await commands.perform(operations, copy ? [] : accepted);
  return {completed: accepted, rejected: results.filter(item => item.status === 'rejected')};
}
