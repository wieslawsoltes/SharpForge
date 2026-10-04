import {renameSolutionFolder, removeSolutionFolder, moveSolutionProject, addSolutionProject, addSolutionFolder,
  removeSolutionProject, createCsproj, createSlnx, addSolutionItem} from '@sharpforge/project-system';
import {pathDirectory, pathName} from './guards.js';

export function registerSolutionCommands(registry) {
  registry.set('rename-solution-folder', {mutates: true, execute: async ({commands, node}) => {
    const context = commands.context();
    const name = await commands.host.pathDialog('Rename Solution Folder', node.solutionFolder.replace(/^\/+|\/+$/g, ''));
    if (!name) return;
    const text = renameSolutionFolder(await commands.readText(context.solutionPath), {folder: node.solutionFolder, name});
    await commands.perform([{kind: 'write', path: context.solutionPath, text}]);
  }});
  registry.set('remove-solution-folder', {mutates: true, execute: async ({commands, node}) => {
    const context = commands.context();
    if (!await commands.host.confirm('Remove Solution Folder', [node.solutionFolder],
      'Remove logical folder and solution membership. Physical files remain on disk.')) return;
    const text = removeSolutionFolder(await commands.readText(context.solutionPath), node.solutionFolder);
    await commands.perform([{kind: 'write', path: context.solutionPath, text}]);
  }});
  registry.set('project-folder', {mutates: true, execute: async ({commands, context, node}) => {
    const folder = await commands.host.choose('Move Project to Solution Folder', ['(Solution root)', ...(context.snapshot?.solution?.folders ?? [])]);
    if (!folder) return;
    const text = moveSolutionProject(await commands.readText(context.solutionPath), {solutionPath: context.solutionPath,
      projectPath: node.path, folder: folder === '(Solution root)' ? null : folder});
    await commands.perform([{kind: 'write', path: context.solutionPath, text}]);
  }});
  registry.set('new-project', {mutates: true, execute: createProject});
  registry.set('add-project', {mutates: true, execute: async ({commands, context, node}) => {
    if (commands.host.workspaceAction) return commands.host.workspaceAction('import-project', node);
    const choices = context.records.filter(file => /\.csproj$/i.test(file.path) &&
      !context.snapshot?.solution?.projectPaths?.includes(file.path)).map(file => file.path);
    if (!choices.length) throw new Error('No additional .csproj exists in this workspace. Add or create a project folder first.');
    const path = await commands.host.choose('Add Existing Project', choices);
    if (!path) return;
    const text = addSolutionProject(await commands.readText(context.solutionPath),
      {solutionPath: context.solutionPath, projectPath: path, folder: node?.solutionFolder});
    await commands.perform([{kind: 'write', path: context.solutionPath, text}]);
  }});
  registry.set('solution-folder', {mutates: true, execute: async ({commands, context, node}) => {
    const folder = await commands.host.pathDialog('Add Solution Folder', 'NewFolder');
    if (!folder) return;
    const text = addSolutionFolder(await commands.readText(context.solutionPath), (node?.solutionFolder ?? '') + folder);
    await commands.perform([{kind: 'write', path: context.solutionPath, text}]);
  }});
  registry.set('remove-project', {mutates: true, execute: async ({commands, context, node}) => {
    if (!context.solutionPath || !node.path) throw new Error('Select a project inside a solution');
    if (!await commands.host.confirm('Remove Project', [node.path],
      'Only solution membership is removed. Project files and references from other projects remain.')) return;
    const text = removeSolutionProject(await commands.readText(context.solutionPath), {solutionPath: context.solutionPath, projectPath: node.path});
    await commands.perform([{kind: 'write', path: context.solutionPath, text}]);
  }});
  registry.set('solution-add-items', {mutates: true, execute: async ({commands, context, node, nodes}) => {
    let text = await commands.readText(context.solutionPath);
    for (const item of nodes) text = addSolutionItem(text, {solutionPath: context.solutionPath,
      path: item.path, folder: node.solutionFolder ?? 'Solution Items'});
    await commands.perform([{kind: 'write', path: context.solutionPath, text}]);
  }});
}

async function createProject({commands, context, node}) {
  if (commands.host.wizardProject) return commands.host.wizardProject(node);
  const path = await commands.host.pathDialog('Add New Project', 'NewProject/NewProject.csproj');
  if (!path) return;
  if (!/\.csproj$/i.test(path)) throw new Error('Use a .csproj filename');
  const program = (pathDirectory(path) ? pathDirectory(path) + '/' : '') + 'Program.cs';
  const operations = [{kind: 'create', path, text: createCsproj({assemblyName: pathName(path).replace(/\.csproj$/i, ''), outputType: 'Exe'})},
    {kind: 'create', path: program, text: 'using System;\nclass Program\n{\n    public static void Main()\n    {\n' +
      '        Console.WriteLine("Hello from the new project");\n    }\n}\n'}];
  if (context.solutionPath) operations.push({kind: 'write', path: context.solutionPath,
    text: addSolutionProject(await commands.readText(context.solutionPath),
      {solutionPath: context.solutionPath, projectPath: path, folder: node?.solutionFolder})});
  else {
    const solution = await commands.host.pathDialog('Create a solution for the projects', context.name.replace(/[^A-Za-z0-9_.-]/g, '_') + '.slnx');
    if (!solution) return;
    operations.push({kind: 'create', path: solution, text: createSlnx([...new Set([...(context.snapshot?.projects ?? []).map(item => item.path), path])])});
  }
  await commands.perform(operations);
}
