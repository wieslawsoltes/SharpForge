import { preflightDestination, writeNewDirectory, readProviderDirectory as readDirectory } from '@sharpforge/project-system';

/** The picker is invoked only from the user's click; cancellation never advances the wizard. */
export async function chooseWizardDirectory({ picker = globalThis.showDirectoryPicker, signal } = {}) {
  if (typeof picker !== 'function') throw new Error('Writable folder selection is unavailable in this browser. Use a native workspace or ZIP export.');
  signal?.throwIfAborted();
  try {
    const handle = await picker({ mode: 'readwrite' });
    signal?.throwIfAborted();
    return { cancelled: false, handle, name: handle.name ?? 'Selected folder' };
  } catch (error) {
    if (error.name === 'AbortError') return { cancelled: true, handle: null };
    throw error;
  }
}

/** Confirm concrete conflicting paths, write with rollback, then return a real attached disk workspace. */
export async function commitWizardDirectory(handle, plan, { signal, confirmOverwrite = globalThis.confirm } = {}) {
  const preflight = await preflightDestination(handle, plan, { signal });
  let overwritePaths = [];
  if (preflight.conflicts.length) {
    const blocked = preflight.conflicts.filter(conflict => !conflict.overwritable);
    if (blocked.length) throw new Error('Destination path conflicts: ' + blocked.map(conflict => conflict.path).join(', '));
    const message = 'Overwrite these existing files?\n\n' + preflight.conflicts.map(conflict => conflict.path).join('\n');
    if (!await confirmOverwrite?.(message)) return { cancelled: true };
    overwritePaths = preflight.conflicts.map(conflict => conflict.path);
  }
  signal?.throwIfAborted();
  const writeResult = await writeNewDirectory(handle, plan, { signal, overwritePaths, mode: 'merge' });
  try {
    const disk = await readDirectory(handle, { signal, openedPaths: writeResult.written });
    return { cancelled: false, writeResult, disk, directoryHandle: handle };
  } catch (error) {
    error.writeResult = writeResult;
    throw error;
  }
}
