/** Drag packets are data-only and routed to the root-owned manager, never reflected into public node properties. */
export function applyDragCommand(host, command) {
  if (command.op === 'dragData') {
    if (command.data == null) host.input.dragDrop.prepared.delete(command.id);
    else host.input.dragDrop.prepare(command.id, command.data, command);
    return true;
  }
  if (command.op === 'dragResponse') { host.input.dragDrop.reply(command); return true; }
  return false;
}
