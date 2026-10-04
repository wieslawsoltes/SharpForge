import { DockLayout, DockHost, createGroup, createSplit } from '../src/index.js';

const definitions = [
  { id: 'document-a', title: 'Program.cs', kind: 'document' },
  { id: 'document-b', title: 'App.cs', kind: 'document' },
  { id: 'watch', title: 'Watch 1' },
  { id: 'output', title: 'Output' },
  { id: 'solution', title: 'Solution Explorer' }
];
const initial = {
  version: 1,
  root: createSplit('main', 'horizontal', createGroup('tools', ['watch', 'output']),
    createGroup('documents', ['document-a', 'document-b'], 'document'), .25),
  floating: [],
  autoHide: { left: [], right: [], top: [], bottom: [] },
  closed: ['solution'],
  activePanel: 'document-a'
};
const layout = new DockLayout(definitions, initial);
const status = document.querySelector('#status');
const content = new Map();
const host = new DockHost(document.querySelector('#workspace'), layout, {
  resolveContent(id) {
    if (content.has(id)) return content.get(id);
    const element = document.createElement('div');
    element.className = 'example-content';
    if (id.startsWith('document-')) {
      const textarea = document.createElement('textarea');
      textarea.setAttribute('aria-label', layout.require(id).title);
      textarea.value = id === 'document-a' ? 'Console.WriteLine("Hello, docking");' : 'public class App { }';
      element.append(textarea);
    } else {
      const title = document.createElement('h2');
      title.textContent = layout.require(id).title;
      const input = document.createElement('input');
      input.placeholder = 'State survives docking and popouts';
      input.setAttribute('aria-label', `${layout.require(id).title} value`);
      element.append(title, input);
    }
    content.set(id, element);
    return element;
  },
  onActivate(id) { status.textContent = `Active: ${layout.require(id).title}`; },
  onError(error) { status.textContent = error.message; },
  onWindowKeyDown(event) {
    if (event.key === 'F5') {
      event.preventDefault();
      status.textContent = 'F5 forwarded from the popped-out document';
    }
  }
});
document.querySelector('#auto-hide').onclick = () => layout.autoHideAll();
document.querySelector('#float-group').onclick = () => {
  if (layout.group('tools')) layout.floatGroup('tools');
};
document.querySelector('#restore').onclick = () => layout.restore(initial);
document.querySelector('#undo').onclick = () => layout.undo();
document.querySelector('#redo').onclick = () => layout.redo();
window.dockingDemo = { layout, host, content, initial };
