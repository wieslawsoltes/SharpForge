#!/usr/bin/env node
/** Capture only genuine pinned-Roslyn outputs; SharpForge compilation is never used to create the oracle. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../../../../scripts/conformance/oracle/toolchain.js';
import {
  compileNative, compilerOptions, projectedNativeReferences, requireNativeSuccess, resolveToolchain, runNative, runtimeConfig,
} from './native.mjs';
import { utf8DataRows } from './metadata.mjs';

const toolchain = await resolveToolchain();
const here = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'sharpforge-utf8-oracle-'));
const normalized = name => readFileSync(join(here, name), 'utf8').replace(/\r\n/g, '\n');
const source = normalized('Utf8Literals.cs');
const provenance = { generator: 'build-fixture.mjs', toolchain: toolchain.actual, environment: toolchain.environment,
  compilerOptions, inputNewlines: 'LF', sourceSha256: sha256(source), consumerSha256: sha256(normalized('InspectUtf8.cs')), modes: {} };
const artifacts = new Map();
try {
  const input = join(scratch, 'Utf8Literals.cs');
  writeFileSync(input, source);
  for (const mode of ['modern', 'fallback']) {
    const directory = join(scratch, mode);
    mkdirSync(directory);
    const projected = mode === 'fallback' ? projectedNativeReferences(toolchain, directory, 'pointer') : null;
    const references = projected?.references ?? toolchain.references;
    const output = join(directory, 'Utf8Literals.dll');
    requireNativeSuccess(await compileNative(toolchain, { source: input, output, references }));
    const consumer = join(directory, 'InspectUtf8.dll');
    requireNativeSuccess(await compileNative(toolchain, {
      source: join(here, 'InspectUtf8.cs'), output: consumer, executable: true, references: [...toolchain.references, output],
    }));
    runtimeConfig(toolchain, join(directory, 'InspectUtf8.runtimeconfig.json'));
    const text = await runNative(toolchain, consumer);
    artifacts.set(mode + '.out', text);
    const assembly = readFileSync(output);
    const projection = projected ? { methodToken: projected.projection.methodToken, offset: projected.projection.offset,
      originalFlags: projected.projection.originalFlags, projectedFlags: projected.projection.projectedFlags,
      originalSha256: sha256(projected.originalBytes), projectedSha256: sha256(projected.projection.bytes) } : null;
    provenance.modes[mode] = { assemblySha256: sha256(assembly), assemblyBytes: assembly.length,
      outputSha256: sha256(text), fieldRvaCount: utf8DataRows(assembly).length, projection };
    if (mode === 'modern') artifacts.set('Utf8Literals.dll', assembly);
  }
  const directory = join(scratch, 'missing');
  mkdirSync(directory);
  const missing = 'using System; public class C { public static ReadOnlySpan<byte> Text() => "x"u8; }';
  const inputMissing = join(directory, 'Missing.cs');
  writeFileSync(inputMissing, missing);
  const projected = projectedNativeReferences(toolchain, directory, 'array');
  const result = await compileNative(toolchain, {
    source: inputMissing, output: join(directory, 'Missing.dll'), references: projected.references,
  });
  if (result.exitCode === 0 || !result.diagnostics.some(([code]) => code === 'CS0656')) throw new Error('Missing required constructor probe did not fail');
  artifacts.set('missing-constructor.json', JSON.stringify(result.diagnostics, null, 2) + '\n');
  requireNativeSuccess(await compileNative(toolchain, { source: inputMissing, output: join(directory, 'Missing.ref.dll'),
    references: projected.references, referenceOnly: true }));
  provenance.modes.missingRequired = { sourceSha256: sha256(missing), diagnostics: result.diagnostics,
    methodToken: projected.projection.methodToken, offset: projected.projection.offset,
    originalFlags: projected.projection.originalFlags, projectedFlags: projected.projection.projectedFlags,
    originalSha256: sha256(projected.originalBytes), projectedSha256: sha256(projected.projection.bytes), referenceOnly: 'succeeded' };
  artifacts.set('provenance.json', JSON.stringify(provenance, null, 2) + '\n');
  // A failed probe must not partially replace the previous checked-in oracle capture.
  for (const [name, data] of artifacts) writeFileSync(join(here, name), data);
  process.stdout.write(JSON.stringify(provenance.modes, null, 2) + '\n');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
