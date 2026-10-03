import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { root, sha256, pin } from '../oracle/toolchain.js';

export const directory = path.join(root, 'tests/conformance/verifier');
export async function readJSON(file) {
  if ((await stat(file)).size > 16 * 1024 * 1024) throw new Error('Verifier JSON exceeds size limit');
  return JSON.parse(await readFile(file, 'utf8'));
}

export function validateCases(cases) {
  if (!Array.isArray(cases) || !cases.length || cases.length > 10000) throw new Error('Invalid verifier corpus size');
  const ids = new Set();
  const rules = new Map();
  for (const row of cases) {
    if (!/^[a-z0-9-]+$/.test(row.id) || ids.has(row.id)) throw new Error('Duplicate or invalid case identity');
    ids.add(row.id);
    if (!/^fixtures\/[a-z0-9-]+\.il$/.test(row.source) || !/^[a-f0-9]{64}$/.test(row.sha256)) {
      throw new Error('Invalid IL identity');
    }
    if (!['accept', 'reject'].includes(row.polarity) || !/^III\.\d[\d.]*$/.test(row.section)) {
      throw new Error('Invalid rule');
    }
    if (!Array.isArray(row.expectedErrors) || (row.polarity === 'reject') !== (row.expectedErrors.length > 0)) {
      throw new Error('Rule polarity requires explicit verifier diagnostics');
    }
    const pair = rules.get(row.rule) ?? new Set();
    pair.add(row.polarity);
    rules.set(row.rule, pair);
  }
  if ([...rules.values()].some(pair => pair.size !== 2)) throw new Error('Each tracked rule needs an accepting and rejecting case');
  return rules;
}

export async function loadCorpus() {
  const manifest = await readJSON(path.join(directory, 'fixtures.json'));
  const upstream = await readJSON(path.join(directory, 'upstream.json'));
  validateCases(manifest.cases);
  for (const row of manifest.cases) {
    if (sha256(await readFile(path.join(directory, row.source))) !== row.sha256) throw new Error(`Stale IL fixture: ${row.id}`);
    row.inputHash = sha256(JSON.stringify(row));
  }
  for (const row of upstream.files) {
    const bytes = await readFile(path.join(directory, 'upstream', row.path));
    if (bytes.length !== row.bytes || sha256(bytes) !== row.sha256) throw new Error(`Stale upstream IL: ${row.path}`);
  }
  return { ...manifest, upstream };
}

/** A tool invocation failure or a zero-method include filter is never a rejection oracle. */
export function parseILVerify(result) {
  if (result.signal || ![0, 2].includes(result.exitCode)) throw new Error('ILVerify invocation failed');
  const output = `${result.stdout}\n${result.stderr}`;
  const counts = [...output.matchAll(/^Methods verified: (\d+)\s*$/gm)].map(match => Number(match[1]));
  if (counts.length !== 1 || counts[0] !== 1) throw new Error('ILVerify must verify exactly one selected method');
  const errors = [...new Set([...output.matchAll(/\[IL\]: Error \[([A-Za-z0-9]+)\]/g)].map(match => match[1]))].sort();
  if ((result.exitCode === 2) !== (errors.length > 0)) throw new Error('ILVerify exit/diagnostic mismatch');
  return { accepted: result.exitCode === 0, errors };
}

export function checkOracle(row, observation) {
  return observation.accepted === (row.polarity === 'accept') &&
    row.expectedErrors.every(code => observation.errors.includes(code));
}

export function validateCapture(capture, catalog, toolPin) {
  if (capture.schemaVersion !== 1 || capture.oracle !== 'ilverify' || capture.version !== toolPin.version ||
      capture.toolSHA256 !== toolPin.files.find(file => file.path === toolPin.entry).sha256) throw new Error('ILVerify pin mismatch');
  if (!pin.platforms.coreclr.includes(capture.target) || capture.sdk !== pin.sdk || capture.runtime !== pin.runtime ||
      capture.references?.count !== pin.referenceAssemblies.count ||
      capture.references?.sha256 !== pin.referenceAssemblies.sha256) throw new Error('Verifier reference toolchain mismatch');
  if (!Array.isArray(capture.cases) || capture.cases.length !== catalog.cases.length) throw new Error('Incomplete verifier capture');
  const ids = new Set();
  for (const row of capture.cases) {
    const fixture = catalog.cases.find(item => item.id === row.id);
    if (!fixture || ids.has(row.id) || fixture.inputHash !== row.inputHash) throw new Error('Stale or duplicate verifier capture');
    ids.add(row.id);
    if (!/^[a-f0-9]{64}$/.test(row.assemblySHA256) || typeof row.oracle?.accepted !== 'boolean' ||
        !Array.isArray(row.oracle?.errors)) throw new Error('Invalid verifier observation');
    if (!checkOracle(fixture, row.oracle)) throw new Error(`Oracle disagrees with declared rule: ${row.id}`);
  }
  return capture;
}

export function ruleTable(catalog, capture = null) {
  const lines = ['# ECMA-335 verifier rule coverage', '',
    'ILVerify diagnostic IDs are not ECMA rule IDs. Section mappings below identify the authored seed rules.', '',
    '| Rule | ECMA-335 section | Accept | Reject | Oracle |', '| --- | --- | --- | --- | --- |'];
  for (const rule of new Set(catalog.cases.map(row => row.rule))) {
    const cases = catalog.cases.filter(row => row.rule === rule);
    const polarity = kind => cases.find(row => row.polarity === kind).id;
    const status = capture ? 'captured' : 'not run';
    lines.push(`| ${rule} | ${cases[0].section} | ${polarity('accept')} | ${polarity('reject')} | ${status} |`);
  }
  lines.push('', '## Pinned upstream diagnostic inventory', '',
    '| ILVerify diagnostic | Imported rejecting methods | Authored pair |', '| --- | ---: | --- |');
  for (const diagnostic of catalog.upstream.diagnostics) {
    const count = catalog.upstream.cases.filter(row => row.expectedErrors.includes(diagnostic.id)).length;
    const pair = catalog.cases.some(row => row.expectedErrors.includes(diagnostic.id));
    lines.push(`| ${diagnostic.id} | ${count} | ${pair ? 'present; qualification pending' : 'missing'} |`);
  }
  return `${lines.join('\n')}\n`;
}
