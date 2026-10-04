import {directoryName, baseName} from '../paths.js';
import {relativeTo} from './solution-edits.js';
import {buildDependencyTree} from './tree-dependencies.js';
import {appendProjectExtras} from './tree-extras.js';
import {applyFileNesting} from './file-nesting.js';

/** Build one evaluated project's physical, linked, dependency and generated appearances. */
export function buildProjectTree(project, context) {
  const {fileMap, files, folderBuilder, dirty, startup, showAll, folders, owned, generated, nesting} = context;
  const base = directoryName(project.path);
  const node = {id: 'project:' + project.path, kind: 'project', label: project.name ?? baseName(project.path),
    path: project.path, project: project.path, projectBase: base, icon: 'C#', branch: true, defaultExpanded: true,
    startup: project.path === startup, draggable: false, children: []};
  node.children.push(buildDependencyTree(project, node.id));
  const included = new Set();
  const addItem = (item, itemType) => {
    if (!item.path || included.has(item.path)) return;
    included.add(item.path);
    const raw = item.metadata?.Link ?? item.link ?? relativeTo(item.path, base);
    const outside = raw.startsWith('../');
    const display = outside ? 'Linked Files/' + baseName(item.path) : raw;
    folderBuilder.file(node, fileMap.get(item.path) ?? {path: item.path, kind: itemType === 'Compile' ? 'source' : undefined},
      item.path, display, {project: project.path, projectBase: base, included: true, itemType,
        linked: !!item.metadata?.Link || !!item.link || outside, missing: !fileMap.has(item.path), metadata: item.metadata});
    owned.add(item.path);
  };
  for (const item of project.compile ?? []) addItem(item, 'Compile');
  for (const item of project.items ?? []) {
    if (!item.path) continue;
    if (item.itemType === 'Folder') folderBuilder.folder(node, relativeTo(item.path, base), {project: project.path, projectBase: base});
    else addItem(item, item.itemType);
  }
  for (const file of files) {
    const path = file.path ?? file.uri;
    if (included.has(path) || path === project.path) continue;
    const source = (file.kind ?? (/\.cs$/i.test(path) ? 'source' : 'file')) === 'source';
    if (!showAll && source) continue;
    folderBuilder.file(node, file, path, relativeTo(path, base), {project: project.path, projectBase: base,
      excluded: source, included: false});
    owned.add(path);
  }
  node.children.push({id: node.id + ':xml', kind: 'project-file', label: baseName(project.path), path: project.path,
    project: project.path, icon: '⚙', draggable: false, dirty: dirty.has(project.path)});
  owned.add(project.path);
  for (const path of folders) {
    const display = relativeTo(path, base);
    if (display && !display.startsWith('../')) folderBuilder.folder(node, display, {project: project.path, projectBase: base});
  }
  applyFileNesting(node, {enabled: nesting});
  appendProjectExtras(node, project, generated);
  return node;
}
