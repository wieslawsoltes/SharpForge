import { EvaluationError, getCaseInsensitive, splitList } from './evaluation/errors.js';
import { PORTABLE_RUNTIME_GRAPH } from './portable-rid-graph.js';

export { PORTABLE_RUNTIME_GRAPH, PORTABLE_RUNTIME_GRAPH_SOURCE } from './portable-rid-graph.js';

const maximumRuntimes = 20000;
const maximumImports = 100000;

function invalid(message) {
  throw new EvaluationError(message, 'SFP1910');
}

function validIdentifier(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x20]/.test(value);
}

function importsFor(graph, runtime) {
  const imports = Object.hasOwn(graph, runtime) ? graph[runtime] : [];
  if (!Array.isArray(imports) || imports.length > maximumImports || imports.some(value => !validIdentifier(value))) {
    invalid('Invalid runtime graph imports.');
  }
  return imports;
}

/** Read bounded runtime.json data into an independent RID/import table; malformed input throws SFP1910. */
export function readRuntimeGraph(input) {
  if (typeof input === 'string' && input.length > 4194304) invalid('Runtime graph source limit exceeded.');
  let document;
  try {
    document = typeof input === 'string' ? JSON.parse(input) : input;
  } catch (error) {
    invalid('Invalid runtime graph JSON: ' + error.message);
  }
  const runtimes = document?.runtimes;
  if (!runtimes || typeof runtimes !== 'object' || Array.isArray(runtimes)) invalid('A runtime graph requires runtimes.');
  const entries = Object.entries(runtimes);
  if (entries.length > maximumRuntimes) invalid('Runtime graph node limit exceeded.');
  const graph = Object.create(null);
  let count = 0;
  for (const [runtime, definition] of entries) {
    if (!validIdentifier(runtime) || !definition || typeof definition !== 'object' || Array.isArray(definition)) {
      invalid('Invalid runtime graph definition.');
    }
    const imports = definition['#import'] ?? [];
    if (!Array.isArray(imports) || imports.length > maximumImports || imports.some(value => !validIdentifier(value))) {
      invalid('Invalid runtime graph imports.');
    }
    count += imports.length;
    if (count > maximumImports) invalid('Runtime graph import limit exceeded.');
    graph[runtime] = Object.freeze([...imports]);
  }
  return Object.freeze(graph);
}

function rejectCycles(runtimes, graph, indegrees) {
  const roots = runtimes.filter(runtime => indegrees.get(runtime) === 0);
  for (let index = 0; index < roots.length; index++) {
    for (const parent of importsFor(graph, roots[index])) {
      const count = indegrees.get(parent) - 1;
      indegrees.set(parent, count);
      if (count === 0) roots.push(parent);
    }
  }
  if (roots.length !== runtimes.length) invalid('Runtime graph contains a cycle.');
}

/** NuGet-compatible breadth-first RID expansion, O(V + E); unknown roots return NETSDK1083. */
export function runtimeFallbacks(runtime, graph = PORTABLE_RUNTIME_GRAPH) {
  if (!validIdentifier(runtime)) invalid('Invalid runtime identifier.');
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) invalid('Invalid runtime graph.');
  if (!Object.hasOwn(graph, runtime)) {
    return { runtimes: [], diagnostics: [{ code: 'NETSDK1083', severity: 'error', runtimeIdentifier: runtime,
      message: 'RuntimeIdentifier is not recognized: ' + runtime }] };
  }
  const runtimes = [runtime];
  const seen = new Set(runtimes);
  const indegrees = new Map([[runtime, 0]]);
  let count = 0;
  for (let index = 0; index < runtimes.length; index++) {
    const imports = importsFor(graph, runtimes[index]);
    count += imports.length;
    if (count > maximumImports) invalid('Runtime graph import limit exceeded.');
    for (const parent of imports) {
      indegrees.set(parent, (indegrees.get(parent) ?? 0) + 1);
      if (seen.has(parent)) continue;
      if (seen.size >= maximumRuntimes) invalid('Runtime graph traversal limit exceeded.');
      seen.add(parent);
      runtimes.push(parent);
    }
  }
  rejectCycles(runtimes, graph, indegrees);
  return { runtimes, diagnostics: [] };
}

/** Resolve the selected and declared RuntimeIdentifier(s) properties without selecting a runtime implicitly. */
export function resolveRuntimeIdentifiers(properties, { graph = PORTABLE_RUNTIME_GRAPH } = {}) {
  const runtimeIdentifier = String(getCaseInsensitive(properties, 'RuntimeIdentifier') ?? '').trim();
  const declaration = String(getCaseInsensitive(properties, 'RuntimeIdentifiers') ?? '');
  if (declaration.length > 65536) invalid('Project runtime identifier property limit exceeded.');
  const declared = splitList(declaration);
  if (declared.length > 256) invalid('Project runtime identifier limit exceeded.');
  const runtimeIdentifiers = [...new Set([runtimeIdentifier, ...declared].filter(Boolean))];
  const fallbackChains = [];
  const diagnostics = [];
  for (const runtime of runtimeIdentifiers) {
    const result = runtimeFallbacks(runtime, graph);
    fallbackChains.push({ runtimeIdentifier: runtime, runtimes: result.runtimes });
    diagnostics.push(...result.diagnostics);
  }
  return { runtimeIdentifier, runtimeIdentifiers, fallbackChains, diagnostics };
}
