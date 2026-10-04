import {throwIfWorkspaceAborted} from '../content-hash.js';

export async function readRecoveryText(directory, name) {
  try { return await (await (await directory.getFileHandle(name)).getFile()).text(); }
  catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
}

/** Writable close is the commit point; failed writes abort without replacing the previous file. */
export async function writeRecoveryText(directory, name, text, signal) {
  throwIfWorkspaceAborted(signal);
  const handle = await directory.getFileHandle(name, {create: true});
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
    throwIfWorkspaceAborted(signal);
    await writable.close();
  } catch (error) {
    try { await writable.abort(); }
    catch (abortError) { error.abortError = abortError; }
    throw error;
  }
}
