import {readLegacyWorkspaceRecovery} from '@sharpforge/workspace';

/** Read-only bootstrap retains the original storage record. A blocked result must not be replaced by an auto-saved sample. */
export async function restoreLegacyWorkspace({storage, key = 'sharpforge.workspace.v1', legacyStorage = storage, session,
  onDiagnostic = () => {}, signal, maxEncodedBytes = 128 * 1024 * 1024}) {
  signal?.throwIfAborted();
  let text;
  try {
    text = storage.getItem(key);
    if (text === null) return {restored: false, blocked: false, diagnostics: []};
    if (typeof text !== 'string' || text.length > maxEncodedBytes) throw new Error('SFW1304: Legacy recovery size limit exceeded');
    const {record, diagnostics} = readLegacyWorkspaceRecovery(legacyStorage, text, {signal});
    signal?.throwIfAborted();
    await session.load(record.records, {name: record.name, entry: record.entry, startup: record.startup, folders: record.folders,
      settings: {...record.settings, active: record.active, tabs: record.openDocuments.map(document => document.path),
        breakpoints: record.breakpoints}, readOnly: true, persist: false, dirty: record.dirty,
      recoveryMetadata: {settings: record.settings, appDescriptors: record.appDescriptors,
        explorer: record.explorer, recentTemplates: record.recentTemplates}, signal});
    for (const diagnostic of diagnostics) onDiagnostic(diagnostic);
    return {restored: true, blocked: false, record, diagnostics};
  } catch (error) {
    if (signal?.aborted) throw error;
    const diagnostic = {code: /SFW\d+/.exec(error.message)?.[0] ?? 'SFW1302',
      message: 'Recovery was preserved without opening or building it. ' + error.message, key};
    onDiagnostic(diagnostic);
    return {restored: false, blocked: true, diagnostics: [diagnostic]};
  }
}
