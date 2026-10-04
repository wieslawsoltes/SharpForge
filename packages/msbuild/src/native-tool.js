import { stat } from 'node:fs/promises';
import { runNativeProcess } from './process.js';

/** One trusted native invocation uses the shared queue, cancellation and process-tree policy. */
export async function runQueuedNativeTool(engine, request, options = {}, executable = engine.executable) {
  if (engine.closed) throw new Error('MSBuild host is closing');
  await engine.authorize(request);
  const cwd = request.cwd ? await engine.workspace.path(request.cwd) : engine.workspace.root;
  options.signal?.throwIfAborted();
  const id = engine.scheduler.enqueue(request, async (_id, signal) => {
    await engine.authorize(request);
    const combined = options.signal ? AbortSignal.any([signal, options.signal]) : signal;
    return runNativeProcess({ ...request, executable, cwd,
      timeoutMs: request.timeoutMs ?? engine.timeoutMs, maxOutputBytes: request.maxOutputBytes ?? engine.maxOutputBytes },
    { ...options, signal: combined, spawnProcess: engine.spawnProcess });
  }, { key: request.project ?? 'native-tool', priority: 10 });
  const cancelQueued = () => engine.scheduler.cancel(id, 'user');
  options.signal?.addEventListener('abort', cancelQueued, { once: true });
  if (options.signal?.aborted) cancelQueued();
  try {
    const entry = await engine.scheduler.wait(id);
    if (entry.status === 'cancelled' && !entry.result) throw new DOMException('Native operation cancelled', 'AbortError');
    if (entry.error) throw entry.error;
    return entry.result;
  } finally { options.signal?.removeEventListener('abort', cancelQueued); }
}

/** Executable profiles select only a regular, non-symlink file inside the granted workspace; no PATH lookup is performed. */
export async function runWorkspaceExecutable(engine, request, options = {}) {
  await engine.authorize(request);
  const executable = await engine.workspace.path(request.executablePath);
  if (!(await stat(executable)).isFile()) {
    throw Object.assign(new Error('Launch executable is not a regular file'), { code: 'SFMSB_LAUNCH_EXECUTABLE' });
  }
  return runQueuedNativeTool(engine, request, options, executable);
}
