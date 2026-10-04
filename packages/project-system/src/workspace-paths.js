import {portablePath} from '@sharpforge/archive';
import {cloneWorkspaceRecord, recordSource, validatePreparedRecord} from './workspace-records.js';

/** Rebased models are new caller-owned preparations; an error leaves every input record and model intact. */
export function rebaseWorkspaceRecords(records, pathFor, {rebaseSource} = {}) {
  const originalModels = new Set(records.map(record => record.model).filter(Boolean));
  const created = new Set();
  try {
    return records.map(record => {
      const path = portablePath(pathFor(record.path));
      if (path === record.path || !recordSource(record)) return cloneWorkspaceRecord(record, path);
      if (typeof rebaseSource !== 'function') {
        const error = new TypeError('Prepared source path changes require a rebaseSource contribution');
        error.code = 'SFPROJECT_SOURCE_REBASE';
        throw error;
      }
      const rebased = rebaseSource(record, path);
      if (rebased?.model && !originalModels.has(rebased.model)) created.add(rebased.model);
      validatePreparedRecord(rebased, path);
      if (originalModels.has(rebased.model)) throw new TypeError('A rebased source must use a new model');
      const combined = Object.defineProperties({}, {
        ...Object.getOwnPropertyDescriptors(record), ...Object.getOwnPropertyDescriptors(rebased)
      });
      return cloneWorkspaceRecord(combined, path);
    });
  } catch (error) {
    for (const model of created) model.dispose();
    throw error;
  }
}

/** Prefixing preserves lazy descriptors. New prepared models transfer only when their containing workspace is adopted. */
export function prefixWorkspace(records, folders, prefix = '', options = {}) {
  if (prefix) portablePath(prefix);
  const directories = folders.map(path => prefix ? prefix + '/' + path : path);
  return {records: rebaseWorkspaceRecords(records, path => prefix ? prefix + '/' + path : path, options),
    folders: directories};
}

/** Validate the manifest and paths before creating any rebased source model. */
export function extractWorkspaceRecords(records, folders, {manifestPath, validateSettings, rebaseSource}) {
  const candidates = records.filter(record => record.path === manifestPath || record.path.endsWith('/' + manifestPath));
  if (!candidates.length) return {records, folders, settings: {}, manifest: false};
  if (candidates.length !== 1) throw new Error('Multiple workspace manifests in selected folder');
  const file = candidates[0];
  const prefix = file.path.slice(0, -manifestPath.length);
  const source = typeof file.text === 'string' ? file.text : new TextDecoder('utf-8', {fatal: true}).decode(file.bytes);
  if (source.length > 4 * 1024 * 1024) throw new Error('Workspace manifest limit exceeded');
  const value = JSON.parse(source);
  if (value.format !== 'sharpforge-workspace' || value.version !== 1) throw new Error('Unsupported workspace settings manifest');
  if (prefix && records.some(record => !record.path.startsWith(prefix))) throw new Error('Manifest root excludes other selected files');
  const input = records.filter(record => record !== file);
  const settings = validateSettings(value, input.map(record => record.path.slice(prefix.length)));
  const directories = folders.filter(path => (!prefix || path.startsWith(prefix))
    && !path.endsWith('/.sharpforge') && path !== '.sharpforge').map(path => path.slice(prefix.length)).filter(Boolean);
  const result = rebaseWorkspaceRecords(input, path => path.slice(prefix.length), {rebaseSource});
  return Object.defineProperty({records: result, folders: directories, settings, manifest: true}, 'pathMap', {
    value: new Map(records.map(record => [record.path, record.path.slice(prefix.length)]))
  });
}
