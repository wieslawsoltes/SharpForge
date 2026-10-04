import {readProviderFiles as readBrowserFiles} from '@sharpforge/project-system';

const MAX_FILES = 20000;
const MAX_JSON_BYTES = 192 * 1024 * 1024;

function legacySourceRecords(data) {
  if (data.version !== 1 || !Array.isArray(data.files) || data.files.length > MAX_FILES) {
    throw new Error('This is not a supported SharpForge project');
  }
  if (!Array.isArray(data.extraFiles ?? [])) throw new Error('Project extra files must be an array');
  const records = data.files.map(file => {
    if (!file || typeof file.uri !== 'string' || !/\.cs$/i.test(file.uri) || typeof file.text !== 'string') {
      throw new Error('The project contains an invalid source record');
    }
    return {path: file.uri, text: file.text};
  });
  return [...records, ...(data.extraFiles ?? []).map(record => ({...record}))];
}

async function importJson(host, file) {
  if (file.size > MAX_JSON_BYTES) throw new Error('Workspace bundle exceeds 192 MiB');
  const data = JSON.parse(await file.text());
  if (data?.format !== 'sharpforge-project') {
    if (/\.sharpforge\.json$/i.test(file.name)) throw new Error('This is not a supported SharpForge project');
    return {handled: false};
  }
  if (Array.isArray(data.diskRecords)) {
    if (!await host.loadBundle(file, data)) throw new Error('This is not a supported SharpForge workspace bundle');
    return {handled: true};
  }
  const records = legacySourceRecords(data);
  const settings = {name: data.name, mode: data.mode ?? 'folder', entry: data.entry, startup: data.startupProject,
    configuration: data.configuration, active: data.active, tabs: data.tabs, langVersion: data.langVersion,
    breakpoints: data.breakpoints, functionBreakpoints: data.functionBreakpoints, extensions: data.extensions};
  return {handled: true, result: await host.load(records, {folders: data.folders ?? [], settings})};
}

/** File-picker import prepares all bytes before publishing a replacement; add-existing remains an Explorer operation. */
export async function importWorkspaceFileList(host, input) {
  const files = [...input];
  if (!files.length) return null;
  if (files.length > MAX_FILES) throw new RangeError('Workspace file limit exceeded');
  if (host.state.readOnly && !host.state.recoveryReadOnly) throw new Error('Stop debugging before opening a workspace');
  const single = files.length === 1 ? files[0] : null;
  if (single && /\.zip$/i.test(single.name)) return host.openZip(single);
  if (files.some(file => /\.(?:csproj|slnx?|slnf)$/i.test(file.name) || file.webkitRelativePath)) {
    const records = await readBrowserFiles(files);
    return host.load(records, {select: true, folders: records.folders});
  }
  if (single && /\.il$/i.test(single.name)) {
    if (single.size > 128 * 1024 * 1024) throw new Error('IL source too large');
    const artifact = await host.assemble(await single.text());
    return host.openAssembly(artifact.bytes);
  }
  if (single && /\.(?:dll|exe)$/i.test(single.name)) {
    if (single.size > 64 * 1024 * 1024) throw new Error('Assembly exceeds 64 MB');
    const bytes = new Uint8Array(await single.arrayBuffer());
    return host.state.nativeMode ? host.inspectAssembly(bytes, single.name) : host.importAssembly(bytes);
  }
  if (single && /\.json$/i.test(single.name)) {
    const result = await importJson(host, single);
    if (result.handled) return result.result;
  }
  const records = await readBrowserFiles(files);
  return host.load(records, {mode: 'folder', folders: records.folders, name: 'Opened files'});
}
