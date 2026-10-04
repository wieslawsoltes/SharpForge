import {prepareExplorerRecord} from '../explorer-records.js';
import {documentStateFor} from '../explorer-history.js';
import {studioSourceRecord} from '../workbench/studio-source-records.js';

/** DocumentService commits records, models, dirty baselines and metadata through one ownership boundary. */
export function replaceNativeDocuments(host, files, {states = new Map(), tabs = [], active = '', signal, commitMetadata} = {}) {
  const {state, documents} = host;
  signal?.throwIfAborted();
  if (!documents) {
    state.files = files;
    state.tabs = tabs;
    state.active = active;
    commitMetadata?.();
    return {committed: true, count: files.length};
  }
  const created = new Set();
  try {
    const records = files.map(file => {
      const uri = file.uri ?? file.path;
      const prepared = studioSourceRecord(prepareExplorerRecord(file, uri), {path: uri, version: file.version});
      if (prepared.model && prepared.model !== file.model) created.add(prepared.model);
      return prepared;
    });
    const documentStates = new Map();
    for (const record of records) {
      const captured = documentStateFor(record, states.get(record.uri));
      if (captured) documentStates.set(record.uri, captured);
    }
    return documents.replace(records, {tabs, active, discard: true, preserveEditors: true, preserveDirty: true,
      documentStates, signal, commitMetadata: () => {
        // Service-backed state already resolves these properties to the committed owner; avoid a second replace.
        if (state.files !== documents.files) state.files = documents.files;
        if (state.tabs !== documents.tabs) state.tabs = documents.tabs;
        if (state.active !== documents.active) state.active = documents.active;
        if (state.dirtyFiles !== documents.dirtyFiles) state.dirtyFiles = documents.dirtyFiles;
        commitMetadata?.();
      }});
  } finally {
    for (const model of created) if (!documents.ownsModel(model)) model.dispose();
  }
}
