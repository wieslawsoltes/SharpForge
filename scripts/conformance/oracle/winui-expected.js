import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { pin, sha256, assertPins } from './toolchain.js';
import { envelope, expectedPath, expectedRoot, compareExpected, verifyEntry } from './store.js';
import { loadWinuiExpectedFixture, validateWinuiExpectedResult } from './winui-expected-fixtures.js';

const hash = /^[a-f0-9]{64}$/;
const require = (condition, message) => { if (!condition) throw new Error(message); };
const same = (left, right, message) => require(isDeepStrictEqual(left, right), message);
const slash = value => typeof value === 'string' ? value.replaceAll('\\', '/') : value;
function successfulProcess(value, native = false) {
  require(value && value.exitCode === 0 && value.signal === null && typeof value.stdout === 'string' && typeof value.stderr === 'string' &&
    Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0, 'Incomplete or failed WinUI process');
  if (native) require(value.stderr === '' && value.stdout === '', 'Unexpected native WinUI stdout/stderr');
}
function environment(value) {
  require(value?.platform === 'win32-x64' && typeof value.node === 'string' && /^v\d+\.\d+\.\d+$/.test(value.node), 'WinUI capture environment mismatch');
  require(/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value.osRelease ?? '') && Number(value.osRelease.split('.')[2]) >= pin.images.windows.minimumBuild, 'WinUI capture Windows build mismatch');
  const image = value.image;
  if (image?.kind === 'github-hosted') {
    require(image.pinnedImage === true && image.imageOS === pin.images.windows.imageOS && image.imageVersion === pin.images.windows.imageVersion &&
      value.imageOS === image.imageOS && value.imageVersion === image.imageVersion, 'WinUI capture runner image mismatch');
  } else require(image?.kind === 'local' && image.pinnedImage === false && typeof image.reason === 'string' && image.reason.length > 0, 'Missing Windows capture provenance');
}

/** Validate a retained report only. This never executes its recorded commands. */
export function validateWinuiCapture(report, fixture, reviewedCommit) {
  require(/^[a-f0-9]{40}$/.test(reviewedCommit ?? '') && report?.commit === reviewedCommit && report.dirty === false, 'WinUI capture source is not the reviewed clean commit');
  require(report.schemaVersion === 1 && report.status === 'captured-not-baseline-qualified' && report.target === 'win32-x64' && report.declaredFixtures === 20, 'WinUI capture is incomplete or unsupported');
  same(report.failures, [], 'WinUI capture contains failures'); same(report.unsupported, [], 'WinUI capture contains unsupported results');
  require(!Object.hasOwn(report, 'nativeFailure'), 'WinUI capture contains a native failure');
  require(typeof report.capturedAt === 'string' && Number.isFinite(Date.parse(report.capturedAt)), 'Missing capture timestamp');
  require(Array.isArray(report.command) && report.command.length >= 4 && report.command.every(value => typeof value === 'string' && value.length > 0), 'Missing capture invocation');
  same(report.pinnedToolchain, pin, 'WinUI capture pinned toolchain changed');
  require(report.inputHash === fixture.inputHash, 'WinUI capture input hash is stale');
  same(report.materials, fixture.input.materials, 'WinUI capture source/input materials changed');
  assertPins(report.toolchain, pin, 'win32-x64'); environment(report.toolchain.environment);
  require(Array.isArray(report.commands) && report.commands.length === 2, 'Missing locked restore/build evidence');
  const commands = [
    ['restore', '<temporary>/WinUI/Oracle.WinUI.csproj', '--locked-mode', '--configfile', '<temporary>/NuGet.Config'],
    ['build', '<temporary>/WinUI/Oracle.WinUI.csproj', '--no-restore', '-c', 'Release', '-o', '<temporary>/out'],
  ];
  for (const [index, command] of report.commands.entries()) {
    require(Array.isArray(command.argv) && typeof command.argv[0] === 'string' && command.argv[0].length > 0, 'Missing native build invocation');
    same(command.argv.slice(1).map(slash), commands[index], 'Native restore/build invocation changed');
    successfulProcess(command.result);
  }
  require(Array.isArray(report.binaries) && report.binaries.length > 0, 'Missing native binary provenance');
  const names = new Set();
  for (const binary of report.binaries) {
    require(binary && typeof binary.name === 'string' && /^[^/\\]+\.(dll|exe|json)$/.test(binary.name) && hash.test(binary.sha256 ?? '') && !names.has(binary.name), 'Invalid native binary provenance');
    names.add(binary.name);
  }
  require(names.has('Oracle.WinUI.exe') && names.has('Oracle.WinUI.dll'), 'Missing native measurement executable hashes');
  require(Array.isArray(report.attempts) && report.attempts.length === 3, 'WinUI adoption requires three complete attempts');
  for (const [index, attempt] of report.attempts.entries()) {
    require(attempt?.number === index + 1, 'WinUI attempt sequence changed');
    successfulProcess(attempt.process, true);
    require(Array.isArray(attempt.argv), 'Missing native measurement invocation');
    same(attempt.argv.map(slash), ['<temporary>/out/Oracle.WinUI.exe', '<temporary>/input.json', `<temporary>/result-${index}.json`], 'Native measurement invocation changed');
    require(typeof attempt.output === 'string' && Buffer.byteLength(attempt.output) <= 16 * 1024 * 1024, 'Missing or oversized native measurement output');
    same(JSON.parse(attempt.output), attempt.result, 'Native output and parsed measurements disagree');
    validateWinuiExpectedResult(fixture, attempt.result);
    if (index) same(attempt.result, report.attempts[0].result, 'WinUI measurements differ across attempts');
  }
  return report.attempts[0].result;
}

/** The caller must provide the separately reviewed report digest and source commit. */
export async function prepareWinuiExpected({ capture, reviewedCommit, reviewedSHA256 }) {
  require(hash.test(reviewedSHA256 ?? ''), 'An explicit reviewed report SHA-256 is required');
  const bytes = await readFile(capture);
  require(bytes.length <= 128 * 1024 * 1024, 'WinUI capture exceeds report byte bound');
  require(sha256(bytes) === reviewedSHA256, 'WinUI capture differs from the reviewed report SHA-256');
  const report = JSON.parse(bytes), fixture = await loadWinuiExpectedFixture();
  const result = validateWinuiCapture(report, fixture, reviewedCommit);
  const entry = envelope('winui', fixture, result, report.target);
  await verifyEntry(entry, [fixture]);
  return { entry, receipt: { schemaVersion: 1, status: 'reviewed-capture-not-qualified', reviewedCommit, reviewedSHA256,
    capturedAt: report.capturedAt, target: report.target, toolchain: report.toolchain, binaries: report.binaries,
    fixtureId: fixture.id, inputHash: fixture.inputHash, observations: 20, attempts: 3 } };
}

export async function adoptWinuiExpected(options) {
  const { entry, receipt } = await prepareWinuiExpected(options);
  const file = expectedPath(entry, options.directory ?? expectedRoot);
  // All capture/schema/current-input checks finish before the first filesystem write.
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(entry, null, 2) + '\n', { flag: 'wx' });
  return { ...receipt, action: 'adopted', file };
}
export async function verifyWinuiExpected(options) {
  const { entry, receipt } = await prepareWinuiExpected(options);
  await compareExpected(entry, options.directory ?? expectedRoot);
  return { ...receipt, action: 'verified', file: expectedPath(entry, options.directory ?? expectedRoot) };
}

export async function main(args = process.argv.slice(2)) {
  const [mode, ...pairs] = args, options = {};
  const names = { '--capture': 'capture', '--reviewed-commit': 'reviewedCommit', '--reviewed-sha256': 'reviewedSHA256', '--store': 'directory' };
  require(['adopt', 'verify'].includes(mode) && pairs.length % 2 === 0, 'Usage: winui-expected.js adopt|verify --capture REPORT --reviewed-commit SHA --reviewed-sha256 SHA256 [--store DIRECTORY]');
  for (let index = 0; index < pairs.length; index += 2) {
    const name = Object.hasOwn(names, pairs[index]) ? names[pairs[index]] : null, value = pairs[index + 1];
    require(name && value && !value.startsWith('--') && !Object.hasOwn(options, name), 'Unknown, repeated or incomplete WinUI expected option');
    options[name] = value;
  }
  require(options.capture && options.reviewedCommit && options.reviewedSHA256, 'Capture, reviewed commit and reviewed SHA-256 are required');
  console.log(JSON.stringify(await (mode === 'adopt' ? adoptWinuiExpected : verifyWinuiExpected)(options)));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
