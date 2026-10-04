import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { oracleRoot, pin } from '../../../scripts/conformance/oracle/toolchain.js';
import { runtimeFiles, boundedRead } from './input.js';
import { hash, limits, validateDump } from './contract.js';

/** Copy the existing locked native project; no package reference or tracked output is changed. */
export async function buildCapture({ input, temporary, toolchain, execute, signal, report }) {
  const projectRoot = path.join(temporary, 'WinUI');
  await mkdir(projectRoot);
  for (const name of runtimeFiles) await cp(path.join(oracleRoot, 'WinUI', name), path.join(projectRoot, name));
  for (const name of ['global.json', 'NuGet.Config']) await cp(path.join(oracleRoot, name), path.join(temporary, name));
  for (const [name, bytes] of Object.entries(input.sources)) await writeFile(path.join(projectRoot, name), bytes);
  const inputPath = path.join(temporary, 'input.json');
  await writeFile(inputPath, JSON.stringify({ schemaVersion: 1, runtime: pin.runtime, inputHash: input.inputHash, fixtures: input.fixtures }));
  const project = path.join(projectRoot, 'Oracle.WinUI.csproj');
  const out = path.join(temporary, 'out');
  for (const args of [['restore', project, '--locked-mode', '--configfile', path.join(temporary, 'NuGet.Config')],
    ['build', project, '--no-restore', '-c', 'Release', '-o', out]]) {
    signal?.throwIfAborted();
    const command = { argv: [toolchain.dotnet, ...args], result: null };
    report.commands.push(command);
    command.result = await execute(toolchain.dotnet, args, { cwd: temporary, signal, timeoutMs: 600000 });
    if (command.result.exitCode !== 0 || command.result.signal) throw new Error('SFNPIX020: Native ' + args[0] + ' failed');
  }
  const binaries = (await readdir(out)).filter(name => /\.(dll|exe|json)$/.test(name)).sort();
  if (!binaries.includes('Oracle.WinUI.exe') || binaries.length > 256) throw new Error('SFNPIX020: Missing executable or binary inventory overflow');
  for (const name of binaries) report.binaries.push({ name, sha256: await fileHash(path.join(out, name), signal) });
  return { out, inputPath, executable: path.join(out, 'Oracle.WinUI.exe') };
}

async function fileHash(file, signal) {
  if ((await stat(file)).size > 128 * 1024 * 1024) throw new Error('SFNPIX020: Native binary byte budget exceeded');
  const digest = createHash('sha256');
  const stream = createReadStream(file, { signal });
  for await (const chunk of stream) digest.update(chunk);
  return digest.digest('hex');
}

/** Run two fresh serial processes and require exact native observation and captured-byte agreement. */
export async function captureAttempts({ built, input, output, execute, signal, report }) {
  let first;
  for (let index = 0; index < 2; index++) {
    signal?.throwIfAborted();
    const directory = path.join(output, 'attempt-' + (index + 1));
    await mkdir(directory);
    const attempt = { number: index + 1, argv: [built.executable, built.inputPath, directory], process: null, result: null };
    report.attempts.push(attempt);
    attempt.process = await execute(built.executable, [built.inputPath, directory], {
      cwd: built.out, signal, timeoutMs: 240000, env: { DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '0' },
    });
    if (attempt.process.exitCode !== 0 || attempt.process.signal || attempt.process.stderr) {
      throw new Error('SFNPIX021: Native capture failed; an interactive Windows desktop is required');
    }
    const bytes = await boundedRead(path.join(directory, 'native.json'), directory, limits.reportBytes);
    attempt.result = validateDump(JSON.parse(bytes), input, pin);
    for (const observation of attempt.result.observations) {
      if (observation.status !== 'pixels') continue;
      const pixels = await boundedRead(path.join(directory, observation.file), directory, observation.byteCount);
      if (pixels.length !== observation.byteCount || hash(pixels) !== observation.bgraSha256) {
        throw new Error('SFNPIX021: Native pixel buffer does not match its recorded hash');
      }
    }
    first ??= attempt.result;
    if (JSON.stringify(first) !== JSON.stringify(attempt.result)) throw new Error('SFNPIX022: Native captures differ between fresh processes');
  }
  return first;
}
