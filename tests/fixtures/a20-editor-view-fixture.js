import {CodeEditor, EditorModel, EditorLanguageServices} from '../../packages/editor/src/index.js';

window.setupView = ({text = '', options = {}, providers = {}} = {}) => {
  window.editor?.dispose();
  window.published = [];
  const model = new EditorModel(text, {uri: 'view.cs'});
  const services = new EditorLanguageServices({folding: async () => [], ...providers});
  window.editor = new CodeEditor(document.getElementById('editor'), {model, options, services,
    onEdits: change => window.published.push({version: change.version, changes: change.changes})});
  window.editor.focus();
  return true;
};
window.viewSettled = async () => {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.editor.view.render();
};
window.nativeContextLength = () => Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').get.call(window.editor.input).length;
window.sourceRows = () => [...window.editor.view.lines.visible.values()].map(row => ({
  line: Number(row.dataset.line), start: Number(row.dataset.start),
  text: [...row.querySelectorAll('[data-offset]')].map(span => span.textContent).join('')
}));
window.setupView();
