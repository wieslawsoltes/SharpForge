import {baseName} from '../paths.js';
import {explorerNodeId} from './node-identity.js';

/** Generated files and imports retain their owning project and generator identity. */
export function appendProjectExtras(node, project, generated = []) {
  const files = [...(project.generatedDocuments ?? project.generatedSources ?? []), ...generated];
  if (files.length) {
    const group = {id: node.id + ':generated', kind: 'generated-group', label: 'Generated Sources', branch: true,
      project: project.path, draggable: false, icon: '⚙', children: []};
    const generators = new Map();
    const seen = new Set();
    for (const file of files) {
      const path = file.uri ?? file.path;
      if (!path || seen.has(path)) continue;
      seen.add(path);
      const name = file.generator ?? file.generatorName ?? 'Generated';
      let generator = generators.get(name);
      if (!generator) {
        generator = {id: explorerNodeId('generator', group.id, name), kind: 'generator', label: name,
          project: project.path, branch: true, draggable: false, icon: '⚙', children: []};
        generators.set(name, generator);
        group.children.push(generator);
      }
      generator.children.push({id: explorerNodeId('generated', node.id, path), kind: 'generated', label: baseName(path), path,
        project: project.path, generator: name, icon: 'C#', draggable: false, readOnly: true});
    }
    node.children.push(group);
  }
  const imports = project.importRecords ?? project.imports ?? [];
  if (imports.length) {
    const seen = new Set();
    const group = {id: node.id + ':imports', kind: 'imports', label: 'Imports', project: project.path,
      branch: true, draggable: false, icon: '⇥', children: []};
    for (const value of imports) {
      const item = typeof value === 'string' ? {path: value} : value;
      if (!item.path || seen.has(item.path)) continue;
      seen.add(item.path);
      group.children.push({id: explorerNodeId('import', node.id, item.path), kind: 'import', label: baseName(item.path),
        path: item.path, project: project.path, metadata: item, icon: '⇥', draggable: false, description: item.path});
    }
    node.children.push(group);
  }
}

export function buildUnloadedProject(project) {
  const reason = project.reason ?? project.diagnostic?.message ?? 'Project requires its native toolchain';
  return {id: 'project:' + project.path, kind: 'unloaded-project', label: project.name ?? baseName(project.path),
    path: project.path, project: project.path, unloaded: true, draggable: false, icon: '◇', badge: '⚠', description: reason,
    diagnostic: project.diagnostic ?? {code: 'SFP1301', severity: 'warning', message: reason}};
}
