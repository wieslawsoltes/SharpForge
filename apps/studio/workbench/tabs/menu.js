/** Document-tab commands share the same close pipeline as keyboard and Window-menu actions. */
export function documentTabMenu(tabs, id, { host, copyPath, revealFile } = {}) {
  const view = tabs.metadata(id);
  if (!view) return null;
  const location = tabs.layout.locate(id);
  const group = location.group;
  const open = tabs.list();
  const pinned = Boolean(tabs.layout.state.tabState[id]?.pinned);
  const groups = tabs.layout.groups().filter(item => item.kind === 'document');
  const item = (command, title, execute, enabled = true) => ({ id: command, title, execute, enabled });
  return [
    item('document.save', 'Save', () => tabs.documents.save(view.uri), Boolean(tabs.documents.get(view.uri)?.dirty)),
    item('document.pin', pinned ? 'Unpin Tab' : 'Pin Tab', () => tabs.pin(id, !pinned)),
    item('document.promote', 'Keep Tab Open', () => tabs.promote(id), Boolean(tabs.layout.state.tabState[id]?.preview)),
    null,
    item('document.close', 'Close', () => tabs.close(id)),
    item('document.closeAll', 'Close All Tabs', () => tabs.closeVariant(id, 'all'), open.length > 0),
    item('document.closeOthers', 'Close All But This', () => tabs.closeVariant(id, 'others'),
      open.some(other => other !== id && !tabs.layout.state.tabState[other]?.pinned)),
    item('document.closeUnpinned', 'Close All But Pinned', () => tabs.closeVariant(id, 'unpinned'),
      open.some(other => !tabs.layout.state.tabState[other]?.pinned)),
    item('document.closeRight', 'Close To The Right', () => tabs.closeVariant(id, 'right'),
      Boolean(group?.panels.slice(location.index + 1).some(other => tabs.metadata(other) && !tabs.layout.state.tabState[other]?.pinned))),
    item('document.reopen', 'Reopen Closed Tab', () => tabs.reopenClosed(), tabs.closed.length > 0),
    null,
    item('document.copyPath', 'Copy Full Path', () => copyPath(view.uri), typeof copyPath === 'function'),
    item('document.revealFolder', 'Open Containing Folder', () => revealFile(view.uri), typeof revealFile === 'function'),
    null,
    item('document.splitHorizontal', 'New Horizontal Document Group', () => tabs.split(id, 'horizontal'), Boolean(group)),
    item('document.splitVertical', 'New Vertical Document Group', () => tabs.split(id, 'vertical'), Boolean(group)),
    item('document.moveNextGroup', 'Move to Next Tab Group', () => tabs.moveGroup(id, 1), groups.length > 1),
    item('document.movePreviousGroup', 'Move to Previous Tab Group', () => tabs.moveGroup(id, -1), groups.length > 1),
    item('document.newWindow', 'New Window', () => tabs.newView(id)),
    item('window.float', 'Float', () => tabs.layout.float(id)),
    item('window.floatGroup', 'Float Entire Tab Group', () => tabs.layout.floatGroup(group.id), Boolean(group)),
    item('window.popout', 'Open Separate Browser Window', () => host.popout(id), Boolean(host))
  ];
}
