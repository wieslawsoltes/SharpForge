import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { moduleSyntax } from './module-syntax.js';

const browserOnlyNodeAdapters = new Set(['node:worker_threads']);

function validateStaticGraph(modules) {
  const visited = new Set(), active = new Set();
  const visit = id => {
    if (active.has(id)) throw new Error(`Static module cycle: ${modules[id].path}`);
    if (visited.has(id)) return;
    active.add(id);
    for (const edge of modules[id].dependencies) if (!edge.dynamic) visit(edge.id);
    active.delete(id);
    visited.add(id);
  };
  for (const module of modules) visit(module.id);
}

function exportedNames(modules) {
  const resolved = new Map();
  const visit = id => {
    if (resolved.has(id)) return resolved.get(id);
    const module = modules[id], names = new Map(), explicit = new Set();
    for (const record of module.syntax) if (['declaration', 'exports'].includes(record.kind)) {
      for (const binding of record.bindings) {
        if (explicit.has(binding.alias)) throw new Error(`Duplicate export ${binding.alias} in ${module.path}`);
        explicit.add(binding.alias);
        names.set(binding.alias, { local: binding.name, identity: `${id}:${binding.name}` });
      }
    }
    for (const record of module.syntax.filter(item => item.kind === 'reexport')) {
      const dependency = visit(record.id);
      for (const binding of record.bindings ?? [...dependency.keys()].map(name => ({ name, alias: name }))) {
        const value = dependency.get(binding.name);
        if (!value) {
          if (record.bindings) throw new Error(`Missing or ambiguous export ${binding.name} in ${modules[record.id].path}`);
          continue;
        }
        if (record.bindings) {
          if (explicit.has(binding.alias)) throw new Error(`Duplicate export ${binding.alias} in ${module.path}`);
          explicit.add(binding.alias);
        } else if (explicit.has(binding.alias)) continue;
        const candidate = { id: record.id, name: binding.name, identity: value.identity };
        const current = names.get(binding.alias);
        names.set(binding.alias, !record.bindings && names.has(binding.alias) && current?.identity !== candidate.identity ? null : candidate);
      }
    }
    resolved.set(id, names);
    return names;
  };
  for (const module of modules) module.exports = visit(module.id);
  for (const module of modules) for (const record of module.syntax.filter(item => item.kind === 'static')) {
    for (const binding of record.bindings) if (!modules[record.id].exports.get(binding.name)) {
      throw new Error(`Missing or ambiguous export ${binding.name} imported by ${module.path}`);
    }
  }
}

export async function collectModules(entry, options = {}) {
  const root = options.root ? await realpath(options.root) : null;
  const modules = [], ids = new Map();
  const local = async path => {
    const canonical = await realpath(path);
    if (root && canonical !== root && !canonical.startsWith(root + sep)) throw new Error(`Module leaves bundle root: ${path}`);
    if (!(await stat(canonical)).isFile()) throw new Error(`Module is not a file: ${path}`);
    return canonical;
  };
  const dependency = async (specifier, importer) => {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw new Error(`Unresolved dependency ${specifier} in ${importer}`);
    if (/[?#\u0000]/.test(specifier) || !/\.m?js$/.test(specifier)) throw new Error(`Unsupported module path ${specifier}`);
    return local(resolve(dirname(importer), specifier));
  };
  async function visit(path) {
    path = await local(path);
    if (ids.has(path)) return ids.get(path);
    const id = modules.length, source = await readFile(path, 'utf8');
    let syntax;
    try { syntax = moduleSyntax(source); } catch (error) { throw new Error(`${path}: ${error.message}`, { cause: error }); }
    const module = { id, path, source, syntax, dependencies: [] };
    modules.push(module);
    ids.set(path, id);
    for (const record of syntax) {
      if (record.kind === 'worker') {
        if (!options.workerUrl) throw new Error(`Worker URL requires an explicit asset resolver in ${path}`);
        const target = await dependency(record.specifier, path);
        record.asset = await options.workerUrl(target);
      } else if (record.specifier) {
        if (record.kind === 'dynamic' && browserOnlyNodeAdapters.has(record.specifier)) {
          record.unavailable = record.specifier;
          continue;
        }
        record.id = await visit(await dependency(record.specifier, path));
        module.dependencies.push({ id: record.id, dynamic: record.kind === 'dynamic' });
      }
    }
    return id;
  }
  const entryId = await visit(entry);
  validateStaticGraph(modules);
  exportedNames(modules);
  return { modules, entryId };
}
