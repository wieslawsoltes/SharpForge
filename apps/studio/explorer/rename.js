import {pathName} from './guards.js';
import {typeRenameOperations} from './type-rename.js';

export function registerRenameCommands(registry) {
  registry.set('rename', {mutates: true, execute: async ({commands, node, nodes}) => {
    if (node?.kind === 'solution-folder') return registry.get('rename-solution-folder').execute({commands, node, nodes});
    const files = node?.kind === 'project' ? [node] : commands.files(nodes);
    if (files.length !== 1) throw new Error('Rename one physical file or folder at a time');
    const path = await commands.host.pathDialog(node?.kind === 'project' ? 'Rename Project' : 'Rename Item', files[0].path);
    if (!path || path === files[0].path) return;
    if (node?.kind === 'project' && !/\.csproj$/i.test(path)) throw new Error('A C# project must retain its .csproj extension');
    const oldName = pathName(files[0].path).replace(/\.cs$/i, '');
    const newName = pathName(path).replace(/\.cs$/i, '');
    const sourceRename = /\.cs$/i.test(files[0].path) && /\.cs$/i.test(path) && oldName !== newName;
    if (sourceRename && commands.host.prepareTypeRename) {
      const plan = await commands.host.prepareTypeRename({uri: files[0].path, oldName, newName});
      if (plan.available) {
        const operations = await typeRenameOperations(commands, plan);
        const accepted = await commands.host.confirm('Rename matching type?', [oldName + ' → ' + newName],
          'Rename the type and its resolved references together with the file. Decline to rename only the file.');
        if (accepted) return commands.move([{from: files[0].path, to: path}], false, null, {additionalOperations: operations});
      } else commands.host.notice(plan.reason ?? 'A complete type rename is unavailable; only the file will be renamed.');
    } else if (sourceRename) {
      commands.host.notice('A semantic type rename provider is unavailable; only the file will be renamed.');
    }
    return commands.move([{from: files[0].path, to: path}], false, null, {allowProjectRename: node?.kind === 'project'});
  }});
}
