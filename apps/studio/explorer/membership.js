import {editProjectMembership, validateItemPath} from '@sharpforge/project-system';
import {destinationFolder, pathName} from './guards.js';

const itemTypes = ['Compile', 'None', 'Content', 'EmbeddedResource', 'AdditionalFiles'];

export function registerMembershipCommands(registry) {
  const edit = async ({commands, node, nodes, action}) => {
    const projectEdits = new Map();
    for (const file of nodes) {
      if (!file?.project || !file.path) throw new Error('Select source items belonging to a project');
      let text = projectEdits.get(file.project) ?? await commands.readText(file.project);
      const buildAction = action.startsWith('build-action:') ? action.slice(13) : null;
      if (buildAction && !itemTypes.includes(buildAction)) throw new Error('Unsupported build action');
      if (action === 'exclude' || buildAction) {
        for (const itemType of itemTypes) text = editProjectMembership(text, {projectPath: file.project,
          path: file.path, include: false, itemType});
      }
      if (action === 'include' || buildAction) text = editProjectMembership(text, {projectPath: file.project,
        path: file.path, include: true, itemType: buildAction ?? file.itemType ?? 'Compile', metadata: file.metadata ?? {}});
      projectEdits.set(file.project, text);
    }
    await commands.perform([...projectEdits].map(([path, text]) => ({kind: 'write', path, text})));
  };
  for (const action of ['include', 'exclude', ...itemTypes.map(kind => 'build-action:' + kind)]) {
    registry.set(action, {mutates: true, execute: edit});
  }
  const link = async ({commands, context, node, nodes, action}) => {
    if (!node?.project) throw new Error('Choose a project or one of its folders to add linked items');
    let selected = nodes;
    if (action === 'add-link') {
      const path = await commands.host.choose('Add Existing Item as Link', context.records.filter(record => record.path !== node.project)
        .map(record => record.path));
      if (!path) return;
      selected = [{path}];
    }
    if (!selected.length) throw new Error('Select files to link');
    let text = await commands.readText(node.project);
    const folder = destinationFolder(node);
    const projectBase = node.project.includes('/') ? node.project.slice(0, node.project.lastIndexOf('/')) : '';
    const relativeFolder = projectBase ? folder.slice(projectBase.length).replace(/^\//, '') : folder;
    for (const file of selected) {
      if (!context.records.some(record => record.path === file.path)) throw new Error('Only workspace files can be linked; import external files first');
      const display = validateItemPath((relativeFolder ? relativeFolder + '/' : '') + pathName(file.path));
      text = editProjectMembership(text, {projectPath: node.project, path: file.path,
        itemType: /\.cs$/i.test(file.path) ? 'Compile' : 'None', metadata: {Link: display}});
    }
    await commands.perform([{kind: 'write', path: node.project, text}]);
  };
  registry.set('add-link', {mutates: true, execute: link});
  registry.set('link-to', {mutates: true, execute: link});
}
