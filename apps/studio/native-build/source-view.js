import {escapeHtml as escape} from '@sharpforge/editor';
import {createWorkspaceSlnx} from '@sharpforge/msbuild';
import {createCsproj} from '@sharpforge/project-system';
import {reportAction} from './settings.js';

function createFile(host, extension) {
  if (!host.client) throw new Error('Connect the local host first');
  const name = globalThis.prompt('New workspace-relative filename (parent folder must exist)', 'New' + extension);
  if (!name) return;
  if (!name.toLowerCase().endsWith(extension)) throw new Error('Use ' + extension);
  if (host.workspace.files.some(file => file.path === name) || host.buffers.has(name)) throw new Error('File already exists');
  const text = extension === '.csproj' ? createCsproj() : createWorkspaceSlnx(name, host.workspace?.projects ?? []);
  host.buffers.set(name, {path: name, text, baseline: '', hash: null});
  host.sourcePath = name;
  host.renderSource(true);
}

function markup(host) {
  const buffer = host.buffers.get(host.sourcePath);
  const files = (host.workspace?.files ?? []).filter(file => file.kind !== 'source');
  return `<div class="tool-page native-project-source"><h2>Project / Solution Source</h2>
    <p>Edit projects, solutions, imported props/targets and configuration files. Save detects changes made on disk.</p>
    <select class="native-source-picker" aria-label="Native project file"><option value="">Choose a file…</option>
      ${files.map(file => `<option value="${escape(file.path)}" ${file.path === host.sourcePath ? 'selected' : ''}>
        ${escape(file.path)}</option>`).join('')}</select>
    <div class="tool-actions"><button class="button" data-native-source-save>Save all changes</button>
      <button class="button" data-native-solution-inspect ${/\.slnx$/i.test(host.sourcePath ?? '') ? '' : 'disabled'}>
        Inspect solution structure</button>
      <button class="button" data-native-new-project>New .csproj</button><button class="button" data-native-new-solution>New .slnx</button></div>
    <p class="native-source-status" role="status"></p>
    <textarea class="native-xml-editor" aria-label="Native project XML or configuration source" spellcheck="false"
      ${buffer ? '' : 'disabled'}>${escape(buffer?.text ?? '')}</textarea></div>`;
}

function bindSource(host, element) {
  const act = action => reportAction(host, action);
  element.querySelector('.native-source-picker').onchange = event => { if (event.target.value) act(() => host.open(event.target.value)); };
  element.querySelector('[data-native-source-save]').onclick = () => act(() => host.save());
  element.querySelector('[data-native-solution-inspect]').onclick = () => act(() => host.inspectSolution());
  const area = element.querySelector('.native-xml-editor');
  area.oninput = () => {
    const current = host.buffers.get(host.sourcePath);
    if (current) { current.text = area.value; host.renderSource(); }
  };
  area.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      event.stopPropagation();
      act(() => host.save());
    }
  });
  element.querySelector('[data-native-new-project]').onclick = () => act(() => createFile(host, '.csproj'));
  element.querySelector('[data-native-new-solution]').onclick = () => act(() => createFile(host, '.slnx'));
}

export function renderNativeSource(host, force = false) {
  const element = host.hosts.get('project-source');
  if (!element) return;
  if (force || !element.querySelector('.native-project-source')) {
    element.innerHTML = markup(host);
    bindSource(host, element);
  }
  const buffer = host.buffers.get(host.sourcePath);
  element.querySelector('.native-source-status').textContent = buffer ? `${buffer.path} · ` +
    (buffer.text !== buffer.baseline || buffer.hash === null ? 'unsaved changes' : 'matches loaded disk snapshot') : 'No file selected.';
}

export function renderNativeTree(host, element, query = '') {
  const files = (host.workspace?.files ?? []).filter(file => file.path.toLowerCase().includes(query.toLowerCase())).slice(0, 500);
  element.innerHTML = '<div class="native-tree-caption">LOCAL MSBUILD WORKSPACE</div>' + files.map(file =>
    `<button class="file-row" data-native-file="${escape(file.path)}"><span class="file-icon">${file.kind === 'source' ? 'C#' : '≡'}</span>
      <span>${escape(file.path)}</span></button>`).join('') + (files.length === 500 ? '<p>Showing 500 files. Narrow the filter.</p>' : '');
  for (const button of element.querySelectorAll('[data-native-file]')) {
    button.onclick = () => reportAction(host, () => host.open(button.dataset.nativeFile));
  }
}
