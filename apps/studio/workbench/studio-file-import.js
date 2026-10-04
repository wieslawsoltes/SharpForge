import { importWorkspaceZip } from '@sharpforge/project-system';
import { prepareStudioSourceFiles, prepareLegacyStudioProject, readStudioFiles } from './source-imports.js';
import { restoreRecentWorkspace } from './recent-workspaces.js';

async function importBundle(file, load, context) {
  if (file.size > 192 * 1024 * 1024) throw new Error('Workspace bundle exceeds 192 MiB');
  const data = JSON.parse(await file.text());
  load.check();
  if (data?.format !== 'sharpforge-project' || data.version !== 1 || !Array.isArray(data.diskRecords)) return undefined;
  const restored = await restoreRecentWorkspace({ ...data, files: data.files ?? [] }, { signal: load.signal });
  load.check();
  const result = await context.loadRecords(restored.records, { ...restored.options, load });
  return result === null ? null : true;
}

async function importSources(files, load, context) {
  const { state } = context;
  const preserving = !state.nativeMode;
  const settings = preserving ? context.workspaceSettings() : { mode: 'folder' };
  const disk = preserving ? state.disk : null;
  const folders = preserving ? [...state.folders] : [];
  const previousTabs = preserving ? [...state.tabs] : [];
  const currentRecords = preserving ? context.records() : [];
  const prepared = await prepareStudioSourceFiles(files, currentRecords, { signal: load.signal });
  const tabs = [...new Set([prepared.active, ...previousTabs, ...prepared.opened])].slice(0, 200);
  // The loader rechecks the original ticket and releases prepared sources if the workspace changed during the read.
  return context.loadRecords(prepared.records, {
    load, mode: settings.mode, name: preserving ? settings.name : 'Imported sources',
    entry: settings.entry, startup: settings.startup, disk, folders, preserveDocumentState: preserving,
    settings: { ...settings, active: prepared.active, tabs }
  });
}

async function importSelected(files, load, context) {
  const single = files.length === 1 ? files[0] : null;
  if (single && /\.zip$/i.test(single.name)) return openStudioWorkspaceZip(single, { load }, context);
  if (single && single.name.endsWith('.sharpforge.json')) {
    const result = await importBundle(single, load, context);
    if (result !== undefined) return result;
  }
  load.check();
  if (files.some(file => /\.(csproj|slnx|sln)$/i.test(file.name) || file.webkitRelativePath)) {
    const records = await readStudioFiles(files, { signal: load.signal });
    return context.loadRecords(records, { select: true, load });
  }
  if (single && /\.(dll|exe)$/i.test(single.name)) {
    if (single.size > 64 * 1024 * 1024) throw new Error('Assembly exceeds 64 MiB');
    const bytes = new Uint8Array(await single.arrayBuffer());
    load.check();
    return context.state.nativeMode ? context.openDecompiler(bytes, single.name) : context.importAssembly(bytes, { load });
  }
  if (single && /\.il$/i.test(single.name)) {
    if (single.size > 128 * 1024 * 1024) throw new Error('IL source too large');
    const text = await single.text();
    load.check();
    const artifact = await context.compiler().request('assembleIL', { text });
    load.check();
    return context.openAssembly(artifact.bytes);
  }
  if (single && /\.json$/i.test(single.name)) {
    if (context.state.nativeMode) throw new Error('Open native JSON configuration from Solution Explorer.');
    if (single.size > 192 * 1024 * 1024) throw new Error('Project file exceeds 192 MiB');
    const text = await single.text();
    load.check();
    const prepared = prepareLegacyStudioProject(JSON.parse(text));
    return context.loadRecords(prepared.records, { ...prepared.options, load });
  }
  return importSources(files, load, context);
}

/** Start before any file read, and carry the original ownership ticket through every format-specific path. */
export function importStudioFiles(input, options, context) {
  const files = [...input];
  if (!files.length) return null;
  return context.withLoad(load => importSelected(files, load, context), options);
}

export function openStudioWorkspaceZip(file, options, context) {
  return context.withLoad(async load => {
    if (file.size > 160 * 1024 * 1024) throw new Error('ZIP exceeds the 160 MiB input limit');
    const bytes = new Uint8Array(await file.arrayBuffer());
    load.check();
    const input = importWorkspaceZip(bytes);
    return context.loadRecords(input.records, {
      load, select: true, folders: input.folders, name: input.settings.name ?? file.name.replace(/\.zip$/i, ''),
      startup: input.settings.startup, configuration: input.settings.configuration ?? 'Debug',
      extensionConfig: input.settings.extensions, settings: input.settings
    });
  }, options);
}
