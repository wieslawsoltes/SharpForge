import { readBrowserFiles, readDirectory, validateItemPath } from '@sharpforge/project-system';
import { studioDiskLimits, validateStudioSources, validateStudioWorkspaceRecords, isStudioTextRecord } from './workspace-limits.js';
import { studioSourceRecord, releaseStudioSources } from './studio-source-records.js';
import { readStudioSource } from './studio-source-reader.js';

export function readStudioFiles(files, options = {}) {
  return readBrowserFiles(files, { ...studioDiskLimits, ...options, readSource: readStudioSource });
}

export function readStudioDirectory(handle, options = {}) {
  return readDirectory(handle, { ...studioDiskLimits, ...options, readSource: readStudioSource });
}

/** Stage a complete loose-source import before replacing any current document or project state. */
export async function prepareStudioSourceFiles(files, currentRecords = [], { readFiles = readStudioFiles, signal } = {}) {
  signal?.throwIfAborted();
  const selected = [...files];
  if (!selected.length || selected.length > studioDiskLimits.maxFiles) throw new RangeError('Select between one and 20,000 source files');
  for (const file of selected) {
    if (!/\.cs$/i.test(file.name) || file.size > studioDiskLimits.maxFileBytes) throw new Error('Open .cs files up to 256 MiB');
  }
  const imported = await readFiles(selected, { ...studioDiskLimits, signal });
  try {
    const records = new Map(currentRecords.map(record => [record.uri ?? record.path, record]));
    for (const record of imported) {
      if (!isStudioTextRecord(record)) throw new TypeError('A C# source must use a supported text encoding');
      records.set(record.path, record);
    }
    const values = [...records.values()];
    await validateStudioWorkspaceRecords(values, { signal });
    return { records: values.map(record => studioSourceRecord(record)),
      active: imported[0].path, opened: imported.map(record => record.path) };
  } catch (error) {
    releaseStudioSources(imported, { ownsModel: () => false });
    throw error;
  }
}

/** Convert the legacy JSON format into the same validated workspace-loading path used by folders and ZIPs. */
export function prepareLegacyStudioProject(project) {
  if (project?.format !== 'sharpforge-project' || project.version !== 1 || !Array.isArray(project.files) || !project.files.length) {
    throw new TypeError('This is not a supported SharpForge project');
  }
  validateStudioSources(project.files);
  const paths = new Set();
  const records = project.files.map(file => {
    const path = validateItemPath(file.uri);
    if (!/\.cs$/i.test(path)) throw new TypeError('Legacy project sources must have a .cs extension');
    const key = path.normalize('NFC').toLowerCase();
    if (paths.has(key)) throw new TypeError('Duplicate source paths in project');
    paths.add(key);
    return { path, text: file.text, encoding: file.encoding, bom: file.bom, eol: file.eol };
  });
  if (!Array.isArray(project.extraFiles ?? [])) throw new TypeError('Invalid additional workspace files');
  for (const record of project.extraFiles ?? []) {
    const path = validateItemPath(record.path);
    const key = path.normalize('NFC').toLowerCase();
    if (paths.has(key)) throw new TypeError('Duplicate workspace path');
    paths.add(key);
    if (typeof record.text !== 'string' || record.text.length > studioDiskLimits.maxFileBytes) {
      throw new TypeError('Invalid additional workspace text');
    }
    records.push({ ...record, path });
  }
  if (records.length > studioDiskLimits.maxFiles) throw new RangeError('Workspace item limit exceeded');
  validateStudioSources(records);
  return { records, options: {
    name: String(project.name ?? 'Application'), mode: project.entry ? 'solution' : 'folder', entry: project.entry,
    folders: (project.folders ?? []).map(validateItemPath), startup: project.startupProject,
    configuration: project.configuration ?? 'Debug', extensionConfig: project.extensions ?? null,
    settings: { ...project, startup: project.startupProject, active: project.active ?? project.files[0].uri }
  } };
}
