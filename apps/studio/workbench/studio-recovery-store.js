import { studioSourceLength } from './workspace-limits.js';

export const studioRecoveryCharacterLimit = 8 * 1024 * 1024;

/** Automatic browser recovery is bounded before serialization; large source models keep their snapshot representation. */
export function canRecoverStudioWorkspace(documents, extraFiles = []) {
  let characters = 0;
  for (const record of documents.list()) {
    const model = documents.models.get(record.uri);
    characters += model?.length ?? studioSourceLength(record);
    if (characters > studioRecoveryCharacterLimit) return false;
  }
  for (const record of extraFiles) {
    characters += record.bytes instanceof Uint8Array ? Math.ceil(record.bytes.byteLength * 4 / 3) : studioSourceLength(record);
    if (characters > studioRecoveryCharacterLimit) return false;
  }
  return true;
}

/** Return false on quota or size limits. The caller must retain dirty state and offer an explicit file save. */
export function storeStudioRecovery({ documents, extraFiles, storage, key, capture, onError }) {
  try {
    if (!canRecoverStudioWorkspace(documents, extraFiles)) return false;
    storage.setItem(key, JSON.stringify(capture()));
    return true;
  } catch (error) {
    onError?.(error);
    return false;
  }
}
