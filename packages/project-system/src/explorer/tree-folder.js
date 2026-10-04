import {normalizePath, baseName} from '../paths.js';
import {explorerNodeId} from './node-identity.js';

const sourcePath = /\.(?:cs|vb|fs)$/i;
const kindOf = path => sourcePath.test(path) ? 'source' : /\.(?:dll|exe)$/i.test(path) ? 'assembly' :
  /\.(?:csproj|fsproj|vbproj)$/i.test(path) ? 'project-file' : 'file';

/** Indexed folder construction is linear in path components and keeps linked appearances separate per project. */
export class ExplorerFolderBuilder {
  constructor({dirty = new Set()} = {}) {
    this.dirty = dirty;
    this.folders = new Map();
  }

  folder(parent, display, extra = {}) {
    const parts = display.split('/').filter(Boolean);
    let current = parent;
    for (let index = 0; index < parts.length; index++) {
      const prefix = parts.slice(0, index + 1).join('/');
      const id = explorerNodeId('folder', parent.id, prefix);
      let folder = this.folders.get(id);
      if (!folder) {
        const path = extra.projectBase ? normalizePath(prefix, extra.projectBase) : prefix;
        folder = {id, kind: 'folder', label: parts[index], path, project: extra.project, branch: true, children: [], icon: '▰'};
        current.children.push(folder);
        this.folders.set(id, folder);
      }
      current = folder;
    }
    return current;
  }

  file(parent, file, path, display = path, extra = {}) {
    const slash = display.lastIndexOf('/');
    const folder = slash < 0 ? parent : this.folder(parent, display.slice(0, slash), extra);
    const kind = file.kind ?? kindOf(path);
    const node = {id: explorerNodeId('file', parent.id, path), kind, label: baseName(display) || baseName(path), path,
      icon: kind === 'source' ? 'C#' : kind === 'assembly' ? '◇' : '≡', dirty: this.dirty.has(path), searchText: path,
      description: path + (extra.linked ? ' (linked item)' : ''), ...extra};
    folder.children.push(node);
    return node;
  }
}

export function sortExplorerTree(node) {
  const priority = kind => kind === 'dependencies' ? 0 : kind === 'folder' || kind === 'solution-folder' ? 1 : 2;
  node.children?.sort((left, right) => priority(left.kind) - priority(right.kind) ||
    left.label.localeCompare(right.label, undefined, {numeric: true, sensitivity: 'base'}) || left.id.localeCompare(right.id));
  node.children?.forEach(sortExplorerTree);
}
