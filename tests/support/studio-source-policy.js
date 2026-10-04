import { createStudioEditorFactory } from '../../apps/studio/workbench/studio-editor.js';
import { createStudioLanguageProviders } from '../../apps/studio/workbench/studio-language-providers.js';
import { createInsightContext } from '../../packages/editor/src/features/context.js';
import { createCompilerWorkspace, syncCompilerSources } from '../../apps/studio/workers/compiler-workspace.js';
import { LanguageService } from '@sharpforge/language';
import { RefactoringEngine } from '@sharpforge/refactoring';
import { createWorkerProtocol } from '../../apps/studio/workers/protocol.js';
import { registerEditorLanguageHandlers } from '../../apps/studio/workers/editor-language.js';

/** Only DOM layout is doubled; use the actual Studio provider registry and editor request boundary. */
export function sourcePolicyContext(t, { services, projects, state }, uri) {
  const providers = createStudioLanguageProviders({ projects, documents: services.documents, state: () => state,
    getTestCodeLens: () => null, requestHost: () => { throw new Error('Unexpected host command'); } });
  const integration = createStudioEditorFactory({ services, state: () => state, providers,
    requestCompiler: (method, params, options) => projects.request(method, params, options),
    getLanguageAvailability: params => projects.languageAvailability(params) });
  const document = { createElement: () => ({ setAttribute() {} }) };
  const model = services.documents.models.get(uri);
  const editor = { model, uri, element: { ownerDocument: document, append() {} },
    sourceSnapshot: () => model.snapshot() };
  const errors = [];
  const context = createInsightContext(editor, { services: integration.language, workspace: integration.workspace,
    languageAvailability: integration.languageAvailability, onError: error => errors.push(error) });
  t.after(() => { context.guard.dispose(); context.lifetime.dispose(); integration.dispose(); });
  return { context, integration, errors };
}

/** Deterministic transport for real bounded compiler/language handlers, not a browser worker substitute. */
export function compilerPolicyTransport(t) {
  const contexts = new Map();
  t.after(() => { for (const context of contexts.values()) context.protocol.dispose(); });
  return (message, worker) => {
    let context = contexts.get(worker);
    if (!context) {
      const workspace = createCompilerWorkspace();
      const language = new LanguageService(workspace);
      const protocol = createWorkerProtocol('compiler');
      registerEditorLanguageHandlers(protocol, { workspace, language, refactoring: new RefactoringEngine(workspace, language) });
      context = { workspace, protocol };
      contexts.set(worker, context);
    }
    const { workspace, protocol } = context;
    syncCompilerSources(workspace, message.params.files);
    workspace.compilationOptions = message.params.compilationOptions;
    workspace.result = null;
    if (message.method === 'analyze') return workspace.compile();
    return protocol.dispatch(message.method, message.params);
  };
}
