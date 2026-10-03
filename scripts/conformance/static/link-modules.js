import { SourceTextModule, SyntheticModule } from 'node:vm';
import { isBuiltin } from 'node:module';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve, relative, sep, extname } from 'node:path';

/** Link without evaluate(): missing named exports and ambiguous re-exports fail, with no application execution. */
export async function linkModules(root, paths) {
  root = realpathSync(root);
  const packages = new Map(), modules = new Map(), errors = [];
  for (const entry of readdirSync(resolve(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const base = resolve(root, 'packages', entry.name);
    const data = JSON.parse(readFileSync(resolve(base, 'package.json'), 'utf8'));
    packages.set(data.name, { base, data });
  }
  function condition(value) {
    if (typeof value === 'string' || value === null) return value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    // Node considers matching conditional exports in declaration order.
    for (const [key, target] of Object.entries(value)) {
      if (!['import', 'node', 'default'].includes(key)) continue;
      const selected = condition(target);
      if (selected !== undefined) return selected;
    }
  }
  function local(path) {
    const canonical = realpathSync(path);
    if (!canonical.startsWith(root + sep) || !statSync(canonical).isFile()) throw new Error('Import leaves repository: ' + path);
    return canonical;
  }
  function target(specifier, importer) {
    if (isBuiltin(specifier)) return specifier.startsWith('node:') ? specifier : 'node:' + specifier;
    if (specifier.startsWith('.')) return local(resolve(dirname(importer), specifier));
    const name = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
    const workspace = packages.get(name);
    if (!workspace) throw new Error('Unregistered external module: ' + specifier);
    const subpath = specifier.slice(name.length), key = subpath ? '.' + subpath : '.';
    const map = workspace.data.exports;
    const entry = map ? condition(typeof map === 'string' ? key === '.' ? map : null : map[key] ?? (key === '.' ? map : null))
      : subpath ? '.' + subpath : workspace.data.main;
    if (typeof entry !== 'string' || !entry.startsWith('./')) throw new Error('Missing workspace export: ' + specifier);
    return local(resolve(workspace.base, entry));
  }
  function moduleAt(path) {
    if (modules.has(path)) return modules.get(path);
    let module;
    if (path.startsWith('node:')) {
      const builtin = process.getBuiltinModule(path);
      if (!builtin) throw new Error('Unavailable builtin: ' + path);
      module = new SyntheticModule([...new Set(['default', ...Object.keys(builtin)])], () => {}, { identifier: path });
    } else {
      const source = readFileSync(path, 'utf8');
      if (extname(path) === '.json') {
        JSON.parse(source);
        module = new SyntheticModule(['default'], () => {}, { identifier: path });
      } else module = new SourceTextModule(source, { identifier: path });
    }
    modules.set(path, module); return module;
  }
  for (const path of paths) {
    try {
      const module = moduleAt(local(resolve(root, path)));
      if (module.status === 'unlinked') await module.link((specifier, parent) => moduleAt(target(specifier, parent.identifier)));
      if (module.status === 'errored') throw module.error;
    } catch (error) {
      errors.push({ path, message: error.message.replaceAll(root + sep, '') });
    }
  }
  return { modules: [...modules.keys()].filter(path => !path.startsWith('node:')).map(path => relative(root, path).split(sep).join('/')),
    errors };
}

if (process.argv[2] === '--worker') {
  const { root, paths } = JSON.parse(readFileSync(0, 'utf8'));
  console.log(JSON.stringify(await linkModules(root, paths)));
}
