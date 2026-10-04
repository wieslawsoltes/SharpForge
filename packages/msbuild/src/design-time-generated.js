import { readdir, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

/** Include SDK and generator output as bounded, read-only documents under the granted workspace. */
export async function collectGeneratedSources(workspace, context, { maxFiles = 4096, maxBytes = 33554432 } = {}) {
  const projectDirectory = dirname(resolve(workspace.root, context.project));
  const absolutePath = path => resolve(projectDirectory, path.replaceAll('\\', '/'));
  const roots = new Set([context.properties.IntermediateOutputPath, context.properties.CompilerGeneratedFilesOutputPath]
    .filter(Boolean).map(absolutePath));
  const generated = new Map();
  let total = 0;
  async function add(path) {
    const relative = workspace.relative(path);
    if (!relative || generated.has(relative)) return;
    const safe = await workspace.path(relative), info = await lstat(safe);
    if (!info.isFile()) return;
    if (generated.size >= maxFiles || (total += info.size) > maxBytes) throw new Error('Generated source limit exceeded');
    const record = await workspace.read(relative);
    generated.set(relative, { path: relative, text: record.text, readOnly: true, generated: true });
  }
  async function walk(directory, depth) {
    if (depth > 16) throw new Error('Generated source directory depth exceeded');
    let children;
    try { children = await readdir(await workspace.path(workspace.relative(directory)), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const child of children) {
      if (child.isSymbolicLink()) continue;
      const path = resolve(directory, child.name);
      if (child.isDirectory()) await walk(path, depth + 1);
      else if (child.isFile() && /\.cs$/i.test(child.name)) await add(path);
    }
  }
  for (const source of context.sources) {
    if (/(?:^|[/\\])obj[/\\]|(?:\.g|\.generated)\.cs$|Assembly(?:Info|Attributes)\.cs$/i.test(source.path)) {
      await add(absolutePath(source.path));
    }
  }
  for (const root of roots) if (workspace.relative(root)) await walk(root, 0);
  return [...generated.values()].sort((left, right) => left.path.localeCompare(right.path));
}
