/** Small library/consumer Roslyn invocations using the repository's pinned, bounded native-process utility. */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { resolveToolchain } from '../../../../scripts/conformance/oracle/toolchain.js';
import { runProcess } from '../../../../scripts/conformance/oracle/process.js';
import { referenceWithoutSpanConstructor } from './metadata.mjs';

export { resolveToolchain };
export const compilerOptions = Object.freeze([
  '-nologo', '-noconfig', '-nostdlib', '-deterministic+', '-debug-', '-optimize+', '-langversion:11', '-nullable:disable',
]);

export async function compileNative(toolchain, { source, output, references = toolchain.references, referenceOnly = false, executable = false }) {
  const result = await runProcess(toolchain.dotnet, [toolchain.csc, ...compilerOptions,
    '-target:' + (executable ? 'exe' : 'library'), ...(referenceOnly ? ['-refonly'] : []), '-out:' + output,
    ...references.map(path => '-reference:' + path), source], { timeoutMs: 30_000, maxOutputBytes: 64 * 1024 });
  return { ...result, diagnostics: [...result.stdout.matchAll(/(?:error|warning) (CS\d+): ([^\r\n]+)/g)].map(match => [match[1], match[2]]) };
}

export function requireNativeSuccess(result) {
  if (result.exitCode !== 0) throw new Error(result.stdout + result.stderr);
}

export function runtimeConfig(toolchain, output) {
  const runtime = toolchain.actual.runtime;
  writeFileSync(output, JSON.stringify({ runtimeOptions: {
    tfm: 'net' + runtime.split('.').slice(0, 2).join('.'), framework: { name: 'Microsoft.NETCore.App', version: runtime },
  } }));
}

export async function runNative(toolchain, assembly) {
  const result = await runProcess(toolchain.dotnet, [assembly], { timeoutMs: 30_000, maxOutputBytes: 64 * 1024 });
  requireNativeSuccess(result);
  return result.stdout.replace(/\r\n/g, '\n');
}

/** Writes a temporary projected System.Runtime reference; the installed pack remains byte-for-byte intact. */
export function projectedNativeReferences(toolchain, directory, kind) {
  const original = toolchain.references.find(path => basename(path) === 'System.Runtime.dll');
  if (!original) throw new Error('No System.Runtime reference in selected toolchain');
  const originalBytes = readFileSync(original);
  const projection = referenceWithoutSpanConstructor(originalBytes, kind);
  const projected = join(directory, 'System.Runtime.dll');
  writeFileSync(projected, projection.bytes);
  return { references: toolchain.references.map(path => path === original ? projected : path), originalBytes, projection };
}
