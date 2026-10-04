import { EditorModel } from '@sharpforge/editor';
import { rewriteProjectPath } from '@sharpforge/project-system';
import { ExplorerPathIndex } from './explorer-path-index.js';
import { preparedExplorerModel } from './explorer-records.js';
import { matchesResourceSource, resourceFailure, resourcePath } from './explorer-resource-state.js';
import { studioDiskLimits } from './workbench/workspace-limits.js';

const xmlFile = path => /\.(csproj|slnx|props|targets)$/i.test(path);
export const explorerResourceLimits = Object.freeze({ renames: 128, edits: 100_000, label: 512 });

/** Copy the immutable editor plan's supported fields before any await; only versioned C# file renames are contributed here. */
export function normalizeResourcePlan(plan) {
  if (!plan || !Array.isArray(plan.changes) || !Array.isArray(plan.resources) || !plan.resources.length
      || plan.resources.length > explorerResourceLimits.renames || plan.changes.length > studioDiskLimits.maxFiles) {
    resourceFailure('Expected a bounded text-and-resource rename plan');
  }
  const label = plan.label ?? 'Rename source and references';
  if (typeof label !== 'string' || label.length > explorerResourceLimits.label) resourceFailure('Invalid resource rename label');
  let editCount = 0;
  const seen = new Set();
  const changes = plan.changes.map(change => {
    const uri = resourcePath(change.uri);
    if (seen.has(uri) || !Array.isArray(change.edits)) resourceFailure('Each changed document requires one edit group');
    seen.add(uri);
    editCount += change.edits.length;
    if (editCount > explorerResourceLimits.edits) resourceFailure('Resource rename exceeds the text edit budget');
    if (typeof change.text !== 'string' || change.text.length > studioDiskLimits.maxFileBytes) resourceFailure('Invalid edited source');
    const edits = change.edits.map(edit => Object.freeze({ start: edit.start, end: edit.end, text: edit.text }));
    return Object.freeze({ uri, version: change.version, before: change.before, text: change.text, edits: Object.freeze(edits) });
  });
  const resources = plan.resources.map(resource => {
    if (resource.kind !== 'rename') resourceFailure('Only resource rename is supported', 'SFEX_RESOURCE_UNSUPPORTED');
    const oldUri = resourcePath(resource.oldUri);
    const newUri = resourcePath(resource.newUri);
    if (!/\.cs$/i.test(oldUri) || !/\.cs$/i.test(newUri) || oldUri === newUri) {
      resourceFailure('Resource rename requires different C# source paths');
    }
    return Object.freeze({ kind: 'rename', oldUri, newUri, version: resource.version, before: resource.before });
  });
  return Object.freeze({ label, changes: Object.freeze(changes), resources: Object.freeze(resources) });
}

export function validateResourcePaths(plan, state) {
  const paths = new ExplorerPathIndex(state.records.keys(), JSON.parse(state.folders));
  const renamed = new Set();
  for (const resource of plan.resources) {
    if (renamed.has(resource.oldUri)) resourceFailure('A source may only be renamed once');
    renamed.add(resource.oldUri);
    state.model(resource.oldUri, resource.version);
    paths.assertAvailable(resource.newUri);
    paths.add(resource.newUri, true);
  }
}

async function validateSource(state, uri, version, before) {
  if (!Number.isSafeInteger(version) || version < 0 || typeof before !== 'string' || before.length > studioDiskLimits.maxFileBytes) {
    resourceFailure('Resource edits require a bounded source and exact version: ' + uri);
  }
  state.model(uri, version);
  const source = state.records.get(uri).source;
  if (!await matchesResourceSource(source, before, state)) resourceFailure('Source changed before rename: ' + uri, 'SFEX_RESOURCE_CHANGED');
  return source;
}

export async function prepareResourceWrites(plan, state, created) {
  const operations = [];
  const checked = new Map();
  for (const change of plan.changes) {
    const source = await validateSource(state, change.uri, change.version, change.before);
    checked.set(change.uri, change);
    const record = state.records.get(change.uri);
    const model = new EditorModel(source, {
      uri: change.uri, version: source.version, encoding: record.encoding, bom: record.bom
    });
    created.add(model);
    model.applyEdits(change.edits, { source: plan.label, undoStop: true });
    if (!await matchesResourceSource(model.snapshot(), change.text, state)) resourceFailure('Text edits do not match the prepared result');
    operations.push({ kind: 'write', path: change.uri, record: preparedExplorerModel(record, model) });
  }
  for (const resource of plan.resources) {
    const change = checked.get(resource.oldUri);
    if (!change || change.version !== resource.version || change.before !== resource.before) {
      await validateSource(state, resource.oldUri, resource.version, resource.before);
    }
  }
  return operations;
}

export async function prepareResourceProjectWrites(plan, state) {
  const operations = [];
  for (const [path, record] of state.records) {
    if (!xmlFile(path)) continue;
    const text = record.text;
    let next = text;
    for (let index = 0; index < plan.resources.length; index++) {
      state.cancelled();
      const resource = plan.resources[index];
      next = rewriteProjectPath(next, { documentPath: path, oldPath: resource.oldUri, newPath: resource.newUri });
      if (index % 4 === 3) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (next !== text) operations.push({ kind: 'write', path, text: next });
  }
  return operations;
}
