import {directoryName, baseName} from '../paths.js';
import {ExplorerFolderBuilder, sortExplorerTree} from './tree-folder.js';
import {buildProjectTree} from './tree-project.js';
import {buildUnloadedProject} from './tree-extras.js';
import {attachLazySymbols} from './tree-symbols.js';

function projectOwnership(projects, records) {
  const byDirectory = new Map();
  const result = new Map(projects.map(project => [project.path, []]));
  for (const project of projects) {
    const directory = directoryName(project.path);
    const owners = byDirectory.get(directory) ?? [];
    owners.push(project.path);
    byDirectory.set(directory, owners);
  }
  for (const record of records) {
    let directory = directoryName(record.path ?? record.uri);
    while (!byDirectory.has(directory) && directory) directory = directoryName(directory);
    for (const owner of byDirectory.get(directory) ?? []) result.get(owner).push(record);
  }
  return result;
}

/** Build display-only hierarchy in O(files × path depth + nodes log nodes); no project code is executed. */
export function buildSolutionTree(options = {}) {
  const {name = 'Workspace', files = [], snapshot = null, startup = null, showAll = false, view = 'solution',
    dirty = [], folders = [], generated = [], symbols = [], nesting = true, expanded = new Set()} = options;
  const projects = (snapshot?.projects ?? []).filter(project => !project.unloaded && project.supported !== false);
  const fileMap = new Map(files.map(file => [file.path ?? file.uri, file]));
  const dirtySet = new Set(dirty);
  const folderBuilder = new ExplorerFolderBuilder({dirty: dirtySet});
  const projectCount = snapshot ? projects.length : 1;
  const root = {id: 'solution:' + (snapshot?.solution?.path ?? name), kind: view === 'folders' ? 'workspace' : 'solution',
    label: view === 'folders' ? name : `Solution '${snapshot?.solution?.name ?? name}' (${projectCount} project${projectCount === 1 ? '' : 's'})`,
    path: snapshot?.solution?.path ?? '', icon: '◇', branch: true, defaultExpanded: true, draggable: false, children: []};
  if (view === 'folders' || (!projects.length && !snapshot)) {
    const parent = view === 'folders' ? root : {id: 'project:loose', kind: 'project', label: name, path: '', icon: 'C#',
      branch: true, defaultExpanded: true, startup: true, children: []};
    if (parent !== root) root.children.push(parent);
    for (const [path, file] of fileMap) folderBuilder.file(parent, file, path);
    for (const path of folders) folderBuilder.folder(parent, path);
    attachLazySymbols(root, symbols, {expanded});
    sortExplorerTree(root);
    return [root];
  }
  const logicalFolders = new Map();
  const solutionFolder = path => {
    if (!path) return root;
    let parent = root;
    let current = '';
    for (const segment of path.split('/').filter(Boolean)) {
      current += '/' + segment;
      let folder = logicalFolders.get(current);
      if (!folder) {
        folder = {id: root.id + ':slnfolder:' + current, kind: 'solution-folder', label: segment,
          solutionFolder: current + '/', branch: true, defaultExpanded: true, draggable: false, children: [], icon: '▰'};
        parent.children.push(folder);
        logicalFolders.set(current, folder);
      }
      parent = folder;
    }
    return parent;
  };
  for (const path of snapshot.solution?.folders ?? []) solutionFolder(path);
  const membership = new Map((snapshot.solution?.items ?? []).filter(item => item.kind === 'project').map(item => [item.path, item.folder]));
  const owned = new Set();
  const filesByProject = projectOwnership(projects, files);
  const foldersByProject = projectOwnership(projects, folders.map(path => ({path: path + '/.folder'})));
  for (const project of projects) {
    const generatedFiles = generated.filter(file => (file.project ?? file.projectPath) === project.path ||
      (!(file.project ?? file.projectPath) && projects.length === 1));
    const node = buildProjectTree(project, {fileMap, files: filesByProject.get(project.path), folderBuilder, dirty: dirtySet,
      startup, showAll, folders: foldersByProject.get(project.path).map(file => directoryName(file.path)),
      owned, generated: generatedFiles, nesting});
    solutionFolder(membership.get(project.path)).children.push(node);
  }
  const loaded = new Set(projects.map(project => project.path));
  const placeholders = [...(snapshot.solution?.projects ?? []), ...(snapshot.projects ?? [])];
  for (const project of placeholders) {
    if (loaded.has(project.path) || !project.path) continue;
    loaded.add(project.path);
    owned.add(project.path);
    solutionFolder(membership.get(project.path) ?? project.folder).children.push(buildUnloadedProject(project));
  }
  for (const item of snapshot.solution?.items ?? []) {
    if (item.kind !== 'file') continue;
    folderBuilder.file(solutionFolder(item.folder), fileMap.get(item.path) ?? {kind: 'file'}, item.path, baseName(item.path));
    owned.add(item.path);
  }
  const others = [...fileMap].filter(([path]) => !owned.has(path) && path !== snapshot.solution?.path);
  if (others.length) {
    const group = {id: root.id + ':items', kind: 'solution-folder', label: 'Solution Items', branch: true,
      children: [], icon: '▰', draggable: false};
    for (const [path, file] of others) if (showAll || !/\.cs$/i.test(path)) folderBuilder.file(group, file, path);
    if (group.children.length) root.children.push(group);
  }
  attachLazySymbols(root, symbols, {expanded});
  sortExplorerTree(root);
  return [root];
}
