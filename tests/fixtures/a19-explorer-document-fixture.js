import { EditorModel } from '@sharpforge/editor';
import { cloneWorkspaceRecord, isTextRecord } from '@sharpforge/project-system';
import { ExplorerCommands } from '../../apps/studio/explorer-commands.js';
import { DocumentService } from '../../apps/studio/workbench/documents.js';

const source = record => /\.cs$/i.test(record.path ?? record.uri) && isTextRecord(record);
const mapped = (path, mappings) => {
  const match = mappings.find(value => path === value.from || path?.startsWith(value.from + '/'));
  return match ? match.to + path.slice(match.from.length) : path;
};

/** Real document ownership with an explicit host commit seam; no DOM, compiler or runtime is substituted into file state. */
export function explorerDocuments(records) {
  const documents = new DocumentService({ records: records.filter(source),
    createModel: record => new EditorModel(record.text, { uri: record.uri, version: record.version }) });
  let extra = records.filter(record => !source(record));
  let metadata = { identity: 'preview:Explorer', native: false, readOnly: false, folders: [], breakpoints: {}, name: 'Explorer' };
  const errors = [];
  const context = () => ({ ...metadata, records: [...documents.files.map(record => cloneWorkspaceRecord(record, record.uri)), ...extra],
    active: documents.active, tabs: documents.tabs, dirty: [...documents.dirtyFiles] });
  const host = {
    context, ownsModel: model => documents.ownsModel(model),
    captureDocumentState: uri => documents.get(uri) ? documents.captureState(uri) : null,
    render() {}, notice() {}, error: error => errors.push(error), open: async () => {}, confirm: async () => true,
    pickFiles: async () => [], pathDialog: async () => null,
    async commit(prepared) {
      if (host.rejectCommit) throw new Error('Commit rejected');
      host.lastPrepared = prepared;
      const { records: next, folders = [], mappings = [], restore, documentStates } = prepared;
      const files = next.filter(source);
      const valid = new Set(files.map(record => record.path));
      const tabs = (restore?.tabs ?? documents.tabs.map(uri => mapped(uri, mappings))).filter(uri => valid.has(uri));
      const active = restore?.active ?? mapped(documents.active, mappings);
      const commitMetadata = () => {
        extra = next.filter(record => !source(record));
        metadata = { ...metadata, folders, breakpoints: restore?.breakpoints ?? metadata.breakpoints };
      };
      let callbackError;
      try {
        prepared.validate?.();
        documents.replace(files, { tabs, active: valid.has(active) ? active : '', discard: true,
          preserveEditors: true, preserveDirty: true, documentStates, commitMetadata });
      } catch (error) {
        if (!error.committed) throw error;
        callbackError = error;
      }
      if (callbackError) throw callbackError;
      return { committed: true };
    }
  };
  const commands = new ExplorerCommands(host);
  return { commands, documents, host, errors, context,
    setContext: changes => { metadata = { ...metadata, ...changes }; },
    dispose() { commands.dispose(); documents.dispose(); } };
}
