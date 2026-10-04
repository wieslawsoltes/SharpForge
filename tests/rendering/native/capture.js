import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { root, pin, platform, requireTarget, resolveToolchain } from '../../../scripts/conformance/oracle/toolchain.js';
import { runProcess } from '../../../scripts/conformance/oracle/process.js';
import { boundedRead, directory, loadInput } from './input.js';
import { bgraToRgba, hash, referenceMetadata } from './contract.js';
import { buildCapture, captureAttempts } from './capture-project.js';

const compress = promisify(gzip);

async function exportReferences({ input, dump, output, provenance, signal, report }) {
  for (let index = 0; index < input.fixtures.length; index++) {
    signal?.throwIfAborted();
    const fixture = input.fixtures[index], observation = dump.observations[index];
    if (observation.status !== 'pixels') continue;
    const attempt = path.join(output, 'attempt-1');
    const bytes = await boundedRead(path.join(attempt, observation.file), attempt, observation.byteCount);
    const rgba = bgraToRgba(bytes, observation.dimensions);
    const metadata = referenceMetadata({ fixture, observation, dump, input, provenance, pin, pixelSha256: hash(rgba) });
    await writeFile(path.join(output, fixture.id + '.rgba.gz'), await compress(rgba), { flag: 'wx' });
    await writeFile(path.join(output, fixture.id + '.json'), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
    report.references.push({ id: fixture.id, pixelSha256: metadata.pixelSha256, bgraSha256: metadata.bgraSha256, dimensions: metadata.dimensions });
  }
}

/** Produce independent WinUI references in a new directory, retaining raw observations and failure logs. */
export async function captureNative({ output, provenance, sourceRoot = directory, target = platform,
  resolve = resolveToolchain, execute = runProcess, signal, temporaryRoot = os.tmpdir(),
  windowsBuild = Number(os.release().split('.')[2]) } = {}) {
  signal?.throwIfAborted();
  if (typeof output !== 'string' || !output) throw new Error('SFNPIX023: A new native output directory is required');
  const input = await loadInput(sourceRoot);
  output = path.resolve(output);
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output);
  output = await realpath(output);
  const report = { schemaVersion: 1, status: 'running', target, inputHash: input.inputHash, materials: input.materials,
    pinnedToolchain: pin, source: provenance ?? null, declaredFixtures: input.fixtures.length, toolchain: null,
    commands: [], binaries: [], attempts: [], references: [], unsupported: [], failures: [] };
  let temporary;
  try {
    const support = requireTarget('winui', target);
    if (!support.supported) {
      report.status = 'unsupported';
      report.unsupported.push(support);
      return report;
    }
    if (!Number.isInteger(windowsBuild) || windowsBuild < pin.images.windows.minimumBuild) {
      throw new Error('SFNPIX023: Native capture requires the pinned minimum Windows build');
    }
    signal?.throwIfAborted();
    const toolchain = await resolve();
    signal?.throwIfAborted();
    report.toolchain = { actual: toolchain.actual, environment: toolchain.environment };
    temporary = await mkdtemp(path.join(temporaryRoot, 'sharpforge-native-pixels-'));
    const built = await buildCapture({ input, temporary, toolchain, execute, signal, report });
    const dump = await captureAttempts({ built, input, output, execute, signal, report });
    await exportReferences({ input, dump, output, provenance, signal, report });
    report.status = 'captured-native-reference';
  } catch (error) {
    report.status = signal?.aborted ? 'cancelled' : 'failed';
    report.failures.push(error.message);
    if (error.result) report.nativeFailure = error.result;
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  return report;
}

export async function main(args = process.argv.slice(2), { signal } = {}) {
  if (args.length !== 2 || args[0] !== '--output' || !args[1]) throw new Error('Usage: native/capture.js --output NEW_DIRECTORY');
  const revision = await runProcess('git', ['rev-parse', 'HEAD'], { cwd: root, signal });
  const status = await runProcess('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, signal });
  if (revision.exitCode !== 0 || !/^[a-f0-9]{40}$/.test(revision.stdout.trim()) || status.exitCode !== 0) {
    throw new Error('SFNPIX024: Cannot bind native capture to the source revision');
  }
  const provenance = { sourceRevision: revision.stdout.trim(), sourceDirty: status.stdout.length !== 0,
    captureCommand: [process.execPath, fileURLToPath(import.meta.url), ...args], capturedAt: new Date().toISOString() };
  const report = await captureNative({ output: args[1], provenance, signal });
  console.log(JSON.stringify({ status: report.status, fixtures: report.declaredFixtures, references: report.references.length,
    failures: report.failures, output: path.resolve(args[1]) }));
  if (report.status !== 'captured-native-reference') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('Native capture cancelled'));
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try { await main(undefined, { signal: controller.signal }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}
