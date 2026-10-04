import { normalizePath } from '@sharpforge/project-system';

/** Split one exact document view, resolving optional Vim filenames through the existing workspace opener. */
async function splitDocument(context, panel, uri, axis, path) {
  const { documents, docking } = context;
  const groupId = docking.layout.locate(panel).group?.id;
  if (!groupId) throw new Error('No active document group');
  const target = path === undefined || path === '' ? uri : normalizePath(path);
  if (target === uri) return docking.tabs.newView(panel, { axis });
  if (!documents.get(target)) throw new Error('Split target is not a source document in the current workspace: ' + target);
  if (await context.openPath(target) === false) return false;
  if (!docking.layout.group(groupId)) throw new Error('The original document group was removed while opening the split source');
  const next = docking.tabs.panel(target, documents.activeViews.get(target) ?? 'primary');
  if (!next || !docking.layout.locate(next).group) throw new Error('The requested split source was not opened');
  docking.tabs.split(next, axis, { groupId });
  docking.tabs.activate(next);
  return next;
}

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
      return splitDocument(context, panel, uri, method === 'splitHorizontal' ? 'horizontal' : 'vertical', params.path);
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
