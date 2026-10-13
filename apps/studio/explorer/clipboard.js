import {pathName, pathDirectory, destinationFolder, requireDropTarget} from './guards.js';

/** Collision naming is deterministic and compares using portable case/Unicode identity. */
export function copyDestination(path, occupied) {
  const canonical = value => value.normalize('NFC').toLowerCase();
  const names = new Set([...occupied].map(canonical));
  if (!names.has(canonical(path))) return path;
  const directory = pathDirectory(path);
  const name = pathName(path);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  for (let number = 1; number < 20000; number++) {
    const candidate = (directory ? directory + '/' : '') + stem + ' - Copy' + (number === 1 ? '' : ` (${number})`) + extension;
    if (!names.has(canonical(candidate))) return candidate;
  }
  throw new Error('Explorer copy collision limit exceeded');
}

export function registerClipboardCommands(registry) {
  for (const action of ['copy', 'cut']) registry.set(action, {mutates: action === 'cut', execute: async ({commands, context, nodes}) => {
    const files = commands.files(nodes);
    if (files.length !== nodes.length || !files.length) throw new Error('Select files or physical folders to copy or move');
    commands.clipboard = {identity: context.identity, cut: action === 'cut', nodes: files.map(node => ({...node, children: undefined}))};
    commands.host.notice(`${files.length} item(s) ${action === 'cut' ? 'cut' : 'copied'}. Choose a destination and Paste.`);
  }});
  for (const action of ['paste', 'copy-to', 'move-to']) registry.set(action, {mutates: true, execute: async ({commands, context, node, nodes}) => {
    const clipboard = action === 'paste' ? commands.clipboard : {nodes: commands.files(nodes), cut: action === 'move-to', identity: context.identity};
    if (!clipboard?.nodes.length || clipboard.identity !== context.identity) throw new Error('The explorer clipboard belongs to another workspace');
    requireDropTarget(node);
    if (node.kind === 'solution-folder' && clipboard.cut) {
      return commands.registry.get('solution-add-items').execute({commands, context, node, nodes: clipboard.nodes});
    }
    const destination = destinationFolder(node);
    const occupied = new Set([...context.records.map(record => record.path), ...(context.folders ?? [])]);
    const mappings = clipboard.nodes.map(file => {
      let to = (destination ? destination + '/' : '') + pathName(file.path);
      if (!clipboard.cut) to = copyDestination(to, occupied);
      occupied.add(to);
      return {from: file.path, to};
    });
    const result = await commands.move(mappings, !clipboard.cut, node?.project, {destinationNode: node});
    if (action === 'paste' && clipboard.cut && result?.completed?.length) commands.clipboard = null;
    return result;
  }});
}
