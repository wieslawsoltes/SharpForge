/** Proposal-output checks on real CoreCLR; the CIL VM's aggregate profile is tested separately. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { compileToAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { dotnetHost, sdkVersion, openDotnetScratch } from '../../../packages/compiler/test/differential/tools/dotnet-axis.mjs';
import { unionInputs, unionPreviewOptions } from './contracts.js';

const pack = loadReferencePack();
const dotnet = dotnetHost();
const sdk = pack ? sdkVersion(dotnet) : null;
export const unionReferences = pack?.references ?? [];
export const unionReferenceSkip = !pack && 'a .NET reference pack is required';
export const unionNativeSkip = (!pack || !sdk) && 'a .NET SDK and reference pack are required';

/** Returns the actual output of the emitted assembly; a compiler/runtime failure fails the test. */
export function runUnion(source) {
  const compiled = compileToAssembly(unionInputs(source), { ...unionPreviewOptions, references: unionReferences });
  assert.equal(compiled.success, true, compiled.diagnostics.map(diagnostic => diagnostic.code + ': ' + diagnostic.message).join('\n'));
  const scratch = openDotnetScratch({ dotnet, sdk, pack });
  try {
    const { assemblyPath } = scratch.context('references');
    writeFileSync(assemblyPath, compiled.assembly);
    try {
      return execFileSync(dotnet, [assemblyPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 })
        .replace(/\r\n/g, '\n');
    } catch (error) {
      assert.fail(`CoreCLR exit ${error.status}, signal ${error.signal}: ${error.stderr ?? error.message}`);
    }
  } finally {
    scratch.close();
  }
}
