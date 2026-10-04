import {validateWorkspacePath} from '../transaction-state.js';
import {restoreRecoveryRecords} from './records.js';

export const WORKSPACE_RECOVERY_VERSION = 1;
export {sanitizeRecoveryValue} from './sanitize.js';
import {sanitizeRecoveryValue} from './sanitize.js';

function recoverySettings(source) {
  const settings = {...source.settings};
  for (const name of ['name', 'mode', 'configuration', 'platform', 'langVersion', 'active', 'tabs', 'breakpoints',
    'functionBreakpoints', 'extensions', 'theme', 'watches']) {
    if (settings[name] === undefined && source[name] !== undefined) settings[name] = source[name];
  }
  settings.entry ??= source.entry ?? source.solutionPath;
  settings.startup ??= source.startup ?? source.startupProject;
  return settings;
}

/** Migrate historical 0.6–0.14 workspace/settings layouts without mutating the source record. Newer schemas are refused. */
export function migrateWorkspaceRecovery(input, {identity, maxFiles = 20000, maxBytes = 128 * 1024 * 1024, signal} = {}) {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error('SFW1304: Recovery limits must be non-negative safe integers');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('SFW1302: Invalid workspace recovery record');
  if (input.schemaVersion > WORKSPACE_RECOVERY_VERSION) throw new Error('SFW1303: Recovery schema is newer than this application');
  if (typeof input.version === 'string' && !/^0\.(?:[6-9]|1[0-4])(?:\.\d+)?$/.test(input.version)) {
    throw new Error('SFW1303: Unsupported recovery application version: ' + input.version);
  }
  if (typeof input.version === 'number' && input.version > WORKSPACE_RECOVERY_VERSION && !input.schemaVersion) {
    throw new Error('SFW1303: Recovery schema is newer than this application');
  }
  for (const name of ['records', 'diskRecords', 'files', 'documents', 'extraFiles']) {
    if (Array.isArray(input[name]) && input[name].length > maxFiles) throw new Error('SFW1304: Recovery file limit exceeded');
  }
  const source = sanitizeRecoveryValue(input);
  const {records, paths} = restoreRecoveryRecords(source, {maxFiles, maxBytes, signal});
  const settings = recoverySettings(source);
  const tabs = source.openDocuments ?? settings.tabs ?? [];
  if (!Array.isArray(tabs) || tabs.length > maxFiles) throw new Error('SFW1304: Recovery open-document limit exceeded');
  const openDocuments = tabs.map(item => typeof item === 'string' ? {path: item} : item)
    .filter(item => typeof item?.path === 'string' && paths.has(item.path.normalize('NFC').toLowerCase()))
    .map(item => ({...item, path: paths.get(item.path.normalize('NFC').toLowerCase())}));
  if (!Array.isArray(source.folders ?? []) || (source.folders?.length ?? 0) > maxFiles * 5) {
    throw new Error('SFW1304: Recovery folder limit exceeded');
  }
  const dirty = source.dirty ?? records.filter(record => record.dirty).map(record => record.path);
  if (!Array.isArray(dirty) || dirty.length > maxFiles) throw new Error('SFW1304: Recovery dirty-file limit exceeded');
  return {
    format: 'sharpforge-workspace-recovery', schemaVersion: WORKSPACE_RECOVERY_VERSION,
    identity: String(identity ?? source.identity ?? source.name ?? 'Workspace'), name: String(source.name ?? 'Workspace'),
    records, folders: (source.folders ?? []).map(validateWorkspacePath), settings,
    explorer: source.explorer ?? {}, recentTemplates: source.recentTemplates ?? source.templates?.recent ?? [],
    appDescriptors: source.appDescriptors ?? source.apps ?? [], openDocuments,
    dirty: [...new Set(dirty.map(path => typeof path === 'string' ? paths.get(path.normalize('NFC').toLowerCase()) : null).filter(Boolean))],
    active: paths.get(String(settings.active ?? '').normalize('NFC').toLowerCase()) ?? openDocuments[0]?.path ?? null,
    entry: settings.entry ?? null, startup: settings.startup ?? null,
    breakpoints: settings.breakpoints ?? {}, revision: Number.isSafeInteger(source.revision) ? source.revision : 0,
    omittedBinaryFiles: source.omittedBinaryFiles ?? [], savedAt: Number.isFinite(source.savedAt) ? source.savedAt : 0
  };
}

/** Read legacy settings without deleting their original keys; persist the migrated checkpoint before clearing old data. */
export function readLegacyWorkspaceRecovery(storage, workspace, options = {}) {
  const value = typeof workspace === 'string' ? JSON.parse(workspace) : workspace;
  if (value?.format !== undefined && !['sharpforge-project', 'sharpforge-workspace-recovery'].includes(value.format)) {
    throw new Error('SFW1303: Unsupported legacy recovery format');
  }
  const explorer = {...value.explorer};
  const diagnostics = [];
  let recentTemplates = value.recentTemplates ?? value.templates?.recent ?? [];
  if ((storage?.length ?? 0) > 10000) throw new Error('SFW1304: Legacy recovery key limit exceeded');
  for (let index = 0; index < (storage?.length ?? 0); index++) {
    const key = storage.key(index);
    if (!key?.startsWith('sharpforge.explorer.') && key !== 'sharpforge.templates.recent') continue;
    try {
      const parsed = JSON.parse(storage.getItem(key));
      if (key === 'sharpforge.templates.recent') recentTemplates = parsed;
      else explorer[key.slice('sharpforge.explorer.'.length)] = parsed;
    } catch (error) { diagnostics.push({code: 'SFW1302', key, message: error.message}); }
  }
  return {record: migrateWorkspaceRecovery({...value, explorer, recentTemplates}, options), diagnostics};
}
