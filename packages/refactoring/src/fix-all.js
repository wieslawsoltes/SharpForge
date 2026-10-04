import {validateRefactoring} from './validate-plan.js';

const keys = new Set(['sharpforge.local.explicit-type', 'sharpforge.local.implicit-type']);
const scopes = Object.freeze(['document', 'project', 'solution']);

function typeActions(workspace, uri) {
  const source = workspace.documents.get(uri)?.source;
  if (!source) return [];
  const syntax = workspace.syntax(uri).syntax;
  const symbols = new Map((workspace.sourceModel().symbolsByUri.get(uri) ?? [])
    .filter(symbol => symbol.kind === 'local').map(symbol => [symbol.start, symbol]));
  const actions = [];
  for (const node of syntax.descendantNodes()) {
    if (node.kind !== 'LocalDeclarationStatement' || node.declaration.variables.length !== 1 ||
      (node.modifiers ?? []).some(token => token.text === 'const')) continue;
    const variable = node.declaration.variables[0];
    const symbol = symbols.get(variable.identifier.span.start);
    if (!symbol || !symbol.type || symbol.type === '?' || symbol.type === 'error') continue;
    const boundType = workspace.sourceModel().symbolsById.get(symbol.id)?.type;
    if (boundType?.isErrorType?.() || boundType?.isAnonymousType) continue;
    const type = node.declaration.type;
    const current = type.toString();
    const implicit = current === 'var';
    if (!implicit && (!variable.initializer?.value?.kind?.endsWith('LiteralExpression') || current !== symbol.type)) continue;
    if (!implicit && !workspace.sourceModel().localInitializerTypes.get(symbol.id)?.equals(boundType)) continue;
    const equivalenceKey = implicit ? 'sharpforge.local.explicit-type' : 'sharpforge.local.implicit-type';
    actions.push({title: implicit ? `Use explicit type '${symbol.type}'` : 'Use implicit type var', kind: 'refactor.rewrite',
      equivalenceKey, fixAllScopes: scopes, data: {uri, version: source.version, start: node.span.start, end: node.span.end},
      edits: [{uri, start: type.span.start, end: type.span.end, newText: implicit ? symbol.type : 'var', version: source.version}]});
  }
  return actions;
}

export function localTypeActions(workspace, uri, start, end = start) {
  return typeActions(workspace, uri).filter(action => action.data.start <= start && action.data.end >= end);
}

function scopedDocuments(workspace, parameters) {
  const {uri, version, scope, projectId, ownership} = parameters;
  if (!scopes.includes(scope)) throw new Error('Unknown Fix All scope');
  if (workspace.documents.get(uri)?.source.version !== version) throw new Error('Fix All origin is stale');
  if (scope === 'document') return [uri];
  if (!Array.isArray(ownership?.projects) || !ownership.projects.length) throw new Error('Fix All requires explicit project ownership');
  const projects = scope === 'project' ? ownership.projects.filter(project => project.id === projectId) : ownership.projects;
  if (!projects.length || scope === 'project' && projects.length !== 1) throw new Error('Fix All project is unavailable or ambiguous');
  const seenProjects = new Set();
  const documents = new Set();
  for (const project of projects) {
    if (!project.id || seenProjects.has(project.id) || !Array.isArray(project.documents)) throw new Error('Invalid Fix All project snapshot');
    seenProjects.add(project.id);
    for (const document of project.documents) {
      if (workspace.documents.get(document.uri)?.source.version !== document.version) throw new Error('Fix All project source changed');
      documents.add(document.uri);
    }
  }
  if (!documents.has(uri)) throw new Error('Fix All origin does not belong to the requested project scope');
  return [...documents];
}

/** One equivalence family per request; all occurrences are validated together before any edit is returned. */
export function fixAll(workspace, parameters) {
  if (!keys.has(parameters.equivalenceKey)) throw new Error('This action does not support Fix All');
  const uris = scopedDocuments(workspace, parameters);
  const edits = uris.flatMap(uri => typeActions(workspace, uri)
    .filter(action => action.equivalenceKey === parameters.equivalenceKey).flatMap(action => action.edits));
  validateRefactoring(workspace, edits);
  return {title: `Fix ${edits.length} occurrences in ${parameters.scope}`, kind: 'refactor.rewrite',
    scope: parameters.scope, equivalenceKey: parameters.equivalenceKey, edits,
    versions: Object.fromEntries(uris.map(uri => [uri, workspace.documents.get(uri).source.version]))};
}
