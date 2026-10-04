import {normalizePath} from '@sharpforge/project-system';
import {SourceText} from '@sharpforge/text';
import {FileSystemError} from '@sharpforge/workspace';
import {validateWorkspaceRecords} from './workspace-records.js';

/** Navigation resolves workspace membership even when Explorer has not materialized a paged tree node. */
export function workspaceFileNode(context, value) {
  const path = normalizePath(value);
  if (!context.records.some(record => record.path === path)) throw new Error('No such file in the current workspace: ' + path);
  const kind = /\.cs$/i.test(path) ? 'source' : /\.(?:dll|exe)$/i.test(path) ? 'assembly'
    : /\.(?:[a-z]*proj|slnx?|slnf|props|targets)$/i.test(path) ? 'project-file' : 'file';
  return {kind, path, label: path.slice(path.lastIndexOf('/') + 1)};
}

/** Stage additional source buffers under the same count/size budgets as opening a workspace, without opening tabs. */
export function prepareWorkspaceSourceBuffers(state, records) {
  const present = new Set(state.files.map(file => file.uri));
  const files = [...state.files];
  for (const record of records) {
    const uri = record.path ?? record.uri;
    if (present.has(uri)) continue;
    if (!/\.cs$/i.test(uri) || typeof record.text !== 'string') throw new Error('Original source contents are unavailable: ' + uri);
    files.push({...record, uri, version: record.version ?? 1});
    present.add(uri);
  }
  validateWorkspaceRecords(files.map(file => ({...file, path: file.uri})));
  return files;
}

/** Admit one opened source only after every source-buffer budget has passed. */
export function admitWorkspaceSource(state, record) {
  state.files = prepareWorkspaceSourceBuffers(state, [record]);
  return state.files.find(file => file.uri === (record.path ?? record.uri));
}

function openDiagnostic(openFile, record, uri, diagnostic, position) {
  const source = typeof record.text === 'string' ? new SourceText(record.text) : null;
  if (diagnostic.start === undefined && !source) throw new Error('Original source contents are unavailable: ' + uri);
  const start = diagnostic.start ?? source.offsetAt(position);
  const end = diagnostic.range?.end && source ? source.offsetAt(diagnostic.range.end) : start + (diagnostic.length ?? 1);
  return openFile(uri, start, end);
}

async function loadDiagnostic(host, uri, diagnostic, position) {
  const {state} = host;
  const before = {epoch: state.workspaceEpoch, disk: state.disk, projectSystem: state.projectSystem, revision: state.revision};
  if (!host.loadRecord) throw new Error('Original source contents are unavailable: ' + uri);
  const record = await host.loadRecord(uri);
  if (state.nativeMode || state.workspaceEpoch !== before.epoch || state.disk !== before.disk ||
      state.projectSystem !== before.projectSystem || state.revision !== before.revision) {
    throw new FileSystemError('Conflict', uri, 'Workspace changed while resolving the diagnostic location');
  }
  if (!record) throw new Error('Original source contents are unavailable: ' + uri);
  return openDiagnostic(host.openFile, record, uri, diagnostic, position);
}

/** Diagnostics resolve unloaded source bytes before converting line/column positions to editor offsets. */
export function navigateWorkspaceDiagnostic(host, diagnostic) {
  const {state, nativeBuild, openFile, setPanel} = host;
  const uri = diagnostic.uri ?? diagnostic.path ?? diagnostic.file;
  const position = diagnostic.range?.start ?? {line: Math.max(0, (diagnostic.line ?? 1) - 1),
    character: Math.max(0, (diagnostic.column ?? 1) - 1)};
  if (state.nativeMode && uri) {
    return nativeBuild.open(uri, position.line + 1, position.character + 1);
  }
  const record = state.files.find(file => file.uri === uri) ?? state.projectSystem?.files.get(uri)
    ?? state.extraFiles.find(file => file.path === uri) ?? state.disk?.record(uri);
  if (uri && record) {
    if (typeof record.text !== 'string' && (diagnostic.start === undefined || diagnostic.range?.end)) {
      return loadDiagnostic(host, uri, diagnostic, position);
    }
    return openDiagnostic(openFile, record, uri, diagnostic, position);
  }
  return setPanel('project');
}
