import {captureExplorerRecord} from './explorer-records.js';

/** Release a closed clean document through the sole model owner; sibling roots, baselines and views stay owned. */
export function evictWorkspaceDocument(host, path, commitMetadata) {
  const documents = host.documents;
  const dirty = new Set(documents.dirtyFiles);
  dirty.delete(path);
  const records = documents.list().filter(record => record.uri !== path);
  const sources = records.map(record => captureExplorerRecord(record, {models: true, copyBytes: false}));
  const documentStates = new Map(records.map(record => [record.uri, documents.captureState(record.uri)]));
  const tabs = documents.tabs.filter(uri => uri !== path);
  const active = documents.active === path ? tabs.at(-1) ?? '' : documents.active;
  return documents.replace(sources, {
    discard: true, preserveEditors: true, preserveDirty: true, documentStates, tabs, active,
    commitMetadata: () => {
      for (const uri of dirty) documents.dirtyFiles.add(uri);
      commitMetadata();
    }
  });
}
