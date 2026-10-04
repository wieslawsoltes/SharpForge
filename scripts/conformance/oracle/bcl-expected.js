import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadBclExpectedFixtures, validateBclExpectedResult } from './bcl-expected-fixtures.js';
import { cultures } from './bcl-run.js';
import { envelope, expectedRoot, expectedPath, verifyEntry, validateSchema, compareExpected } from './store.js';
import { pin, assertPins, requireTarget, sha256 } from './toolchain.js';

const equal = (actual, expected, label) => {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`BCL capture ${label} mismatch`);
};
const command = value => Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && item.length > 0);
const timings = value => Array.isArray(value) && value.length === 2 && value.every(item => Number.isFinite(item) && item >= 0);

function validateEnvironment(environment, target) {
  if (!environment || environment.platform !== target || typeof environment.osRelease !== 'string' ||
      !environment.osRelease || typeof environment.node !== 'string' || !environment.node) {
    throw new Error('BCL capture environment/target mismatch');
  }
  const image = environment.image;
  if (image?.kind === 'local' && image.pinnedImage === false) return;
  if (image?.kind === 'container' && target === 'linux-x64' && image.pinnedImage === true && image.digest === pin.images.linux.container) return;
  const expected = target === 'win32-x64' ? pin.images.windows : target === 'darwin-arm64' ? pin.images.macos : null;
  if (image?.kind === 'github-hosted' && image.pinnedImage === true && expected &&
      image.imageOS === expected.imageOS && image.imageVersion === expected.imageVersion &&
      environment.imageOS === expected.imageOS && environment.imageVersion === expected.imageVersion) return;
  throw new Error('BCL capture image provenance mismatch');
}

/** Read capture evidence only; no compiler, runtime, or capture command is executed. */
export async function validateBclCapture(input, { directory } = {}) {
  const report = structuredClone(input);
  if (!report || report.schemaVersion !== 1 || report.status !== 'captured-not-baseline-qualified' ||
      report.dirty !== false || !/^[a-f0-9]{40}$/.test(report.commit ?? '') ||
      typeof report.capturedAt !== 'string' || !Number.isFinite(Date.parse(report.capturedAt)) || !command(report.command)) {
    throw new Error('BCL capture requires a complete clean-revision capture receipt');
  }
  equal(report.failures, [], 'failures');
  equal(report.unsupported, [], 'unsupported targets');
  equal(report.cultures, cultures, 'cultures');
  equal(report.declaredCases, 200, 'declared coverage');
  equal(report.pinnedToolchain, pin, 'pinned toolchain');
  if (!requireTarget('coreclr', report.target).supported) throw new Error('BCL capture target is unsupported');
  if (!report.toolchain) throw new Error('BCL capture resolved toolchain is missing');
  assertPins(report.toolchain, pin, report.target);
  validateEnvironment(report.toolchain.environment, report.target);

  const fixtures = await loadBclExpectedFixtures(directory);
  if (!Array.isArray(report.families) || report.families.length !== 5) throw new Error('BCL capture requires all five families');
  const seen = new Set(), entries = [];
  for (const family of report.families) {
    const familyFixtures = fixtures.filter(item => item.family === family?.family);
    if (familyFixtures.length !== 2 || seen.has(family.family)) throw new Error('BCL capture unknown or duplicate family');
    seen.add(family.family);
    const fixture = familyFixtures[0];
    equal(family.inputHash, fixture.familyInputHash, `${family.family} input hash`);
    equal(family.sourceSHA256, fixture.sourceSHA256, `${family.family} source hash`);
    equal(family.catalogSHA256, fixture.catalogSHA256, `${family.family} catalog hash`);
    const compiled = family.compilation;
    if (!compiled || !timings(compiled.timings) || !command(compiled.command)) throw new Error('BCL capture requires repeated compilation evidence');
    validateSchema(envelope('roslyn', fixture, compiled.result, report.target));
    if (compiled.result.exitCode !== 0 || !/^[a-f0-9]{64}$/.test(compiled.result.assemblySHA256 ?? '') ||
        compiled.result.diagnostics.some(item => item.severity === 'error')) throw new Error('BCL capture compilation failed');
    if (!Array.isArray(family.captures) || family.captures.length !== 2) throw new Error('BCL capture requires both cultures');
    const seenCultures = new Set();
    for (const capture of family.captures) {
      const current = familyFixtures.find(item => item.culture === capture?.culture);
      if (!current || seenCultures.has(capture.culture)) throw new Error('BCL capture unknown or duplicate culture');
      seenCultures.add(capture.culture);
      equal(capture.inputHash, current.inputHash, `${current.id} input hash`);
      if (!timings(capture.timings) || !command(capture.command)) throw new Error('BCL capture requires repeated execution evidence');
      const entry = envelope('coreclr', current, capture.result, report.target);
      await verifyEntry(entry, fixtures);
      equal(capture.observations, validateBclExpectedResult(current, capture.result), `${current.id} observations`);
      entries.push(entry);
    }
  }
  // Canonical store order is independent of the receipt's family/culture order.
  entries.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));
  return { entries, report: { commit: report.commit, capturedAt: report.capturedAt, target: report.target,
    captureSHA256: sha256(JSON.stringify(report)), image: report.toolchain.environment.image,
    families: 5, declaredCases: 200, cultures: [...cultures], observations: 400 } };
}

async function existingEntry(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

/** Validate the whole corpus and all existing keys before creating any baseline. */
export async function adoptBclCapture(report, { store = expectedRoot, directory } = {}) {
  const validated = await validateBclCapture(report, { directory });
  const pending = [];
  for (const entry of validated.entries) {
    const file = expectedPath(entry, store), existing = await existingEntry(file);
    if (existing !== undefined && !isDeepStrictEqual(existing, entry)) throw new Error(`Conflicting BCL expected output: ${file}`);
    if (existing === undefined) pending.push({ file, entry });
  }
  let written = 0;
  for (const { file, entry } of pending) {
    await mkdir(path.dirname(file), { recursive: true });
    try { await writeFile(file, `${JSON.stringify(entry, null, 2)}\n`, { flag: 'wx' }); written++; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!isDeepStrictEqual(await existingEntry(file), entry)) throw new Error(`Conflicting BCL expected output: ${file}`);
    }
  }
  return { status: 'adopted-not-qualified', ...validated.report, entries: validated.entries.length, written };
}

/** Compare a complete current capture against every family/culture baseline. */
export async function verifyBclCapture(report, { store = expectedRoot, directory } = {}) {
  const validated = await validateBclCapture(report, { directory });
  for (const entry of validated.entries) await compareExpected(entry, store);
  return { status: 'matched-reference-baselines', ...validated.report, entries: validated.entries.length };
}

export async function main(args = process.argv.slice(2)) {
  if (!['--adopt', '--verify'].includes(args[0]) || !args[1] ||
      !(args.length === 2 || (args.length === 4 && args[2] === '--store' && args[3]))) {
    throw new Error('Usage: bcl-expected.js (--adopt|--verify) CAPTURE.json [--store DIRECTORY]');
  }
  const report = JSON.parse(await readFile(path.resolve(args[1]), 'utf8'));
  const operation = args[0] === '--adopt' ? adoptBclCapture : verifyBclCapture;
  console.log(JSON.stringify(await operation(report, { store: args[3] ? path.resolve(args[3]) : expectedRoot })));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
