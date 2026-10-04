/** Returns stable identity records for active windows; a canceled picker never changes attachment. */
export function designerAttachmentItems(sessions) {
  const items = [];
  for (const session of sessions.list()) {
    const windows = session.windows?.length ? session.windows : [{title: session.windowTitle ?? 'Window'}];
    for (const window of windows) {
      const title = window.title ?? window.Title ?? session.windowTitle ?? 'Window';
      items.push({
        sessionId: session.sessionId,
        generation: session.generation,
        ...(window.id !== undefined ? {windowId: window.id} : {}),
        label: `${session.projectName ?? 'Application'} · Session ${session.sessionId} · ${title}`
      });
    }
  }
  return items;
}

export async function chooseDesignerAttachment(view, sessions) {
  const items = designerAttachmentItems(sessions);
  if (!items.length) throw new Error('Run a WinUI application before attaching the designer');
  const label = await view.choose('Attach running application', items.map(item => item.label));
  if (!label) return null;
  const item = items.find(candidate => candidate.label === label);
  if (!item) throw new Error('The selected app is no longer available');
  sessions.resolve(item.sessionId, item.generation);
  return item;
}
