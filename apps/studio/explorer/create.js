import {editProjectMembership} from '@sharpforge/project-system';
import {destinationFolder, pathName} from './guards.js';
import {importExplorerFiles} from './existing-items.js';

export {importExplorerFiles} from './existing-items.js';

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
