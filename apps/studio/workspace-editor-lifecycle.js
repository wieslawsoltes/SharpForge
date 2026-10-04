import {FileSystemError, hashFileBytes, workspaceRecordBytes} from '@sharpforge/workspace';

const sameRecord = (left, right) => left && right && ['version', 'lazy', 'size', 'lastModified', 'text', 'bytes']
  .every(key => left[key] === right[key]);
const sameBytes = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);

function openInView(host, path) {
  return host.state.tabs.includes(path) || host.isDocumentOpen?.(path) === true;
}

function retainedReason(host, context, record) {
  const {state} = host;
  const path = record.path;
  const source = state.files.find(file => file.uri === path);
  if (openInView(host, path)) return 'open';
  if (state.dirtyFiles.has(path) || context.dirty?.includes(path)) return 'dirty';
  if (state.readOnly || state.recoveryReadOnly || record.readOnly || source?.readOnly || context.native) return 'read-only';
  if (record.generated || source?.generated || path.startsWith('generated://') ||
      context.generated?.some(file => (file.path ?? file.uri) === path)) return 'generated';
  if (context.fileBusy || context.buildBusy) return 'busy';
  if (host.canReleaseDocument?.(path) === false) return 'conflict';
  const disk = context.disk;
  if (!disk?.unload || !disk.record(path) || !(disk.rootHandle || disk.handles?.has(path) || disk.options?.provider)) return 'unbacked';
  return null;
}

function assertCurrent(host, before, original, signal) {
  signal.throwIfAborted();
  const current = host.context();
  const member = current.records.find(record => record.path === original.path);
  if (current.identity !== before.identity || current.disk !== before.disk || current.revision !== before.revision ||
      !sameRecord(member, original)) throw new FileSystemError('Conflict', original.path, 'Workspace changed while loading or closing a document');
  return {current, member};
}

/** Dispose a closed editor and both docking references. Open splits and detached windows retain their model. */
export function releaseWorkspaceEditorView({editors, docking, onReleased}, path) {
  const id = 'source:' + path;
  if (docking && (docking.host.popouts.has(id) || docking.layout.locate(id).kind !== 'closed')) return false;
  const editor = editors.get(path);
  editor?.dispose();
  editors.delete(path);
  const content = docking?.host.contents.get(id) ?? docking?.content.get(id);
  content?.remove();
  docking?.host.contents.delete(id);
  docking?.content.delete(id);
  if (editor) onReleased?.(editor, path);
  return true;
}

/** Per-path intents guard asynchronous reads/eviction. Only clean, closed, independently reloadable bytes can be discarded. */
export function createWorkspaceEditorLifecycle(host) {
  const {state} = host;
  const pending = new Map();

  function retainRecord(path) {
    pending.get(path)?.abort(new FileSystemError('Cancelled', path, 'A newer document open or close replaced this operation'));
    pending.delete(path);
  }

  function begin(path, signal) {
    signal?.throwIfAborted();
    retainRecord(path);
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, {once: true});
    pending.set(path, controller);
    return {signal: controller.signal, finish() {
      signal?.removeEventListener('abort', abort);
      if (pending.get(path) === controller) pending.delete(path);
    }};
  }

  async function loadRecord(path, {signal} = {}) {
    const operation = begin(path, signal);
    try {
      const before = host.context();
      const original = before.records.find(record => record.path === path);
      if (!original?.lazy) return original;
      if (!before.disk?.load || state.recoveryReadOnly) throw new Error('Grant folder access to load original file bytes: ' + path);
      const guard = () => assertCurrent(host, before, original, operation.signal);
      const loaded = await before.disk.load(path, {signal: operation.signal, reload: true, beforeAdmit: guard});
      guard();
      state.projectSystem?.files.set(path, loaded);
      const index = state.extraFiles.findIndex(file => file.path === path);
      if (index >= 0) state.extraFiles[index] = loaded;
      return loaded;
    } finally { operation.finish(); }
  }

  async function closeRecord(path, {signal} = {}) {
    const operation = begin(path, signal);
    const result = reason => ({path, evicted: false, reason});
    try {
      const before = host.context();
      const original = before.records.find(record => record.path === path);
      if (!original) return result('missing');
      if (original.lazy && typeof original.text !== 'string' && !original.bytes) return result('unloaded');
      const reason = retainedReason(host, before, original);
      if (reason) return result(reason);
      const disk = before.disk;
      const physical = disk.record(path);
      const baseline = disk.baselineHashes.get(path);
      if (!baseline) return result('unverified');
      const bytes = workspaceRecordBytes(original).slice();
      const hash = await (host.hashDocumentBytes ?? hashFileBytes)(bytes, {signal: operation.signal});
      const {current, member} = assertCurrent(host, before, original, operation.signal);
      const changed = retainedReason(host, current, member);
      if (changed) return result(changed);
      if (disk.record(path) !== physical || disk.baselineHashes.get(path) !== baseline ||
          hash !== baseline || !sameBytes(bytes, workspaceRecordBytes(member))) return result('modified');
      const version = Math.max(member.version ?? 1, physical.version ?? 1);
      if (!Number.isSafeInteger(version) || version < 1 || version === Number.MAX_SAFE_INTEGER) return result('version-limit');
      if (host.releaseDocumentView?.(path) === false) return result('open');
      if (!host.releaseDocumentView) releaseWorkspaceEditorView({editors: host.editors}, path);
      // The disk watermark survives eviction so a later compilation cannot resend an obsolete version to the worker.
      disk.replaceRecord({...physical, version});
      disk.unload(path);
      const metadata = {...disk.record(path)};
      state.files = state.files.filter(file => file.uri !== path);
      state.projectSystem?.files.set(path, metadata);
      const index = state.extraFiles.findIndex(file => file.path === path);
      if (index >= 0) state.extraFiles[index] = metadata;
      else if (!state.projectSystem) state.extraFiles.push(metadata);
      if (state.active === path) state.active = state.tabs.at(-1) ?? '';
      host.releaseDocumentCaches?.(path);
      host.renderDocuments?.();
      host.saveLocal();
      await host.releaseCompilerDocuments?.([{uri: path, version: member.version ?? 1}]);
      return {path, evicted: true, version, bytes: bytes.length};
    } catch (error) {
      if (operation.signal.aborted || error.name === 'AbortError') return result('cancelled');
      if (error instanceof FileSystemError && error.code === 'Conflict') return result('changed');
      throw error;
    } finally { operation.finish(); }
  }

  function dispose() {
    for (const path of pending.keys()) retainRecord(path);
  }

  return {loadRecord, closeRecord, retainRecord, dispose};
}
