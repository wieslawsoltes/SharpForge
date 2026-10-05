import {validateItemPath} from '@sharpforge/project-system';

export const pathDirectory = path => path?.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
export const pathName = path => path?.split('/').at(-1) ?? '';
export const pathWithin = (path, root) => path === root || path.startsWith(root + '/');
export const mapExplorerPath = (path, mappings) => {
  const mapping = path && mappings.find(item => pathWithin(path, item.from));
  return mapping ? mapping.to + path.slice(mapping.from.length) : path;
};
export const xmlWorkspacePath = path => /\.(?:csproj|slnx|props|targets|resx|resw|xml)$/i.test(path);

export function destinationFolder(node) {
  if (node?.kind === 'folder') return node.path;
  if (node?.kind === 'project') return pathDirectory(node.path);
  if (node?.kind === 'solution-folder') return '';
  return node?.project ? pathDirectory(node.project) : node?.path ? pathDirectory(node.path) : '';
}

export function requireDropTarget(node) {
  if (!['project', 'folder', 'solution', 'workspace', 'solution-folder'].includes(node?.kind)) {
    throw new Error('Select a destination project or folder; this item cannot contain files');
  }
}

/** Validate each requested mutation before any prompts or effects; rejected items remain visible to the caller. */
export function inspectMoveBatch(context, mappings, {copy = false, allowProjectRename = false} = {}) {
  const selected = new Set();
  const planned = new Set();
  const results = [];
  for (const mapping of mappings) {
    let reason = null;
    try {
      if (context.readOnly) throw new Error('Stop debugging before changing files');
      const from = validateItemPath(mapping.from);
      const to = validateItemPath(mapping.to);
      if (selected.has(from) || mappings.some(other => other !== mapping && pathWithin(from, other.from))) {
        throw new Error('Select each physical item once without overlapping parent folders');
      }
      selected.add(from);
      if (from === to || pathWithin(to, from)) throw new Error('Choose another destination; an item cannot contain itself');
      const identity = to.normalize('NFC').toLowerCase();
      if (planned.has(identity)) throw new Error('Two selected items have the same destination');
      planned.add(identity);
      if (![...context.records, ...(context.folders ?? []).map(path => ({path}))].some(record => pathWithin(record.path, from))) {
        throw new Error('Source no longer exists: ' + from);
      }
      const collides = [...context.records.map(record => record.path), ...(context.folders ?? [])].some(path => {
        const normalized = path.normalize('NFC').toLowerCase();
        return normalized === identity || normalized.startsWith(identity + '/');
      });
      if (collides) throw new Error('Destination already exists: ' + to);
      const projectFiles = context.records.filter(record => pathWithin(record.path, from) && /\.(?:csproj|vbproj|fsproj)$/i.test(record.path));
      if (projectFiles.length && !(allowProjectRename && !copy && projectFiles.length === 1 && from === projectFiles[0].path &&
          pathDirectory(from) === pathDirectory(to))) {
        throw new Error('Moving folders containing project files requires explicit project relocation; unsafe project move rejected');
      }
    } catch (error) { reason = error.message; }
    results.push({...mapping, status: reason ? 'rejected' : 'ready', reason});
  }
  return results;
}

/** Partial batch execution requires a distinct confirmation after every rejected item has been listed. */
export async function confirmMoveBatch(host, results) {
  const valid = results.filter(item => item.status === 'ready');
  const rejected = results.filter(item => item.status === 'rejected');
  if (!rejected.length) return valid;
  if (!valid.length) throw new Error(rejected.map(item => item.from + ': ' + item.reason).join('\n'));
  const confirmed = await host.confirm('Complete valid items only?', rejected.map(item => item.from + ': ' + item.reason),
    `${valid.length} valid item(s) can complete. The rejected items above will remain unchanged.`);
  if (!confirmed) return [];
  host.notice(rejected.map(item => item.from + ': ' + item.reason).join('\n'));
  return valid;
}
