import { CodeEditor, EDITOR_KEYMAPS } from '../src/index.js';

const profile = document.querySelector('#profile');
const status = document.querySelector('#status');
const editor = new CodeEditor(document.querySelector('#editor'), {
  onKeymapState: state => { status.textContent = `${state.keymap}: ${state.mode}`; },
  request: method => { throw new Error(`The standalone example has no workspace provider for '${method}'`); }
});
editor.setModel('Example.cs', 'class Example\n{\n    static int Twice(int value) => value * 2;\n}\n');
for (const item of EDITOR_KEYMAPS) {
  const option = document.createElement('option');
  option.value = item.id;
  option.textContent = item.name ?? item.label ?? item.id;
  profile.append(option);
}
profile.onchange = () => editor.setKeymap(profile.value);
window.addEventListener('pagehide', () => editor.dispose(), { once: true });
