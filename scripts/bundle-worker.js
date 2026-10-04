/** Compile this repository's closed ESM graph to ordinary, deferred JavaScript factories. */
import { Script } from 'node:vm';
import { collectModules } from './bundling/module-graph.js';
import { emitBundle } from './bundling/emit.js';

export async function bundleWorker(entry, options = {}) {
  const graph = await collectModules(entry, options);
  const script = emitBundle(graph);
  // Parsing does not evaluate application code. Unsupported top-level syntax fails before an artifact is written.
  new Script(script, { filename: entry });
  options.onGraph?.(graph.modules.map(module => ({ path: module.path,
    dependencies: module.dependencies.map(item => ({ path: graph.modules[item.id].path, dynamic: item.dynamic })) })));
  return script;
}
