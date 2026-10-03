/** Workspace recovery stores state by URI; the registry owns versioning and drops deleted documents. */
export function designerRecoveryState(registry) {
  return registry.snapshot();
}

/** Invalid or newer recovery payloads do not prevent a source workspace from opening. */
export function restoreDesignerRecovery(registry, recovery, files) {
  return registry.restore(recovery?.designerViews ?? recovery, {files});
}
