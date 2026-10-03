import {CodeEditor} from '../src/index.js';

const status = document.querySelector('#status');
const editor = new CodeEditor(document.querySelector('#editor'), {
  onEdits: event => { status.textContent = `Document version ${event.version}; ${event.changes.length} atomic edits`; },
  onCursor: position => { status.textContent = `Line ${position.line + 1}, character ${position.character + 1}, ${position.carets} carets`; }
});
editor.setModel('Example.cs', '#region Example\nclass Example\n{\n    string greeting = "日本語 · مرحبا · 👩‍💻";\n\n    void Run()\n    {\n        Console.WriteLine(greeting);\n    }\n}\n#endregion\n');
for (const [id, command] of Object.entries({wrap: 'view.toggleWrap', whitespace: 'view.toggleWhitespace',
  split: 'split.toggle', fold: 'outlining.collapseAll', bookmark: 'bookmark.toggle'})) {
  document.getElementById(id).onclick = () => editor.runCommand(command);
}
document.querySelector('#save').onclick = () => { editor.prepareSave(); editor.markSaved(); };
document.querySelector('#large').onclick = async () => {
  const chunk = 'int value = 42; // virtual source line\n'.repeat(5000);
  const file = new Blob(Array.from({length: 100}, () => chunk));
  await editor.loadFile(file, {onProgress: progress => { status.textContent = `Loading ${progress.loaded} / ${progress.total} bytes`; }});
  editor.gotoLine(450000);
};
window.editor = editor;
window.addEventListener('pagehide', () => editor.dispose(), {once: true});
