import {SourceText} from '@sharpforge/text';
import {EditorServiceError} from './providers.js';

function fail(code, message) {
  throw new EditorServiceError(code, message);
}

export function readWorkspaceDocument(workspace, uri) {
  const document = workspace.getDocument?.(uri) ?? workspace.documents?.get(uri);
  if (!document) fail('SFED1101', `Document is unavailable: ${uri}`);
  const source = document.source ?? document.snapshot?.() ?? document;
  const text = source.text ?? document.getText?.();
  const version = document.version ?? source.version;
  if (typeof text !== 'string' || !Number.isInteger(version)) fail('SFED1102', `Document has no versioned snapshot: ${uri}`);
  return {uri, text, version, readOnly: document.readOnly ?? source.readOnly ?? false, document};
}

function flattenEdits(edit) {
  if (Array.isArray(edit)) return edit;
  if (Array.isArray(edit?.edits)) return edit.edits;
  if (edit?.changes) return Object.entries(edit.changes).flatMap(([uri, edits]) => edits.map(item => ({...item, uri})));
  if (edit?.documentChanges) return edit.documentChanges.flatMap(change => {
    if (change.kind === 'rename') return [];
    if (!change.textDocument || !Array.isArray(change.edits)) fail('SFED1103', 'Unsupported workspace resource operation');
    return change.edits.map(item => ({...item, uri: change.textDocument.uri, version: change.textDocument.version}));
  });
  fail('SFED1104', 'Expected a WorkspaceEdit or an array of versioned text edits');
}

/** Builds a side-effect-free atomic commit plan; every target must match an expected version. */
export function prepareWorkspaceEdit(workspace, workspaceEdit, options = {}) {
  const edits = flattenEdits(workspaceEdit);
  const groups = new Map();
  const maximum = options.maxEdits ?? 100_000;
  if (edits.length > maximum) fail('SFED1105', 'Workspace edit exceeds the edit budget');
  for (const edit of edits) {
    if (typeof edit.uri !== 'string') fail('SFED1106', 'Every workspace edit requires a document URI');
    if (!groups.has(edit.uri)) groups.set(edit.uri, []);
    groups.get(edit.uri).push(edit);
  }
  const changes = [];
  for (const [uri, items] of groups) {
    const before = readWorkspaceDocument(workspace, uri);
    if (before.readOnly) fail('SFED1107', `Document is read-only: ${uri}`);
    const source = new SourceText(before.text, uri, before.version);
    const normalized = items.map(item => normalizeEdit(item, source, options));
    normalized.sort((left, right) => left.start - right.start || left.end - right.end);
    for (let index = 1; index < normalized.length; index++) {
      const previous = normalized[index - 1];
      if (normalized[index].start < previous.end || normalized[index].start === previous.start) {
        fail('SFED1108', `Overlapping edits in ${uri}`);
      }
    }
    const pieces = [];
    let cursor = 0;
    for (const item of normalized) {
      pieces.push(before.text.slice(cursor, item.start), item.text);
      cursor = item.end;
    }
    pieces.push(before.text.slice(cursor));
    const text = pieces.join('');
    if (text.length > (options.maxDocumentLength ?? 32_000_000)) fail('SFED1109', `Edited document exceeds its size limit: ${uri}`);
    changes.push(Object.freeze({uri, version: before.version, before: before.text, text, edits: Object.freeze(normalized)}));
  }
  const resources = prepareResources(workspace, workspaceEdit, options);
  return Object.freeze({changes: Object.freeze(changes), resources: Object.freeze(resources),
    label: options.label ?? workspaceEdit.title ?? 'Workspace edit'});
}

function prepareResources(workspace, edit, options) {
  const operations = edit?.resources ?? edit?.documentChanges?.filter(change => change.kind) ?? [];
  if (!operations.length) return [];
  if (workspace.supportsResourceRename !== true) fail('SFED1103', 'This workspace does not support atomic resource rename');
  if (operations.length > (options.maxEdits ?? 100_000)) fail('SFED1105', 'Resource edit budget exceeded');
  const sources = new Set();
  const destinations = new Set();
  return operations.map(operation => {
    const {oldUri, newUri} = operation;
    if (operation.kind !== 'rename' || typeof oldUri !== 'string' || typeof newUri !== 'string' || !oldUri || !newUri ||
      oldUri === newUri || sources.has(oldUri) || destinations.has(newUri)) fail('SFED1103', 'Invalid or overlapping resource rename');
    if (workspace.getDocument?.(newUri) ?? workspace.documents?.get(newUri)) fail('SFED1103', `Rename destination exists: ${newUri}`);
    const source = readWorkspaceDocument(workspace, oldUri);
    const version = operation.version ?? options.versions?.get(oldUri) ?? options.versions?.[oldUri];
    if (source.readOnly || source.version !== version) fail('SFED1110', `Stale or read-only resource rename: ${oldUri}`);
    sources.add(oldUri);
    destinations.add(newUri);
    return Object.freeze({kind: 'rename', oldUri, newUri, version, before: source.text});
  });
}

function normalizeEdit(edit, source, options) {
  const version = edit.version ?? options.versions?.get(source.uri) ?? options.versions?.[source.uri];
  if (version !== source.version) fail('SFED1110', `Stale or unversioned workspace edit: ${source.uri}`);
  const start = edit.start ?? (edit.range ? strictOffset(source, edit.range.start) : undefined);
  const end = edit.end ?? (edit.range ? strictOffset(source, edit.range.end) : undefined);
  const text = edit.newText ?? edit.text;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length || typeof text !== 'string') {
    fail('SFED1111', `Invalid workspace edit span: ${source.uri}`);
  }
  if (edit.expectedText !== undefined && source.text.slice(start, end) !== edit.expectedText) fail('SFED1112', 'Edit text conflicts with source');
  return Object.freeze({start, end, text});
}

function strictOffset(source, position) {
  if (!Number.isInteger(position?.line) || !Number.isInteger(position?.character) || position.line < 0 || position.character < 0 ||
      position.line >= source.lineStarts.length) fail('SFED1111', 'Invalid workspace edit position');
  const offset = source.offsetAt(position);
  if (source.positionAt(offset).character !== position.character) fail('SFED1111', 'Workspace edit character exceeds its line');
  return offset;
}

/** Revalidates immediately before commit. The host transaction must publish all documents together. */
export function commitWorkspaceEdit(workspace, plan) {
  for (const change of plan.changes) {
    const document = readWorkspaceDocument(workspace, change.uri);
    if (document.readOnly || document.version !== change.version || document.text !== change.before) {
      fail('SFED1113', `Workspace changed before commit: ${change.uri}`);
    }
  }
  for (const resource of plan.resources ?? []) {
    const document = readWorkspaceDocument(workspace, resource.oldUri);
    if (document.readOnly || document.version !== resource.version || document.text !== resource.before ||
      (workspace.getDocument?.(resource.newUri) ?? workspace.documents?.get(resource.newUri))) {
      fail('SFED1113', `Workspace changed before resource rename: ${resource.oldUri}`);
    }
  }
  if (!plan.changes.length && !plan.resources?.length) return {changes: []};
  if (typeof workspace.applyTransaction !== 'function') fail('SFED1114', 'Workspace requires an atomic applyTransaction adapter');
  return workspace.applyTransaction(plan);
}

/** A single-editor adapter retains the model's undo transaction. Multi-file edits require a host adapter. */
export function editorWorkspace(editor) {
  return {
    getDocument(uri) {
      if (uri !== editor.uri) return undefined;
      const source = editor.model?.snapshot?.() ?? editor.sourceSnapshot();
      return {uri, source, model: editor.model, get text() { return source.text; }, length: source.length,
        version: source.version, readOnly: editor.input.readOnly};
    },
    listDocuments() { return [this.getDocument(editor.uri)]; },
    applyTransaction(plan) {
      if (plan.resources?.length) fail('SFED1103', 'A resource transaction adapter is required');
      if (plan.changes.some(change => change.uri !== editor.uri)) fail('SFED1115', 'A multi-document workspace adapter is required');
      const change = plan.changes[0];
      editor.applyEdits(change.edits, {source: plan.label, undoStop: true});
      return {changes: plan.changes};
    }
  };
}

export function workspaceVersions(workspace) {
  const documents = workspace.listDocuments?.() ?? [...(workspace.documents?.values() ?? [])];
  return new Map(documents.map(document => {
    const uri = document.uri ?? document.source?.uri;
    return [uri, document.version ?? document.source?.version ?? document.snapshot?.().version];
  }));
}
