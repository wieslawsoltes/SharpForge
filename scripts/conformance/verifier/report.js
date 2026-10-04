import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, sha256 } from '../oracle/toolchain.js';
import { loadCorpus, readJSON, validateCapture, ruleTable } from './catalog.js';
import { verifierPin } from './tools.js';
import { verifyCandidate } from './candidate.js';

export async function reportVerifier({ captureDirectory, output = path.join(root, 'artifacts/results/verifier-report') } = {}) {
  const catalog = await loadCorpus();
  const capture = captureDirectory ?
    validateCapture(await readJSON(path.join(captureDirectory, 'oracle.json')), catalog, verifierPin) : null;
  const rows = [];
  for (const fixture of catalog.cases) {
    if (!capture) {
      rows.push({ id: fixture.id, status: 'missing-oracle', reason: 'No pinned assembled IL and real ILVerify capture provided.' });
      continue;
    }
    const native = capture.cases.find(row => row.id === fixture.id);
    const bytes = await readFile(path.join(captureDirectory, 'assemblies', `${fixture.id}.dll`));
    if (sha256(bytes) !== native.assemblySHA256) throw new Error(`Stale assembly: ${fixture.id}`);
    const candidate = verifyCandidate(bytes, fixture.method);
    rows.push({ id: fixture.id, inputHash: fixture.inputHash, engine: 'public-cil-verifier', candidate, oracle: native.oracle,
      status: candidate.status === 'unsupported' ? 'unsupported' : candidate.accepted === native.oracle.accepted ? 'agree' : 'disagree' });
  }
  const unsupported = [
    { engine: 'source-vm', reason: 'Hand-assembled IL verification uses the public CIL API; no source-image adapter exists.' },
    { engine: 'browser', reason: 'Browser execution of this verifier corpus has not been qualified.' },
    { engine: 'rust-native', reason: 'No public Rust verifier adapter is available.' },
    { engine: 'rust-wasm', reason: 'No public Rust verifier adapter is available.' },
  ];
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'results.json'), `${JSON.stringify({ schemaVersion: 1, rows, unsupported }, null, 2)}\n`);
  await writeFile(path.join(output, 'status.md'), ruleTable(catalog, capture));
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rows = await reportVerifier({ captureDirectory: process.argv[2] });
  console.log(JSON.stringify({ cases: rows.length, statuses: [...new Set(rows.map(row => row.status))] }));
  if (rows.some(row => row.status === 'disagree')) process.exitCode = 1;
}
