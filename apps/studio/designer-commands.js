export const designerCommandIds = Object.freeze({viewDesigner: 'viewDesigner', viewCode: 'viewCode', openWithDesigner: 'openWithDesigner'});

/** Contributions share one URI-aware enabled predicate, including explorer items and F7/Shift+F7. */
export function contributeDesignerCommands(registry, {documents, getActiveUri, target = null, onError = null}) {
  const report = onError ?? (error => { throw error; });
  const currentUri = () => getActiveUri?.() ?? documents.state.active;
  const compatible = uri => !!uri && (documents.get(uri) !== null || documents.probe(uri).compatible);
  const canView = (mode, uri = currentUri()) => compatible(uri) && (mode !== 'code' || !/\.sfdesign\.json$/i.test(uri));
  const open = (mode, uri = currentUri()) => {
    if (!canView(mode, uri)) throw new Error('Select a compatible C# document to use this command.');
    return documents.open(uri, mode);
  };
  const disposables = [
    registry.registerCommand(designerCommandIds.viewDesigner, 'View Designer', 'Shift+F7', (_id, uri) => open('design', uri), {
      enabled: invocation => canView('design', invocation.args?.[0]) || 'Command is unavailable: View Designer'
    }),
    registry.registerCommand(designerCommandIds.viewCode, 'View Code', 'F7', (_id, uri) => open('code', uri), {
      enabled: invocation => canView('code', invocation.args?.[0]) || 'Command is unavailable: View Code'
    }),
    registry.registerCommand(designerCommandIds.openWithDesigner, 'Open With Designer', '', (_id, uri) => open('design', uri), {
      enabled: invocation => canView('design', invocation.args?.[0]) || 'Command is unavailable: Open With Designer'
    })
  ];
  const keydown = event => {
    if (event.defaultPrevented || event.isComposing || event.key !== 'F7' || event.altKey || event.ctrlKey || event.metaKey) return false;
    const mode = event.shiftKey ? 'design' : 'code';
    if (!canView(mode)) return false;
    event.preventDefault();
    event.stopPropagation();
    Promise.resolve(open(mode)).catch(report);
    return true;
  };
  if (target) {
    target.addEventListener('keydown', keydown);
    disposables.push(() => target.removeEventListener('keydown', keydown));
  }
  return {
    canView,
    keydown,
    viewDesigner: uri => open('design', uri),
    viewCode: uri => open('code', uri),
    menuItems(node) {
      const uri = node?.path ?? node?.uri;
      if (!uri || !/\.(?:cs|sfdesign\.json)$/i.test(uri) || !compatible(uri)) return [];
      return [
        {label: 'View Designer', shortcut: 'Shift+F7', enabled: () => canView('design', uri), action: () => open('design', uri)},
        {label: 'View Code', shortcut: 'F7', enabled: () => canView('code', uri), action: () => open('code', uri)},
        {label: 'Open With Designer', enabled: () => canView('design', uri), action: () => open('design', uri)}
      ];
    },
    dispose() { for (const dispose of disposables.splice(0)) dispose(); }
  };
}
