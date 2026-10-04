import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pin, root } from '../oracle/toolchain.js';
import { loadGallery, readJSON, validateDump, compareObservation, statusTable } from './catalog.js';
import { runCandidate } from './candidate.js';

export async function reportGallery({ oracleFile, output = path.join(root, 'artifacts/results/winui-gallery') } = {}) {
  const catalog = await loadGallery();
  const oracle = oracleFile ? validateDump(await readJSON(oracleFile), catalog) : null;
  if (oracle && (oracle.windowsAppSDK !== pin.windowsAppSDK || oracle.sdk !== pin.sdk || oracle.runtime !== pin.runtime)) {
    throw new Error('Stale Windows oracle toolchain');
  }
  const rows = [];
  for (const fixture of catalog.cases) {
    for (const engine of ['source', 'cil']) {
      const actual = await runCandidate(fixture, engine);
      const expected = oracle?.cases.find(item => item.id === fixture.id)?.csharp;
      const status = actual.status === 'unsupported' ? 'unsupported' : !expected ? 'missing-oracle' :
        compareObservation(actual.observation, expected) ? 'agree' : 'disagree';
      rows.push({ id: fixture.id, inputHash: fixture.inputHash, engine, ...actual, status });
    }
  }
  const unsupported = [
    { engine: 'browser', reason: 'DOM rendering and interaction capture adapter is not implemented by this property suite.' },
    { engine: 'rust-native', reason: 'No public WinUI engine adapter is available.' },
    { engine: 'rust-wasm', reason: 'No public WinUI engine adapter is available.' },
  ];
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'results.json'), `${JSON.stringify({ schemaVersion: 1, rows, unsupported }, null, 2)}\n`);
  await writeFile(path.join(output, 'status.md'), statusTable(catalog, rows));
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rows = await reportGallery({ oracleFile: process.argv[2] });
  console.log(JSON.stringify({ rows: rows.length, statuses: [...new Set(rows.map(row => row.status))] }));
  if (rows.some(row => row.status === 'disagree')) process.exitCode = 1;
}
