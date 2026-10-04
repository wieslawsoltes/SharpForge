import {editProjectMembership, editNamedProjectItem} from '@sharpforge/project-system';

export function registerReferenceCommands(registry) {
  registry.set('add-reference', {mutates: true, execute: async ({commands, context, node}) => {
    const choices = (context.snapshot?.projects ?? []).filter(project => project.path !== node.project).map(project => project.path);
    if (!choices.length) throw new Error('Add another project to this solution first');
    const path = await commands.host.choose('Add Project Reference', choices);
    if (!path) return;
    const text = editProjectMembership(await commands.readText(node.project), {projectPath: node.project, path, itemType: 'ProjectReference'});
    await commands.perform([{kind: 'write', path: node.project, text}]);
  }});
  registry.set('remove-reference', {mutates: true, execute: async ({commands, node}) => {
    if (!await commands.host.confirm('Remove Reference', [node.label],
      'Remove this item from project evaluation; conditional or imported definitions and physical files are preserved.')) return;
    const original = await commands.readText(node.project);
    const text = node.kind === 'project-reference' ? editProjectMembership(original,
      {projectPath: node.project, path: node.path, include: false, itemType: 'ProjectReference'}) : editNamedProjectItem(original,
      {itemType: ({package: 'PackageReference', reference: 'Reference', analyzer: 'Analyzer'})[node.kind],
        name: node.metadata?.name ?? node.metadata?.include ?? node.metadata?.path ?? node.label, include: false});
    await commands.perform([{kind: 'write', path: node.project, text}]);
  }});
  registry.set('add-package', {mutates: true, execute: async ({commands, node}) => {
    const name = await commands.host.pathDialog('Package ID', 'Example.Package');
    if (!name) return;
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error('Use a literal NuGet package identifier');
    const version = await commands.host.pathDialog('Package Version', '1.0.0');
    if (!version) return;
    if (!/^[A-Za-z0-9.+-]+$/.test(version)) throw new Error('Use a literal package version');
    const text = editNamedProjectItem(await commands.readText(node.project), {name, metadata: {Version: version}});
    await commands.perform([{kind: 'write', path: node.project, text}]);
    commands.host.notice('Package reference added. Restore with a trusted native MSBuild engine to resolve it.');
  }});
}
