/** Closing every other source uses the same asynchronous release boundary as a single tab close. */
export async function closeOtherSourceDocuments({state, docking, openFile}, retainedId) {
  for (const uri of [...state.tabs]) {
    const id = 'source:' + uri;
    if (id === retainedId) continue;
    docking.layout.close(id);
    await docking.host.onClose(id);
  }
  return openFile(retainedId.slice('source:'.length));
}
