import {DiskWorkspace, encodeWorkspaceFile} from '@sharpforge/project-system';
import {DocumentService} from '../../apps/studio/workbench/documents.js';
import {readStudioSource} from '../../apps/studio/workbench/studio-source-reader.js';
import {createStudioDiskObserver} from '../../apps/studio/workbench/studio-disk-observer.js';
import {sourceFileHandle} from './a20-source-file-fixture.js';

export const observationLimits = {
  maxFileBytes: 32_000_000, maxAssemblyBytes: 32_000_000, maxTotalBytes: 48_000_000
};

export function deferred() {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  return {promise, resolve};
}

/** Actual prepared File/Blob ingress and shared EditorModel; only the File System Access handle is simulated. */
export async function diskObservationContext(test, {text = 'original', encoding = 'utf-8', bom = false, confirm = () => true} = {}) {
  const uri = 'Program.cs';
  const handle = sourceFileHandle(uri, encodeWorkspaceFile({path: uri, text, encoding, bom}));
  const prepared = await readStudioSource(await handle.getFile(), {path: uri, limits: observationLimits, encoding});
  const disk = new DiskWorkspace([prepared], new Map([[uri, handle]]), 'Workspace', [], [], {
    ...observationLimits, readSource: readStudioSource
  });
  const documents = new DocumentService({records: [prepared]});
  const state = {disk, nativeMode: false};
  const context = {uri, handle, disk, documents, state, target: disk, confirm};
  context.observer = createStudioDiskObserver({documents, state: () => state, nativeBuild: () => ({}),
    target: () => context.target, confirm: message => context.confirm(message)});
  context.external = (value, options = {}) => handle.setExternal(encodeWorkspaceFile({path: uri, text: value, encoding, bom, ...options}));
  context.reload = observed => context.observer.reload(uri, observed.text, {
    expectedRecord: documents.get(uri), expectedVersion: documents.get(uri).version,
    observation: observed.observation, confirmDirty: true
  });
  test.after(() => { context.observer.dispose(); documents.dispose(); });
  return context;
}
