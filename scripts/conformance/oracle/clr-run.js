import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pin } from './toolchain.js';
import { runProcess } from './process.js';
import { assertDeterministic } from './roslyn-compile.js';

export function executionResult(result) {
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    signal: result.signal,
    unhandledException: result.stderr.match(/^Unhandled exception\. ([A-Za-z_][A-Za-z0-9_.+`]*)(?::|\r?$)/m)?.[1] ?? null,
  };
}

export async function executeAssembly(assembly, toolchain, options) {
  if (!Buffer.isBuffer(assembly) || assembly.length === 0) throw new Error('CoreCLR requires a successfully emitted assembly');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-coreclr-'));
  try {
    await writeFile(path.join(directory, 'Oracle.dll'), assembly);
    await writeFile(path.join(directory, 'Oracle.runtimeconfig.json'), JSON.stringify({ runtimeOptions: { tfm: pin.targetFramework, rollForward: 'Disable', framework: { name: 'Microsoft.NETCore.App', version: pin.runtime } } }));
    const result = await runProcess(toolchain.dotnet, [path.join(directory, 'Oracle.dll')], { cwd: directory, ...options });
    return { result: executionResult(result), elapsedMs: result.elapsedMs, command: [toolchain.dotnet, '<temporary>/Oracle.dll'] };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function runFixture(assembly, fixture, toolchain, options) {
  const first = await executeAssembly(assembly, toolchain, options);
  const second = await executeAssembly(assembly, toolchain, options);
  assertDeterministic(first.result, second.result, `CoreCLR fixture ${fixture.id}`);
  return { ...first, timings: [first.elapsedMs, second.elapsedMs] };
}
