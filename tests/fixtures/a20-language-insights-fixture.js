import {CodeEditor, EditorModel, EditorModelWorkspace, EditorLanguageServices} from '@sharpforge/editor';
import {Workspace} from '@sharpforge/workspace';
import {LanguageService} from '@sharpforge/language';
import {RefactoringEngine} from '@sharpforge/refactoring';

let current;
window.setupLanguageEditor = async text => {
  current?.editor.dispose();
  current?.services.dispose();
  current?.model.dispose();
  const host = document.querySelector('#editor');
  host.replaceChildren();
  host.style.width = '1000px';
  host.style.height = '600px';
  const model = new EditorModel(text, {uri: 'Widget.cs'});
  const workspace = new Workspace({compilationOptions: {outputKind: 'library'}});
  const language = new LanguageService(workspace);
  const refactoring = new RefactoringEngine(workspace, language);
  const services = new EditorLanguageServices();
  const providers = {
    prepareRename: params => language.prepareRename(params.uri, params.offset),
    rename: params => refactoring.rename(params.uri, params.offset, params.newName, params),
    codeActions: params => params.scope ? [refactoring.fixAll(params)] :
      refactoring.actions(params.uri, params.offset, params.end),
    documentSymbols: params => language.documentSymbols(params.uri),
    inlayHints: params => ({version: params.version, items: language.inlayHints(params.uri)}),
    codeLens: params => ({version: params.version, items: language.referenceLenses(params.uri)}),
    references: params => language.references(params.uri, params.offset),
    documentHighlights: params => language.references(params.uri, params.offset)
  };
  for (const [method, provider] of Object.entries(providers)) services.register(method, params => {
    workspace.update(model.uri, model.value, model.version);
    return provider(params);
  });
  const errors = [];
  const editor = new CodeEditor(host, {model, services, workspace: new EditorModelWorkspace(new Map([[model.uri, model]])),
    onError: error => errors.push(error.message)});
  current = {editor, model, services, errors};
  Object.assign(window, current);
  await editor.insights.refresh();
};
await window.setupLanguageEditor('class Widget { static int M(){var first=1;var second=2;return first+second;} }');
