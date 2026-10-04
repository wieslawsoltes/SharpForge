import { readZip } from '@sharpforge/archive';
import { WORKSPACE_MANIFEST, importWorkspaceZip, writeNewDirectory } from '@sharpforge/project-system';
import { binaryJsonBudget } from './binary-guards.js';
import { BinaryDestinationError, MEMORY_DESTINATION_ROOT, createMemoryDestination } from './binary-memory-destination.js';
import { workspaceImportFailure } from './binary-workspace-errors.js';
import { zipFailure } from './binary-zip-errors.js';

function manifestBudget(entries) {
  for (const entry of entries) {
    if (entry.directory || entry.path !== WORKSPACE_MANIFEST && !entry.path.endsWith(`/${WORKSPACE_MANIFEST}`)) continue;
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes));
      const failure = binaryJsonBudget(value);
      if (failure) return failure;
    } catch (error) {
      // Malformed syntax/encoding must still reach the actual importer and its error classification.
      if (!(error instanceof SyntaxError) && !(error instanceof TypeError && error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA')) {
        throw error;
      }
    }
  }
  return null;
}

function verifyDestination(workspace, saved, snapshot) {
  const written = new Set(saved.written);
  if (saved.written.length !== workspace.records.length || written.size !== workspace.records.length ||
      snapshot.files.length !== workspace.records.length || workspace.records.some(record => !written.has(record.path))) {
    throw new BinaryDestinationError('Workspace writer lost or added destination files');
  }
  const expected = new Map(workspace.records.map(record => [`${MEMORY_DESTINATION_ROOT}/${record.path}`, record.bytes]));
  for (const file of snapshot.files) {
    const bytes = expected.get(file.path);
    if (!file.path.startsWith(`${MEMORY_DESTINATION_ROOT}/`) || !bytes || bytes.length !== file.bytes.length ||
        !bytes.every((value, index) => file.bytes[index] === value)) {
      throw new BinaryDestinationError('Workspace writer changed a destination path or file bytes');
    }
    expected.delete(file.path);
  }
  if (expected.size) throw new BinaryDestinationError('Workspace writer omitted an imported file');
  for (const folder of workspace.folders) {
    if (!snapshot.folders.includes(`${MEMORY_DESTINATION_ROOT}/${folder}`)) {
      throw new BinaryDestinationError('Workspace writer omitted an imported directory');
    }
  }
}

/** Exercise the real ZIP importer and destination writer against a fresh, fixed, memory-only destination. */
export async function importZipIntoMemory(input, options, signal) {
  let entries;
  try {
    entries = readZip(input, options);
  } catch (error) {
    return { failure: zipFailure(error) };
  }
  const failure = manifestBudget(entries);
  if (failure) return { failure };
  let workspace;
  try {
    workspace = importWorkspaceZip(input, options);
  } catch (error) {
    return { failure: workspaceImportFailure(error, signal) };
  }
  const destination = createMemoryDestination(options);
  let saved;
  try {
    saved = await writeNewDirectory(destination.root, workspace, { signal });
  } catch (error) {
    if (signal?.aborted && (error === signal.reason || error?.cause === signal.reason)) {
      return { failure: workspaceImportFailure(error, signal) };
    }
    throw error;
  }
  const snapshot = destination.snapshot();
  verifyDestination(workspace, saved, snapshot);
  if (snapshot.bytes !== workspace.summary.bytes || snapshot.bytes > options.maxTotalBytes) {
    throw new BinaryDestinationError('Workspace writer exceeded the imported byte budget');
  }
  return { snapshot, settings: workspace.settings, manifest: workspace.manifest };
}
