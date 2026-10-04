import {decodeWorkspaceFile} from '@sharpforge/archive';
import {editProjectMembership, validateItemPath, addSolutionItem} from '@sharpforge/project-system';
import {destinationFolder, pathName} from './guards.js';
import {copyDestination} from './clipboard.js';

/** External file admission checks the whole batch before reading or committing; binary contents are never converted to text. */
export async function importExplorerFiles(commands, node, files) {
  const context = commands.context();
  const folder = destinationFolder(node);
  const selected = [...files];
  if (selected.length > 2000 || selected.reduce((size, file) => size + file.size, 0) > 128 * 1024 * 1024) {
    throw new Error('External file import count or byte limit exceeded');
  }
  if (selected.some(file => !Number.isFinite(file.size) || file.size < 0 || file.size > 16 * 1024 * 1024)) {
    throw new Error('Existing items must be at most 16 MiB each');
  }
  const occupied = new Set(context.records.map(record => record.path));
  const operations = [];
  let projectText = node?.project ? await commands.readText(node.project) : null;
  let solutionText = node?.kind === 'solution-folder' && context.solutionPath ? await commands.readText(context.solutionPath) : null;
  for (const file of selected) {
    const proposed = validateItemPath((folder ? folder + '/' : '') + file.name);
    const path = copyDestination(proposed, occupied);
    occupied.add(path);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== file.size) throw new Error('External file changed during import: ' + file.name);
    operations.push({kind: 'create', path, record: decodeWorkspaceFile(path, bytes), bytes});
    if (projectText !== null) projectText = editProjectMembership(projectText,
      {projectPath: node.project, path, itemType: /\.cs$/i.test(path) ? 'Compile' : 'None'});
    if (solutionText !== null) solutionText = addSolutionItem(solutionText,
      {solutionPath: context.solutionPath, path, folder: node.solutionFolder ?? 'Solution Items'});
  }
  if (projectText !== null) operations.push({kind: 'write', path: node.project, text: projectText});
  if (solutionText !== null) operations.push({kind: 'write', path: context.solutionPath, text: solutionText});
  if (operations.length) await commands.perform(operations);
  return {imported: selected.length};
}

export function registerCreateCommands(registry) {
  for (const action of ['new-file', 'new-folder']) registry.set(action, {mutates: true, execute: async ({commands, node}) => {
    if (action === 'new-file' && commands.host.wizardItem) return commands.host.wizardItem(node);
    const folder = destinationFolder(node);
    const isFolder = action === 'new-folder';
    const path = await commands.host.pathDialog(isFolder ? 'New Folder' : 'Add New Item',
      (folder ? folder + '/' : '') + (isFolder ? 'NewFolder' : 'NewClass.cs'));
    if (!path) return;
    const identifier = pathName(path).replace(/\.cs$/i, '').replace(/[^A-Za-z0-9_]/g, '_');
    const className = /^[A-Za-z_]/.test(identifier) ? identifier : '_' + identifier;
    const text = /\.cs$/i.test(path) ? `class ${className}\n{\n    public int Value { get; set; }\n}\n` : '';
    const operations = [{kind: isFolder ? 'mkdir' : 'create', path, text: isFolder ? undefined : text}];
    if (!isFolder && node?.project) operations.push({kind: 'write', path: node.project,
      text: editProjectMembership(await commands.readText(node.project), {projectPath: node.project, path,
        itemType: /\.cs$/i.test(path) ? 'Compile' : 'None'})});
    await commands.perform(operations);
    if (!isFolder) await commands.host.open({path, kind: /\.cs$/i.test(path) ? 'source' : 'file'});
  }});
  registry.set('add-existing', {mutates: true, execute: async ({commands, node}) => {
    const files = await commands.host.pickFiles();
    if (files?.length) return importExplorerFiles(commands, node, files);
  }});
  registry.set('import-drop', {mutates: true, execute: ({commands, node, event}) => importExplorerFiles(commands, node, event.files)});
}
