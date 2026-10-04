import { createWorkbenchShell } from './shell.js';
import { StudioKeyboard } from './studio-keyboard.js';
import { createEditorOptionsPage } from '@sharpforge/editor';

/** Connect workbench surfaces through public services and the current document view. */
export function mountStudioShell(context) {
  const { document, commands, services, state, docking } = context;
  const keyboard = new StudioKeyboard({
    commands, getEditor: context.getEditor, context: () => shell?.context() ?? {},
    platform: /Mac|iPhone|iPad/.test(document.defaultView.navigator.platform) ? 'mac' : 'windows',
    onStatus: context.onStatus, onError: context.onError
  });
  let shell = createWorkbenchShell({
    document, root: document.querySelector('#app'), commands, keybindings: keyboard, services, state, docking,
    requestCompiler: context.requestCompiler, navigate: context.navigate,
    readAssemblyReference: context.readAssemblyReference,
    getEditor: context.getEditor, designer: context.designer, download: context.download,
    applyEdits: context.applyEdits, projectData: context.projectData, setKeymap: context.setKeymap,
    applyKeybindings: bindings => keyboard.apply(bindings), editorOptionsPage: createEditorOptionsPage,
    applySettings: settings => {
      for (const views of services.documents.views.values()) for (const { editor } of views.values()) {
        if (context.configureEditor) context.configureEditor(editor, settings);
        else editor.updateOptions(settings.editor);
      }
    },
    applyConfiguration: context.applyConfiguration, importFiles: context.importFiles, openRecent: context.openRecent,
    readDisk: context.readDisk, reloadDocument: context.reloadDocument, restoreFiles: context.restoreFiles,
    readDocument: uri => services.documents.get(uri), onError: context.onError
  });
  const menuHost = document.querySelector('.menubar');
  menuHost.replaceChildren();
  const toolbarHost = document.createElement('div');
  toolbarHost.className = 'studio-workbench-toolbars';
  document.querySelector('.toolbar').after(toolbarHost);
  const statusHost = document.createElement('div');
  statusHost.className = 'studio-workbench-status';
  document.querySelector('.statusbar').before(statusHost);
  shell.mount({ menuHost, toolbarHost, statusHost });
  keyboard.install(document);
  keyboard.profile(state().keymap);
  for (const views of services.documents.views.values()) for (const { editor } of views.values()) keyboard.attach(editor);
  return { shell, keyboard };
}
