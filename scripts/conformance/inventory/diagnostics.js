import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { root, counts, sha256 } from './common.js';
export async function compilerDiagnosticIds(directory = path.join(root, 'packages/compiler/src')) {
  const files = [], ids = new Set();
  async function walk(dir) { for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      const bytes = await readFile(file); files.push({ name: path.relative(root, file).split(path.sep).join('/'), sha256: sha256(bytes) });
      for (const match of bytes.toString('utf8').matchAll(/\bCS([0-9]{4,5})\b/g)) ids.add(`CS${match[1]}`);
    }
  } }
  await walk(directory); return { ids, files };
}
export async function diagnosticInventory(reference, options = {}) {
  const { ids, files } = options.source ?? await compilerDiagnosticIds();
  const aliases = new Map();
  for (const row of reference.rows) { const id = `CS${String(row.value).padStart(4, '0')}`; if (!aliases.has(id)) aliases.set(id, []); aliases.get(id).push(row.name); }
  const rows = [...aliases].map(([id,names]) => ({ key: `diagnostic:${id}`, domain: 'DIAG', name: id, names: names.sort(), area: 'A02', specRevision: 'roslyn-5.3.0-2.26153.122',
    status: ids.has(id) ? 'implemented' : 'missing', statusScope: 'literal ID presence in compiler sources; trigger, severity, spans and message behavior remain unqualified',
    qualification: 'unknown', reason: 'An ErrorCode enum identifier and a source literal do not prove diagnostic behavior.' }));
  return { schemaVersion: 1, reference: { assembly: reference.assembly, sha256: reference.sha256, extractor: reference.extractor }, sourceFiles: files, rows, totals: counts(rows) };
}
