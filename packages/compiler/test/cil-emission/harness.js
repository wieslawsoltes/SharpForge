/**
 * Execution fixtures of the direct CIL pipeline (SF-A02-T30).
 *
 *   fixtures/<name>.cs    a program
 *   fixtures/<name>.out   what it prints when Roslyn builds it and .NET runs it (pinned by verify-dotnet.mjs --update)
 *   fixtures/<name>.vm    present only when the direct-CIL runtime cannot run the emitted assembly: the reason, one
 *                         line per verifier issue (`fault: <message>` for a run-time fault, `output differs` for a
 *                         wrong result). A fixture that does not print the .NET output must fail for exactly that
 *                         reason, so it is never counted as running; once the runtime gains the capability the
 *                         output is compared as usual and `verify-dotnet.mjs --update` removes the file.
 *
 * `checkFixture` verifies an emitted assembly on the two levels that need no .NET SDK: the image is read back and
 * validated by `@sharpforge/cil`, and it runs on the direct-CIL runtime. verify-dotnet.mjs is the third level.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AssemblyInspector, validateMetadata, verifyCilAssembly } from '@sharpforge/cil';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { compileToAssembly } from '@sharpforge/compiler';

export const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const INSTRUCTION_BUDGET = 20_000_000;
const normalize = text => text.replace(/\r\n/g, '\n');
const read = path => (existsSync(path) ? normalize(readFileSync(path, 'utf8')) : null);

/** Every fixture: `{name, source, expected, runtimeLimit}`; `runtimeLimit` is the content of the `.vm` file or null. */
export function loadFixtures() {
  return readdirSync(fixtureDirectory)
    .filter(file => file.endsWith('.cs'))
    .sort()
    .map(file => {
      const name = file.slice(0, -3);
      return {
        name,
        source: normalize(readFileSync(join(fixtureDirectory, file), 'utf8')),
        expected: read(join(fixtureDirectory, name + '.out')),
        runtimeLimit: read(join(fixtureDirectory, name + '.vm')),
      };
    });
}

/** Compiles a fixture; returns `{assembly, errors}` where `errors` are `code message` lines. */
export function emitFixture(fixture, options = {}) {
  const result = compileToAssembly(fixture.source, { name: 'Fixture', ...options });
  return {
    assembly: result.assembly,
    errors: result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`),
  };
}

/**
 * Reads the image back: metadata must validate and every method body must decode.
 * @returns {string[]} what is wrong with the image (empty for a well-formed one)
 */
export function inspectImage(assembly) {
  const inspector = new AssemblyInspector(assembly),
    problems = validateMetadata(inspector.metadata).map(entry => `${entry.code} ${entry.message}`);
  for (const method of inspector.methods.values()) {
    try {
      inspector.getMethod(method.token);
    } catch (error) {
      problems.push(`${method.owner}::${method.name}: ${error.message}`);
    }
  }
  return problems;
}

/**
 * Runs an assembly on the direct-CIL runtime.
 * @returns {{output: string|null, limit: string|null}} the program output, or why the runtime could not run it
 */
export function runOnDirectCil(assembly) {
  const report = verifyCilAssembly(assembly);
  if (!report.success) return { output: null, limit: [...new Set(report.issues.map(issue => issue.message))].sort().join('\n') + '\n' };
  const result = new CilVirtualMachine(assembly, { maxInstructions: INSTRUCTION_BUDGET, virtualTime: true }).run();
  if (result.state !== 'terminated') return { output: result.output, limit: `fault: ${result.fault?.message ?? result.state}\n` };
  return { output: result.output, limit: null };
}
