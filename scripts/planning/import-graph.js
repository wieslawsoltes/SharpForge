import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { isMain, writeJSON, report } from './lib/io.js';

const posix = path => path.split(sep).join('/');
export function moduleFiles(root, directories = ['packages', 'apps', 'tests']) {
  const result = [];
  const visit = path => {
    if (!existsSync(resolve(root, path))) return;
    for (const entry of readdirSync(resolve(root, path), { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
      if (['node_modules', 'obj', '.git'].includes(entry.name) && entry.isDirectory()) continue;
      const name = `${path}/${entry.name}`;
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile() && name.endsWith('.js')) result.push(name);
    }
  };
  directories.forEach(visit); return result.sort();
}

// V8 parses import/export declarations, including escaped strings and multiline
// declarations. No module is linked or evaluated. A regex is not a JS parser.
export function parseImports(sources) {
  const program = `import {SourceTextModule} from 'node:vm'; import {readFileSync} from 'node:fs';
    const sources=JSON.parse(readFileSync(0,'utf8'));
    console.log(JSON.stringify(sources.map(({path,source})=>({path,imports:[...new SourceTextModule(source,{identifier:path}).dependencySpecifiers]}))));`;
  const child = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', program], {
    input: JSON.stringify(sources), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000,
  });
  if (child.status !== 0) throw new Error(child.stderr || child.error?.message || 'ESM parsing failed');
  return JSON.parse(child.stdout);
}

export function importGraph(root = process.cwd()) {
  root = resolve(root);
  const packages = new Map();
  for (const entry of readdirSync(resolve(root, 'packages'), { withFileTypes: true })) {
    const path = `packages/${entry.name}/package.json`;
    if (!entry.isDirectory() || !existsSync(resolve(root, path))) continue;
    const data = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
    if (packages.has(data.name)) throw new Error(`Duplicate workspace name: ${data.name}`);
    packages.set(data.name, { path: dirname(path), data });
  }
  const nodes = new Map(), pending = moduleFiles(root), errors = [];
  const targetFile = path => {
    const name = posix(relative(root, path));
    if (name.startsWith('../') || !existsSync(path) || !statSync(path).isFile()) throw new Error('file does not exist inside repository');
    return name;
  };
  const resolveImport = (specifier, importer) => {
    if (builtinModules.includes(specifier) || builtinModules.includes(specifier.replace(/^node:/, ''))) return { external: specifier };
    if (specifier.startsWith('.')) return { path: targetFile(resolve(root, dirname(importer), specifier)) };
    if (specifier.startsWith('@sharpforge/')) {
      const name = specifier.split('/').slice(0, 2).join('/'), workspace = packages.get(name);
      if (!workspace) throw new Error('workspace does not exist');
      const subpath = specifier.slice(name.length), key = subpath ? '.' + subpath : '.';
      const exports = workspace.data.exports;
      const target = exports ? (typeof exports === 'string' && key === '.' ? exports : exports[key]) : (subpath ? '.' + subpath : workspace.data.main);
      if (typeof target !== 'string' || !target.startsWith('./')) throw new Error(`unsupported or missing workspace export ${key}`);
      return { path: targetFile(resolve(root, workspace.path, target)) };
    }
    // Installed external packages must actually resolve; missing dependencies fail.
    const resolved = createRequire(pathToFileURL(resolve(root, importer))).resolve(specifier);
    return { external: specifier, package: !resolved.startsWith(root) || resolved.includes(`${sep}node_modules${sep}`) };
  };
  while (pending.length) {
    const batch = [...new Set(pending.splice(0))].filter(path => !nodes.has(path));
    if (!batch.length) break;
    const parsed = parseImports(batch.map(path => ({ path, source: readFileSync(resolve(root, path), 'utf8') })));
    for (const { path, imports } of parsed) {
      const dependencies = [], external = [];
      for (const specifier of imports) {
        try {
          const target = resolveImport(specifier, path);
          if (target.path) { dependencies.push(target.path); if (target.path.endsWith('.js') && !nodes.has(target.path)) pending.push(target.path); }
          else external.push(target.external);
        } catch (error) { errors.push(`${path}: unresolved ${JSON.stringify(specifier)} (${error.message})`); }
      }
      nodes.set(path, { path, dependencies: [...new Set(dependencies)].sort(), external: [...new Set(external)].sort() });
    }
  }
  return { schemaVersion: 1, kind: 'static-esm', modules: [...nodes.values()].sort((a,b) => a.path.localeCompare(b.path, 'en')), errors: errors.sort() };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { root: {type:'string',default:'.'}, output: {type:'string',default:'planning/contracts/import-graph.json'} } });
  const graph = importGraph(values.root);
  if (!graph.errors.length) writeJSON(values.output, graph);
  report({ modules: graph.modules.length, errors: graph.errors });
}
