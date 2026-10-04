import { Workspace } from '@sharpforge/workspace';
import { compilerSourceLimits } from './compiler-limits.js';

/** Keep worker enforcement and Studio's pre-serialization eligibility check on the same bounds. */
export function createCompilerWorkspace(options = {}) {
  return new Workspace({ ...options, ...compilerSourceLimits });
}

export function syncCompilerSources(workspace, files) {
  if (!files) return;
  const names = new Set(files.map(file => file.uri));
  for (const uri of workspace.documents.keys()) if (!names.has(uri)) workspace.remove(uri);
  for (const file of files) workspace.update(file.uri, file.text, file.version);
}
