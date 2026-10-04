import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureConversions, conversionSourceIdentity, parseConversionOptions, saveConversionChunk} from './conversion-capture.js';
import {conversionDigest, verifyConversionCapture, verifyConversionQualification} from './conversion-proof.js';
import {replayConversionCapture} from './conversion-replay.js';

const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

function artifactInventory(directory, current = directory) {
  const rows = [];
  for (const entry of readdirSync(current, {withFileTypes: true})) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) rows.push(...artifactInventory(directory, path));
    else if (entry.isFile() && !['artifacts.json', 'final-outcome.json'].includes(entry.name)) {
      const bytes = readFileSync(path);
      rows.push({path: relative(directory, path).replaceAll('\\', '/'), bytes: bytes.length, sha256: conversionDigest(bytes)});
    }
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

/** Preserve partial failures; a fresh run must never overwrite prior native answers. */
export async function qualifyConversions(options) {
  assert(!existsSync(options.output), 'Conversion evidence output already exists; choose a new path');
  mkdirSync(options.output, {recursive: true});
  const report = {format: 'SharpForge.NativeConversionQualification/1', status: 'running',
    expected: {bits: options.bits, sdk: options.sdk}, createdAt: new Date().toISOString(),
    scope: 'Exact existing 33-opcode, five-source conversion matrix; no Int64 100,000-pair corpus.',
    node: process.version, platform: process.platform, architecture: process.arch,
    argv: process.argv, resources: Object.fromEntries(['SHARPFORGE_TEST_CONCURRENCY', 'SHARPFORGE_MAX_PARALLEL_RUNS',
      'SHARPFORGE_MAX_OLD_SPACE_MB', 'NODE_OPTIONS'].map(key => [key, process.env[key] ?? null])),
    github: Object.fromEntries(['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'RUNNER_OS', 'RUNNER_ARCH']
      .map(key => [key, process.env[key] ?? null]))};
  const journal = {createdAt: report.createdAt, commands: []};
  try {
    report.sourceBefore = conversionSourceIdentity(options.sdk);
    journal.sourceBefore = report.sourceBefore;
    writeJson(join(options.output, 'qualification.json'), report);
    const {capture, inventory} = await captureConversions(options, journal);
    const {cases, output, ...identity} = capture;
    report.capture = identity;
    report.inventory = inventory;
    writeJson(join(options.output, 'qualification.json'), report);
    report.replay = replayConversionCapture(cases, output,
      (row, artifacts) => saveConversionChunk(options.output, row, artifacts));
    report.sourceAfter = conversionSourceIdentity(options.sdk);
    report.status = 'passed';
    verifyConversionQualification(report, options);
  } catch (error) {
    report.status = 'failed';
    report.error = {name: error.name, message: error.message, stack: error.stack};
  } finally {
    report.completedAt = new Date().toISOString();
    writeJson(join(options.output, 'qualification.json'), report);
    writeJson(join(options.output, 'artifacts.json'), artifactInventory(options.output));
  }
  return report;
}

/** Recheck raw evidence and route completeness after setup, timeout or an ordinary run. */
export function finalizeConversions(options) {
  mkdirSync(options.output, {recursive: true});
  const outcome = {format: 'SharpForge.NativeConversionOutcome/1', status: 'failed', expected: {bits: options.bits, sdk: options.sdk}};
  try {
    const report = JSON.parse(readFileSync(join(options.output, 'qualification.json'), 'utf8'));
    const inventory = JSON.parse(readFileSync(join(options.output, 'artifacts.json'), 'utf8'));
    assert.deepEqual(artifactInventory(options.output), inventory, 'Captured evidence files changed');
    verifyConversionQualification(report, options);
    const capture = {...report.capture, cases: JSON.parse(readFileSync(join(options.output, 'conversions.json'), 'utf8')),
      output: readFileSync(join(options.output, 'conversions.txt'), 'utf8')};
    assert.deepEqual(verifyConversionCapture(capture, options), report.inventory);
    outcome.status = 'passed';
    outcome.inventory = report.inventory;
    outcome.qualificationSha256 = conversionDigest(readFileSync(join(options.output, 'qualification.json')));
  } catch (error) {
    outcome.error = {name: error.name, message: error.message};
  }
  writeJson(join(options.output, 'final-outcome.json'), outcome);
  return outcome;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const options = parseConversionOptions(process.argv.slice(2));
  const result = options.finalize ? finalizeConversions(options) : await qualifyConversions(options);
  console.log(JSON.stringify({status: result.status, cases: result.inventory?.cases, error: result.error?.message}));
  if (result.status !== 'passed') process.exitCode = 1;
}
