import { Workspace } from '@sharpforge/workspace';
import { LanguageService } from '@sharpforge/language';
import { RefactoringEngine } from '@sharpforge/refactoring';

function candidateWorkspace(workspace) {
  const candidate = new Workspace({
    compilationOptions: workspace.compilationOptions, extensions: workspace.extensions,
    extensionOptions: workspace.extensionOptions, additionalFiles: workspace.additionalFiles
  });
  for (const [uri, document] of workspace.documents) candidate.update(uri, document.source.text, document.source.version);
  return candidate;
}

/** Validation never mutates the compiler's active workspace or its successful artifact cache. */
export function registerDesignerValidation(protocol, workspace) {
  const unregisterRefactoring = protocol.registerHandler('validateRefactoring', params => {
    const candidate = candidateWorkspace(workspace);
    return new RefactoringEngine(candidate, new LanguageService(candidate)).apply(params.action);
  });
  const unregisterDesigner = protocol.registerHandler('validateDesigner', params => {
    const candidate = candidateWorkspace(workspace);
    new RefactoringEngine(candidate, new LanguageService(candidate)).apply(params.action, { validate: false });
    const compiled = candidate.compile();
    if (!compiled.success) {
      const diagnostics = compiled.diagnostics.filter(item => item.severity === 'error');
      const error = new Error('Designer changes do not compile: ' + diagnostics.slice(0, 10).map(item => item.message).join('; '));
      error.code = 'SFSYNC_COMPILE';
      error.diagnostics = diagnostics;
      throw error;
    }
    return { success: true };
  });
  return () => { unregisterRefactoring(); unregisterDesigner(); };
}
