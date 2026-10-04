import {decodeWorkspaceFile, sanitizeSessionUserSettings} from '@sharpforge/project-system';
import {workspaceRecordBytes, workspaceRecordSource} from '@sharpforge/workspace';

/** Encode byte chunks without exceeding the JavaScript argument-count limit. */
export function workspaceBase64(bytes) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(text);
}

/** Build the version-one interchange format from a hydrated snapshot, preserving original encodings and binary files. */
export function createLegacyWorkspaceBundle({records, folders = [], settings = {}}) {
  if (!Array.isArray(records) || records.length > 20000) throw new Error('Workspace item limit exceeded');
  let total = 0;
  const files = [];
  const diskRecords = records.map(record => {
    if (!workspaceRecordSource(record) && typeof record.text !== 'string' && !(record.bytes instanceof Uint8Array)) {
      throw new Error('Original file contents must be loaded before JSON export: ' + record.path);
    }
    const bytes = workspaceRecordBytes(record, {maxBytes: 128 * 1024 * 1024 - total});
    total += bytes.length;
    if (total > 128 * 1024 * 1024) throw new Error('Workspace byte limit exceeded; use streaming ZIP export');
    if (/\.cs$/i.test(record.path)) {
      const text = decodeWorkspaceFile(record.path, bytes).text;
      if (typeof text === 'string') files.push({uri: record.path, text});
    }
    return {path: record.path, base64: workspaceBase64(bytes)};
  });
  const value = {format: 'sharpforge-project', version: 1, name: settings.name ?? 'Workspace',
    extensions: settings.extensions ?? null, files, diskRecords, folders, mode: settings.mode,
    entry: settings.entry, startupProject: settings.startup, configuration: settings.configuration,
    active: settings.active, tabs: settings.tabs, langVersion: settings.langVersion,
    breakpoints: settings.breakpoints ?? {}, functionBreakpoints: settings.functionBreakpoints ?? [],
    ...sanitizeSessionUserSettings(settings, {paths: new Set(records.map(record => record.path))})};
  const text = JSON.stringify(value, null, 2);
  if (new TextEncoder().encode(text).length > 192 * 1024 * 1024) {
    throw new Error('Workspace JSON limit exceeded; use streaming ZIP export');
  }
  return text;
}
