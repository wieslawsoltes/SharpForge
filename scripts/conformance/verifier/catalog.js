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
    if (!/^[a-z0-9-]+$/.test(row.rule ?? '')) throw new Error('Invalid rule identity');
    const sourcePath = /^(?:fixtures\/[a-z0-9-]+|upstream\/src\/tests\/ilverify\/ILTests\/[A-Za-z]+)\.il$/;
    if (!sourcePath.test(row.source) || !/^[a-f0-9]{64}$/.test(row.sha256)) {
      throw new Error('Invalid IL identity');
    }
    if (!['accept', 'reject'].includes(row.polarity) || !/^III\.\d[\d.]*$/.test(row.section)) {
      throw new Error('Invalid rule');
    }
    if (!Array.isArray(row.expectedErrors) || (row.polarity === 'reject') !== (row.expectedErrors.length > 0)) {
      throw new Error('Rule polarity requires explicit verifier diagnostics');
    }
    for (const rule of row.rules ?? [row.rule]) {
      if (!/^[a-z0-9-]+$/.test(rule)) throw new Error('Invalid associated rule');
      const pair = rules.get(rule) ?? new Set();
      pair.add(row.polarity);
      rules.set(rule, pair);
    }
  }
  if ([...rules.values()].some(pair => pair.size !== 2)) throw new Error('Each tracked rule needs an accepting and rejecting case');
  return rules;
}

export async function loadCorpus() {
  const manifest = await readJSON(path.join(directory, 'fixtures.json'));
  const upstream = await readJSON(path.join(directory, 'upstream.json'));
  const inventory = await readJSON(path.join(directory, 'rules.json'));
  validateCases(manifest.cases);
  for (const row of manifest.cases) {
    if (sha256(await readFile(path.join(directory, row.source))) !== row.sha256) throw new Error(`Stale IL fixture: ${row.id}`);
    row.inputHash = sha256(JSON.stringify(row));
  }
  for (const row of upstream.files) {
    const bytes = await readFile(path.join(directory, 'upstream', row.path));
    if (bytes.length !== row.bytes || sha256(bytes) !== row.sha256) throw new Error(`Stale upstream IL: ${row.path}`);
  }
  for (const rule of manifest.rules) {
    for (const polarity of ['accept', 'reject']) {
      const fixture = manifest.cases.find(row => row.id === rule[polarity]);
      if (!fixture?.rules.includes(rule.id) || fixture.polarity !== polarity) throw new Error('Broken rule-case link');
    }
  }
  const inventoryHash = sha256(JSON.stringify({ specification: manifest.specification, rules: manifest.rules, inventory }));
  return { ...manifest, upstream, inventory, inventoryHash };
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
    (!observation.accepted || observation.errors.length === 0) &&
    row.expectedErrors.every(code => observation.errors.includes(code));
}

export function validateCapture(capture, catalog, toolPin) {
  if (capture.schemaVersion !== 1 || capture.oracle !== 'ilverify' || capture.version !== toolPin.version ||
      capture.toolSHA256 !== toolPin.files.find(file => file.path === toolPin.entry).sha256) throw new Error('ILVerify pin mismatch');
  if (capture.inventoryHash !== catalog.inventoryHash || capture.sanityChecks !== false) {
    throw new Error('Stale verifier rule inventory or oracle mode');
  }
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
        !Array.isArray(row.oracle?.errors) ||
        row.oracle.errors.some(code => typeof code !== 'string' || !/^[A-Za-z0-9]+$/.test(code))) {
      throw new Error('Invalid verifier observation');
    }
    if (!checkOracle(fixture, row.oracle)) throw new Error(`Oracle disagrees with declared rule: ${row.id}`);
  }
  return capture;
}

export function ruleTable(catalog, capture = null) {
  const lines = ['# ECMA-335 verifier rule coverage', '',
    'ILVerify diagnostic IDs are not ECMA rule IDs. Section mappings identify the versioned method-body constraints.', '',
    '| Rule | ECMA-335 section | Accept | Reject | Oracle |', '| --- | --- | --- | --- | --- |'];
  for (const rule of catalog.rules) {
    const status = capture ? 'captured' : 'not run';
    lines.push(`| ${rule.id} | ${rule.section} | ${rule.accept} | ${rule.reject} | ${status} |`);
  }
  lines.push('', '## Pinned upstream diagnostic inventory', '',
    '| ILVerify diagnostic | Classification | Paired constraints |', '| --- | --- | --- |');
  for (const diagnostic of catalog.inventory.diagnostics) {
    const pairs = diagnostic.rules.join(', ') || 'not a method-body verifiability rule';
    lines.push(`| ${diagnostic.id} | ${diagnostic.classification} | ${pairs} |`);
  }
  return `${lines.join('\n')}\n`;
}
