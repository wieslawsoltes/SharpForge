import {DesignDocument, validateDesign} from './model.js';
import {planDesignSourceUpdate} from './source-plan.js';
import {failSource} from './source-errors.js';
import {importDesignerAuthoringResources} from './resource-clipboard.js';
import {retainSourceDesignMetadata} from './source-design-metadata.js';

const clipboardFormat = 'sharpforge.design-clipboard';

/** Serializes selected subtrees, referenced resources and their preview data, without source code. */
export function copyDesignSelection(input, selected) {
  const document = validateDesign(input.document ?? input);
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  if (!Array.isArray(selected) || !selected.length || selected.some(id => !nodes.has(id))) {
    failSource('Clipboard selection must contain existing controls', null, 'SFSYNC_SYMBOL');
  }
  const parents = new Map(document.nodes.flatMap(node => node.children.map(child => [child, node.id])));
  const chosen = new Set(selected);
  const roots = [...chosen].filter(id => {
    let parent = parents.get(id);
    while (parent) {
      if (chosen.has(parent)) return false;
      parent = parents.get(parent);
    }
    return true;
  });
  const included = new Set();
  const pending = [...roots];
  while (pending.length) {
    const id = pending.pop();
    if (included.has(id)) continue;
    included.add(id);
    pending.push(...nodes.get(id).children);
  }
  const styles = {};
  const templates = {};
  const resources = {styles, templates};
  const addStyle = key => {
    if (styles[key]) return;
    const style = document.styles[key];
    if (style.basedOn) addStyle(style.basedOn);
    styles[key] = structuredClone(style);
  };
  const copied = [...included].map(id => {
    const node = structuredClone(nodes.get(id));
    delete node.runtimeId;
    if (node.style) addStyle(node.style);
    if (node.template) templates[node.template] = structuredClone(document.templates[node.template]);
    importDesignerAuthoringResources(document, resources, node);
    return node;
  });
  const parts = Object.values(templates).map(template => template.root);
  while (parts.length) {
    const part = parts.pop();
    importDesignerAuthoringResources(document, resources, part);
    parts.push(...(part.children ?? []));
  }
  let root = '__clipboard_root';
  while (included.has(root)) root += '_';
  const wrapper = {id: root, type: 'Canvas', properties: {}, children: roots, events: {}};
  if (copied.some(node => node.type.endsWith('.Window'))) failSource('Copy child controls instead of a top-level Window', null, 'SFSYNC_OWNERSHIP');
  const payload = {format: clipboardFormat, version: 1, selection: roots,
    document: validateDesign(retainSourceDesignMetadata({version: 1, name: document.name, width: document.width, height: document.height,
      root, nodes: [wrapper, ...copied], ...resources}, document))};
  return JSON.stringify(payload);
}

/** Pastes with the shared DesignDocument de-duplication rules and produces one atomic source transaction. */
export function planDesignPaste(base, payload, parentId, options = {}) {
  if (typeof payload !== 'string' || payload.length > (options.maxBytes ?? 4_000_000)) {
    failSource('Clipboard payload size limit exceeded', null, 'SFSYNC_LIMIT');
  }
  let data;
  try {
    data = JSON.parse(payload);
  } catch {
    failSource('Clipboard is not a valid designer document', null, 'SFSYNC_PARSE');
  }
  if (data?.format !== clipboardFormat || data.version !== 1) failSource('Unsupported designer clipboard format', null, 'SFSYNC_PARSE');
  const document = new DesignDocument(base.document);
  const inserted = document.paste(data.document, data.selection, parentId);
  const plan = planDesignSourceUpdate(base, document.value, options.currentSources ?? base.sources, {
    requireCompilation: true, ...options
  });
  return {...plan, selection: inserted};
}
