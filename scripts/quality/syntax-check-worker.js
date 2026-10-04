import {readdir, readFile} from 'node:fs/promises';
import {basename, dirname, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {SourceTextModule} from 'node:vm';

// Only explicit ESM uses the fast path. Node itself retains responsibility for
// CommonJS wrappers, ambiguous .js detection, malformed packages and symlinks.
async function packageMode(directory, inherited) {
  try {
    const data = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'opaque';
    return data.type === 'module' ? 'module' : 'native';
  } catch (error) {
    return error.code === 'ENOENT' ? inherited : 'opaque';
  }
}

async function inheritedMode(directory) {
  const parent = dirname(directory);
  const inherited = parent === directory || basename(directory) === 'node_modules'
    ? 'native'
    : await inheritedMode(parent);
  return packageMode(directory, inherited);
}

function nodeCheck(filename) {
  const result = spawnSync(process.execPath, ['--check', filename], {encoding: 'utf8'});
  if (result.status === 0) return true;
  console.error(result.stderr || result.error?.message || `${filename}: Node syntax check failed`);
  return false;
}

async function checkFile(filename, fast) {
  if (!fast) return nodeCheck(filename);
  try {
    // Construction parses V8's module grammar. Linking and evaluation are never
    // requested, so imports need not resolve and top-level code cannot execute.
    new SourceTextModule(await readFile(filename, 'utf8'), {identifier: filename});
    return true;
  } catch {
    // Failed files are uncommon: retain Node's filename, source excerpt and
    // diagnostic details rather than replacing them with a VM constructor stack.
    return nodeCheck(filename);
  }
}

let count = 0;
let failed = 0;
async function visit(directory, mode) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
    const filename = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(filename, await packageMode(filename, mode));
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      const fast = !entry.isSymbolicLink() && mode !== 'opaque' && (entry.name.endsWith('.mjs') || mode === 'module');
      count++;
      if (!await checkFile(filename, fast)) failed++;
    }
  }
}

const root = resolve(process.argv[2] ?? process.cwd());
await visit(root, await inheritedMode(root));
console.log(`Checked ${count} JavaScript modules; ${failed} syntax errors.`);
process.exitCode = failed ? 1 : 0;
