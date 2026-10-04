import { createWorkspaceLanguageActions } from './language-actions.js';

const items = result => Array.isArray(result) ? result : result?.items ?? [];

/** Enumerate owning projects without assigning dependency-closure sources to every consuming project. */
export function studioProjectDocuments(state, documents, id) {
  const project = state.projectSystem?.projects.get(id);
  return project ? project.compile.map(item => item.path) : id === '$workspace' ? documents.list().map(record => record.uri) : [];
}

export function studioDocumentProjects(state, documents, uri) {
  if (!state.projectSystem) return documents.get(uri) ? ['$workspace'] : [];
  return [...state.projectSystem.projects.values()].filter(project => project.compile.some(item => item.path === uri))
    .map(project => project.path);
}

/** Bind semantic batches and live test lenses to the same project/document ownership used by Studio execution. */
export function createStudioLanguageProviders({ projects, documents, state, getTestCodeLens, requestHost }) {
  const actions = createWorkspaceLanguageActions({ projects, documents,
    getProjectDocuments: id => studioProjectDocuments(state(), documents, id) });
  return {
    codeActions({ signal, ...params }) { return actions.codeActions(params, { signal }); },
    rename({ signal, ...params }) { return actions.rename(params, { signal }); },
    async codeLens({ signal, ...params }) {
      const references = await projects.request('referenceLenses', params, { signal });
      signal?.throwIfAborted();
      const tests = getTestCodeLens()?.codeLens(params, { signal });
      return { uri: params.uri, version: params.version, items: [...items(references), ...items(tests)] };
    },
    resolveCodeLens({ signal, ...params }) {
      if (params.lens?.data?.provider === 'tests') return getTestCodeLens().resolveCodeLens(params, { signal });
      return params.lens;
    },
    executeCommand({ signal, ...params }) {
      if (params.command === 'sharpforge.tests.run') return getTestCodeLens().executeCommand(params, { signal });
      return requestHost(params.command, params.arguments?.[0] ?? { uri: params.uri, version: params.version });
    }
  };
}
