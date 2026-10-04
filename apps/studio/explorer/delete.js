import {editProjectMembership} from '@sharpforge/project-system';
import {pathWithin} from './guards.js';

export function registerDeleteCommands(registry) {
  registry.set('delete', {mutates: true, execute: async ({commands, context, node, nodes}) => {
    if (node?.kind === 'solution-folder') return registry.get('remove-solution-folder').execute({commands, context, node, nodes});
    if (['project-reference', 'package', 'reference', 'analyzer'].includes(node?.kind)) {
      return registry.get('remove-reference').execute({commands, context, node, nodes});
    }
    const files = commands.files(nodes);
    if (files.length !== nodes.length || !files.length) throw new Error('Only physical files and folders may be deleted here');
    if (!await commands.host.confirm('Delete Items', files.map(file => file.path),
      context.native ? 'Deleted items are quarantined on disk. Undo is available in this host session.' :
        'Items and their project memberships are removed together. Undo restores their exact contents.')) return;
    const roots = files.filter(file => !files.some(parent => parent !== file && pathWithin(file.path, parent.path)));
    const operations = roots.map(file => ({kind: 'delete', path: file.path}));
    const projects = context.snapshot?.projects ?? [];
    for (const project of projects) {
      const items = [...(project.compile ?? []).map(item => ({...item, itemType: 'Compile'})), ...(project.items ?? [])]
        .filter(item => roots.some(root => pathWithin(item.path, root.path)));
      if (!items.length) continue;
      let text = await commands.readText(project.path);
      for (const item of items) text = editProjectMembership(text, {projectPath: project.path,
        path: item.path, itemType: item.itemType ?? 'Compile', include: false});
      operations.push({kind: 'write', path: project.path, text});
    }
    await commands.perform(operations);
  }});
}
