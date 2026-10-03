import { readFile } from 'node:fs/promises';
import { AssemblyInspector } from '../../../../packages/cil/src/index.js';
import { opcodeFamilies } from '../runtime-il-import.js';
import { compileToIL } from '../../../../packages/compiler/src/index.js';
import { runVM } from '../../diff/engines/vm.js';
import { executeCLR } from '../../diff/engines/clr.js';
import { limits } from '../../diff/fixtures.js';
import { compileNative } from './native.js';
import { sha256, main } from './store.js';
export const diagnosticKey = (rows) =>
  rows.map((row) => `${row.severity}:${row.code}`).sort();
export function compareDiagnostics(actual, expected, ignoredWarnings = []) {
  const filter = (rows) =>
    rows.filter(
      (row) =>
        row.severity !== 'warning' || !ignoredWarnings.includes(row.code),
    );
  return (
    JSON.stringify(diagnosticKey(filter(actual))) ===
    JSON.stringify(diagnosticKey(filter(expected)))
  );
}
function fixture(row) {
  return {
    id: row.id,
    sourceText: row.sourceText,
    stdin: '',
    langVersion: row.langVersion,
    capabilities: [],
    limits: limits({
      timeoutMs: 10000,
      maxInstructions: 2000000,
      maxOutputBytes: 65536,
      maxFrames: 128,
      maxHeapBytes: 16 * 1024 * 1024,
    }),
  };
}
function result(engine, status, detail = {}) {
  return { engine, status, ...detail };
}
export async function executeCase(row, options = {}) {
  if (row.unsupported.length)
    return [result('all', 'unsupported', { reasons: row.unsupported })];
  const native = await compileNative(row, {
    timeoutMs: 10000,
    maxOutputBytes: 1024 * 1024,
    ...options,
  });
  if (native.unsupported)
    return [
      result('all', 'unsupported', {
        reason: native.unsupported,
        diagnostics: native.diagnostics,
      }),
    ];
  const toolchain = native.toolchain.actual;
  if (
    row.kind === 'diagnostics' ||
    (row.kind === 'spec' && row.expected.stdout === undefined)
  ) {
    const expected = row.expected.referenceDiagnostics
      ? native.diagnostics
      : row.expected.diagnostics;
    if (
      !compareDiagnostics(
        native.diagnostics,
        expected,
        row.expected.ignoredWarnings,
      )
    )
      return [
        result('reference', 'unsupported', {
          reason:
            'Pinned reference diagnostics differ from upstream harness expectation; adaptation cannot qualify product',
          expected,
          actual: native.diagnostics,
          toolchain,
        }),
      ];
    const actual = compileToIL(row.sourceText, {
      name: 'Suite',
      langVersion: row.langVersion,
      outputKind: row.target,
      includeDebug: false,
    });
    return [
      result(
        'compiler',
        compareDiagnostics(
          actual.diagnostics,
          expected,
          row.expected.ignoredWarnings,
        )
          ? 'pass'
          : 'fail',
        {
          expected,
          actual: actual.diagnostics,
          reference: native.diagnostics,
          toolchain,
          scope: 'Code/severity multiset, not diagnostic spans or messages',
        },
      ),
    ];
  }
  if (!native.assembly)
    return [
      result('all', 'unsupported', {
        reason:
          'Native preflight rejects isolated upstream body: missing helper/API/fixture dependency',
        diagnostics: native.diagnostics,
        toolchain,
      }),
    ];
  const input = fixture(row),
    observations = [];
  const reference = await executeCLR(
    native.assembly,
    input,
    native.toolchain,
    options,
  );
  if (/NotSupportedException: Shim Equal/.test(reference.stderr))
    return [
      result('all', 'unsupported', {
        reason: 'Sequence-equality overload is outside scalar xunit shim',
        reference,
      }),
    ];
  const referencePass =
    reference.exitCode === row.expected.exitCode &&
    (!('stdout' in row.expected) ||
      reference.stdout.replaceAll('\r\n', '\n') === row.expected.stdout);
  let families = [],
    opcodeInspectionError;
  try {
    const inspector = new AssemblyInspector(native.assembly);
    families = opcodeFamilies(
      [...inspector.methods.values()]
        .filter((method) => method.hasBody)
        .flatMap((method) =>
          inspector
            .getMethod(method.token)
            .instructions.map((instruction) => instruction.name + ' '),
        )
        .join('\n'),
    );
  } catch (error) {
    opcodeInspectionError = error.message;
  }
  observations.push(
    result('clr', referencePass ? 'pass' : 'fail', {
      ...reference,
      toolchain,
      opcodeFamilies: families,
      opcodeInspectionError,
    }),
  );
  if (!referencePass) return observations;
  const engines = row.language === 'il' ? ['cil-vm'] : ['cil-vm', 'source-vm'];
  for (const engine of engines) {
    const actual = await runVM(engine, input, {
      ...options,
      ...(engine === 'cil-vm'
        ? { compiled: { success: true, assembly: native.assembly } }
        : {}),
    });
    observations.push(
      result(
        engine,
        actual.status === 'completed' &&
          actual.exitCode === row.expected.exitCode &&
          actual.stdout.replaceAll('\r\n', '\n') ===
            reference.stdout.replaceAll('\r\n', '\n')
          ? 'pass'
          : 'fail',
        {
          observation: actual,
          assemblyOrigin:
            engine === 'cil-vm'
              ? 'same pinned-Roslyn/ILAsm DLL as CLR'
              : 'SharpForge source compiler',
        },
      ),
    );
  }
  return observations;
}
if (main(import.meta.url)) {
  try {
    const bytes = await readFile(process.argv[2]);
    if (sha256(bytes) !== process.argv[3])
      throw Error('Child fixture digest mismatch');
    console.log(JSON.stringify(await executeCase(JSON.parse(bytes))));
  } catch (error) {
    console.log(
      JSON.stringify([result('host', 'fail', { error: error.stack })]),
    );
  }
}
