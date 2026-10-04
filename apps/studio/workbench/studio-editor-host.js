/** Shared host commands for the editor, Vim ex commands and workbench menus. */
export function createStudioEditorHost(context) {
  return async (method, params = {}) => {
    const { documents, docking } = context;
    const uri = params.uri ?? documents.active;
    const panel = docking.tabs.panel(uri, documents.activeViews.get(uri) ?? 'primary') ?? `source:${uri}`;
    const aliases = {
      findFiles: 'findFiles', replaceFiles: 'workbench.replaceFiles', navigateTo: 'workbench.goToAll',
      goto: 'workbench.goToLine', commands: 'commands', settings: 'workbench.options',
      keyboardSettings: 'workbench.keyboard', navigateBack: 'navigateBack', navigateForward: 'navigateForward'
    };
    if (method === 'save') return documents.save(uri);
    if (method === 'saveAll') return context.saveAll();
    if (method === 'newDocument') return context.newDocument();
    if (method === 'closeDocument') return docking.tabs.close(panel);
    if (method === 'closeAllDocuments') return docking.tabs.closeVariant(panel, 'all');
    if (method === 'reopenClosedDocument') return docking.tabs.reopenClosed();
    if (method === 'splitVertical' || method === 'splitHorizontal') {
      const id = await docking.tabs.newView(panel);
      if (method === 'splitHorizontal') docking.tabs.split(id, 'horizontal');
      return id;
    }
    if (method === 'openDocumentPrompt') {
      const path = await context.pathDialog('Open Workspace File', uri ?? 'Program.cs');
      return path ? context.openPath(path) : false;
    }
    if (method === 'openDocument') return context.openPath(params.path ?? params.uri);
    if (method === 'nextDocument' || method === 'previousDocument') {
      const tabs = documents.tabs.filter(value => documents.get(value));
      if (!tabs.length) return false;
      const index = tabs.indexOf(uri);
      const next = tabs[(index + (method === 'nextDocument' ? 1 : -1) + tabs.length) % tabs.length];
      context.navigate({ uri: next });
      return true;
    }
    if (['definition', 'references', 'rename', 'codeActions', 'format'].includes(method)) {
      return context.language(method, { uri, ...params });
    }
    const command = aliases[method] ?? method;
    if (!context.commands.describe(command)) throw new Error(`Host command '${method}' is not available`);
    return context.commands.execute(command, params);
  };
}
