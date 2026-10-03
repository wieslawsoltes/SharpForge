import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { sha256, root } from '../oracle/toolchain.js';

export const directory = path.join(root, 'tests/conformance/winui-gallery');
export async function readJSON(file) {
  if ((await stat(file)).size > 4 * 1024 * 1024) throw new Error('Gallery JSON exceeds size limit');
  return JSON.parse(await readFile(file, 'utf8'));
}

/** Verify vendored provenance and fixture identities before running or comparing any case. */
export async function loadGallery() {
  const upstream = await readJSON(path.join(directory, 'upstream.json'));
  const manifest = await readJSON(path.join(directory, 'fixtures.json'));
  const harnessHash = sha256(await readFile(path.join(directory, 'native/Program.cs')));
  const ids = new Set();
  for (const file of upstream.files) {
    const data = await readFile(path.join(directory, 'upstream', file.path));
    if (data.length !== file.bytes || sha256(data) !== file.sha256) throw new Error(`Upstream digest mismatch: ${file.path}`);
  }
  for (const fixture of manifest.cases) {
    if (ids.has(fixture.id)) throw new Error(`Duplicate Gallery case: ${fixture.id}`);
    ids.add(fixture.id);
    for (const [key, hash] of Object.entries(fixture.hashes)) {
      const file = fixture[key];
      if (!/^fixtures\/[a-z-]+\.(cs|xaml)$/.test(file)) throw new Error('Invalid fixture path');
      if (sha256(await readFile(path.join(directory, file))) !== hash) throw new Error(`Stale fixture: ${file}`);
    }
    fixture.inputHash = sha256(JSON.stringify({ commit: upstream.commit, harnessHash, ...fixture }));
  }
  return { upstream, cases: manifest.cases };
}

export function validateDump(dump, catalog) {
  if (dump.schemaVersion !== 1 || dump.oracle !== 'winui-gallery' || dump.target !== 'win32-x64') {
    throw new Error('Invalid Gallery oracle identity');
  }
  if (!Array.isArray(dump.cases) || dump.cases.length !== catalog.cases.length) throw new Error('Incomplete Gallery dump');
  const seen = new Set();
  for (const row of dump.cases) {
    const fixture = catalog.cases.find(item => item.id === row.id);
    if (!fixture || seen.has(row.id) || fixture.inputHash !== row.inputHash) throw new Error('Stale or duplicate Gallery row');
    seen.add(row.id);
    for (const mode of fixture.source ? ['xaml', 'csharp'] : ['xaml']) {
      const result = row[mode];
      if (!result || typeof result.rejected !== 'boolean') throw new Error('Missing native observation');
      if (result.rejected && typeof result.exception !== 'string') throw new Error('Missing native exception');
      if (!result.rejected) {
        if (!result.properties || JSON.stringify(Object.keys(result.properties)) !== JSON.stringify(fixture.properties)) {
          throw new Error('Incomplete native property dump');
        }
      }
    }
  }
  return dump;
}

export function compareObservation(actual, expected) {
  if (actual.rejected !== expected.rejected) return false;
  if (actual.rejected) return true;
  return JSON.stringify(actual.properties) === JSON.stringify(expected.properties);
}

export function statusTable(catalog, rows = []) {
  const lines = ['# WinUI Gallery control status', '',
    `Pinned source: ${catalog.upstream.repository}/tree/${catalog.upstream.commit}`, '',
    'Property snapshots only; layout, rendering, accessibility and interaction parity are not implied.', '',
    '| Sample page | Fixtures | Oracle / source / CIL |', '| --- | ---: | --- |'];
  for (const page of catalog.upstream.pages) {
    const cases = catalog.cases.filter(item => item.control === page.control);
    const results = rows.filter(row => cases.some(item => item.id === row.id));
    const status = results.length ? [...new Set(results.map(row => `${row.engine}: ${row.status}`))].join('; ') :
      cases.length ? 'Native capture pending; source/CIL unqualified' : 'Not ported';
    lines.push(`| ${page.control} | ${cases.length} | ${status} |`);
  }
  return `${lines.join('\n')}\n`;
}
