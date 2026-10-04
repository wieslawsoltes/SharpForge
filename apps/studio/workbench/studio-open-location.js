/** Honor preview/group policy before synchronous Studio activation, retaining one deliberate history entry. */
export function createStudioLocationOpener({ docking, navigation, openFile }) {
  let queue = Promise.resolve();
  const open = async location => {
    if (!location || typeof location.uri !== 'string') throw new TypeError('A document location is required');
    const view = { viewId: location.viewId ?? 'primary', groupId: location.groupId };
    const offset = location.start ?? location.offset ?? null;
    const token = navigation.beforeOpen({ uri: location.uri, offset, view });
    let opened = false;
    try {
      const panelId = await docking.tabs.open(location.uri, { ...view, preview: location.preview === true });
      if (!panelId) return null;
      if (location.preview !== true) docking.tabs.promote(panelId);
      openFile(location.uri, offset, location.end ?? offset, { ...view, panelId });
      opened = true;
      return panelId;
    } finally {
      navigation.afterJump(token, { record: opened });
    }
  };
  return location => {
    const operation = queue.then(() => open(location));
    queue = operation.catch(() => {});
    return operation;
  };
}
