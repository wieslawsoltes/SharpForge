import {createDesign, createDesignerRoot, createDesignerResourceDocument,
  generateDesignCode, generateDesignProject, generateDesignerResourceClass} from '@sharpforge/designer';
import {escapeHtml} from '@sharpforge/editor';
import {assertDesignerResourceAction, isDesignerResourceDocument} from './designer-resource-context.js';

/** Feature controllers contribute actions through explicit composition rather than a shared switch. */
export function createDesignerActions(view) {
  return new Map(Object.entries({
    new: () => createNewDocument(view),
    open: () => openDesignDocument(view),
    save: () => view.save(),
    download: () => view.download(view.path, view.document.serialize(), 'application/json'),
    undo: () => view.undo(),
    redo: () => view.undo(true),
    delete: () => { view.outline?.assertEditable(); return view.document.remove(); },
    duplicate: () => { view.outline?.assertEditable(); return view.document.duplicate(); },
    parent: () => {
      const parent = view.document.parent(view.document.selection[0]);
      if (parent) view.document.select(parent.id);
    },
    properties: () => view.docking.activate(isDesignerResourceDocument(view) ? 'designer-styles' : 'designer-properties'),
    rename: () => view.outline.rename(),
    cut: () => copySelection(view, true),
    copy: () => copySelection(view),
    paste: () => {
      if (!view.clipboard) throw new Error('No design selection copied');
      view.outline?.assertEditable();
      return view.document.paste(view.clipboard, view.clipboardSelection);
    },
    fit: () => view.surface.fitAll(),
    'fit-selection': () => view.surface.fitSelection(),
    preview: () => {
      view.preview = !view.preview;
      view.status = view.preview ? 'Interactive preview · run the application to execute managed handlers' : 'Design mode';
      view.resizeArtboard();
      view.statusElement.textContent = view.status;
    },
    attach: () => view.attach(),
    'run-app': () => view.launchDesignerApp({uri: view.session.kind === 'csharp' ? view.session.uri : undefined}),
    apply: () => view.applyLive(),
    source: () => {
      if (view.session.kind !== 'design') return view.documentHost.setMode('code');
      return exportGeneratedSource(view);
    },
    generate: async () => {
      const records = generateDesignProject(view.document.value);
      await view.createWorkspace(records);
      await view.runApplication();
      view.status = 'Generated project is running. Attach it to edit live state.';
    },
    options: () => view.options.open()
  }).map(([id, action]) => [id, () => { assertDesignerResourceAction(view, id); return action(); }]));
}

async function createNewDocument(view) {
  const root = await view.choose('New designer document', ['Window', 'UserControl', 'Page', 'ContentDialog', 'Resources']);
  if (!root) return;
  const document = root === 'Window' ? createDesign() : root === 'Resources' ?
    createDesignerResourceDocument().value : createDesignerRoot(root).value;
  return view.createDesignDocument ? view.createDesignDocument(document) : view.replace(document);
}

function copySelection(view, cut = false) {
  if (cut) view.outline?.assertEditable();
  view.clipboard = view.document.snapshot();
  view.clipboardSelection = [...view.document.selection];
  if (cut) view.document.remove();
  view.status = cut ? 'Design selection cut' : 'Design selection copied';
  view.accessibility?.announce(view.status);
}

async function openDesignDocument(view) {
  const records = view.records().filter(record => record.path.endsWith('.sfdesign.json'));
  if (records.length) {
    const selected = await view.choose('Open design document', records.map(record => record.path));
    if (selected) return view.openDesignDocument?.(selected) ?? view.replace(JSON.parse(records.find(record =>
      record.path === selected).text), {path: selected});
    return;
  }
  const input = view.stage.ownerDocument.createElement('input');
  input.type = 'file';
  input.accept = '.sfdesign.json,.json';
  input.onchange = () => view.safe(async () => {
    const file = input.files[0];
    if (!file) return;
    const value = JSON.parse(await file.text());
    if (view.createDesignDocument) return view.createDesignDocument(value, file.name);
    view.replace(value, {path: file.name.endsWith('.sfdesign.json') ? file.name : 'View.sfdesign.json'});
  });
  input.click();
}

function exportGeneratedSource(view) {
  const source = view.document.value.documentKind === 'resources' ? generateDesignerResourceClass(view.document.value) :
    generateDesignCode(view.document.value, {target: 'winui'});
  view.download(view.path.replace(/\.sfdesign\.json$/i, '.g.cs'), source, 'text/plain');
}

/** Legacy source export panel remains available to automation; C# documents use their permanent source editor. */
export function renderDesignerSource(view) {
  const panel = view.panel('designer-source');
  if (!panel) return;
  let source;
  try { source = view.document.value.documentKind === 'resources' ? generateDesignerResourceClass(view.document.value) :
    generateDesignCode(view.document.value); }
  catch (error) { source = '// ' + error.message; }
  panel.innerHTML = `<div class="panel-tools"><b>Design source</b>
    <button data-source-download>Export .g.cs</button><button data-source-json>Export JSON</button></div>
    <details open><summary>Generated C#</summary>
      <textarea class="design-code" spellcheck="false" readonly>${escapeHtml(source)}</textarea>
    </details><details><summary>Design document JSON</summary>
      <textarea class="design-code" data-design-json spellcheck="false">${escapeHtml(view.document.serialize())}</textarea>
      <button data-source-apply>Validate and apply design JSON</button></details>`;
  panel.querySelector('[data-source-download]').onclick = () => view.safe(() => exportGeneratedSource(view));
  panel.querySelector('[data-source-json]').onclick = () => view.download(view.path, view.document.serialize(), 'application/json');
  panel.querySelector('[data-source-apply]').onclick = () => view.safe(() => {
    const parsed = JSON.parse(panel.querySelector('[data-design-json]').value);
    view.document.change('Apply document JSON', design => {
      for (const key of Object.keys(design)) delete design[key];
      Object.assign(design, parsed);
    });
  });
  view.chrome.source(panel);
}
