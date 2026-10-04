import { validateStudioSources } from './workspace-limits.js';

const sampleNames = { particles: 'ParticleLab', gc: 'HeapLab', recursion: 'CallStackLab', exceptions: 'ExceptionLab', arrays: 'AlgorithmLab' };
const sampleWatches = { particles: ['total', 'tick', 'particles.Length'], gc: ['first', 'second'],
  recursion: ['i', 'value', 'n'], exceptions: ['divisor', 'error.Message'] };

function replaceSources(files, metadata, load, context) {
  load.check();
  let committedFailure;
  try {
    context.documents.replace(files, {
      discard: true, preserveEditors: true, signal: load.signal,
      active: files[0]?.uri ?? '', tabs: files.map(file => file.uri),
      commitMetadata: () => {
        Object.assign(context.state, {
          nativeMode: false, extraFiles: [], folders: [], membershipDirty: false,
          projectSystem: null, projectSnapshot: null, startupProject: null, disk: null,
          workspaceEpoch: (context.state.workspaceEpoch ?? 0) + 1, ...metadata
        });
        context.nativeBuild.attached = false;
      }
    });
  } catch (error) {
    if (!error.committed) throw error;
    committedFailure = error;
  }
  context.resetEditors();
  context.renderWorkspace();
  return committedFailure;
}

async function installSample(id, initial, load, context) {
  const { state } = context;
  const sample = context.samples.find(value => value.id === id);
  if (!sample) return false;
  if (state.nativeMode && !initial && !context.confirmLeaveNative()) return false;
  validateStudioSources(sample.files);
  await context.stopQuietly();
  load.check();
  if (!initial) context.savePrevious();
  const files = sample.files.map((file, index) => ({ ...file, version: Date.now() + index }));
  const committedFailure = replaceSources(files, {
    workspaceMode: 'solution', projectDiagnostics: [], extensionConfig: sample.extensions ?? null,
    langVersion: sample.compilationOptions?.langVersion ?? '14',
    name: sampleNames[id] ?? sample.name.replace(/[^A-Za-z0-9]/g, ''),
    functionBreakpoints: structuredClone(sample.debug?.functionBreakpoints ?? []),
    breakpoints: structuredClone(sample.debug?.breakpoints ?? (id === 'particles' ? { 'Program.cs': [{ line: 27, enabled: true }] } : {})),
    image: null, assembly: null, pdb: null, ilDump: null, importedAssembly: false, result: null,
    buildDirty: false, logs: [], programOutput: ''
  }, load, context);
  state.watchResults.clear();
  state.watches = [...(sample.debug?.watches ?? sampleWatches[id] ?? ['values.Length'])];
  context.runtimeBridge.select(null);
  context.recent()?.remember({ name: sample.name, sampleId: id });
  context.saveLocal();
  if (committedFailure) throw committedFailure;
  await context.build(true);
  return true;
}

/** Samples use the same exact opening ticket and atomic document/metadata boundary as imported workspaces. */
export function loadStudioSample(id, initial, options, context) {
  return context.withLoad(load => installSample(id, initial, load, context), options);
}

async function installAssembly(input, load, context) {
  const assembly = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (assembly.length > 64 * 1024 * 1024) throw new Error('Assembly exceeds 64 MiB');
  const compiler = context.compiler();
  const inspection = await compiler.request('inspectAssembly', { assembly });
  load.check();
  if (!inspection.summary.streams.some(stream => stream.name === '#SF')) {
    await context.openAssembly(assembly);
    load.check();
    context.log('Opened ordinary managed assembly in Assembly Explorer. Select a method and Invoke to run the supported subset.');
    return { success: true, workbench: true, summary: inspection.summary };
  }
  const result = await compiler.request('importAssembly', { assembly });
  load.check();
  if (context.state.nativeMode && !context.confirmLeaveNative()) return false;
  await context.stopQuietly();
  load.check();
  const files = result.image.sources.map((file, index) => ({ ...file,
    text: file.text ?? '// Embedded source unavailable. Retain the original DLL.\n', version: Date.now() + index }));
  if (!files.length) files.push({ uri: 'Assembly.cs', text: '// Embedded source unavailable.\n', version: Date.now() });
  validateStudioSources(files);
  context.savePrevious();
  const committedFailure = replaceSources(files, {
    workspaceMode: 'folder', name: result.image.name, breakpoints: {}, functionBreakpoints: [],
    projectDiagnostics: [], extensionConfig: null, image: null, assembly: null, pdb: null,
    result: null, ilDump: null, importedAssembly: false, buildDirty: true
  }, load, context);
  context.builds.active.applyResult({ ...result, assembly }, 'build');
  Object.assign(context.state, { image: result.image, assembly, ilDump: null, result,
    importedAssembly: true, buildDirty: false, selectedMethod: result.image.methods[0]?.id });
  context.applyAnalysis(result);
  context.saveLocal();
  context.log(`Loaded ${context.formatBytes(assembly.length)} PE/CLI assembly. Execution uses the assembly's IL bytes.`, 'success');
  if (committedFailure) throw committedFailure;
  return result;
}

export function importStudioAssembly(bytes, options, context) {
  return context.withLoad(load => installAssembly(bytes, load, context), options);
}
