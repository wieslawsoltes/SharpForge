/**
 * The direct-CIL axis of the differential harness (SF-A02-T30): the program is compiled with `compileToAssembly` -
 * metadata from symbols and method bodies from bound trees, without the bytecode image - and the assembly runs on the
 * direct-CIL runtime. The axis passes when the output and the termination kind equal the pinned Roslyn result.
 *
 * It is independent of the image axes: a program the execution profile refuses (SF2200 from `compile`, which makes
 * the fixture `unsupported` there) can pass here, because this pipeline emits what the image cannot express.
 */
import { compileToAssembly } from '@sharpforge/compiler';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { runToEnd, compareRun, brief } from './run-program.js';

const INSTRUCTION_BUDGET = 20_000_000;

/**
 * Runs one output fixture on the direct-CIL axis.
 * @param fixture `{source, langVersion?, allowUnsafe?}`  @param pinned the pinned Roslyn result (`output`, `exception`)
 * @param {object} compileOptions the options the image axes compile with
 * @param {{compileToAssembly?: Function}} [options] a replacement compiler, for tests of the harness
 * @returns {{ok: boolean, detail: string}} `detail` says why the axis failed
 */
export function runDirectCilAxis(fixture, pinned, compileOptions, options = {}) {
  let result;
  try {
    result = (options.compileToAssembly ?? compileToAssembly)(fixture.source, compileOptions);
  } catch (error) {
    return { ok: false, detail: 'compiler crash: ' + brief(error) };
  }
  if (!result.success || !result.assembly) {
    const errors = result.diagnostics.filter(entry => entry.severity === 'error');
    return { ok: false, detail: 'not emitted: ' + errors.map(entry => `${entry.code} ${entry.message}`).join('; ').slice(0, 200) };
  }
  return compareRun(() => runToEnd(new CilVirtualMachine(result.assembly, { maxInstructions: INSTRUCTION_BUDGET, virtualTime: true })), pinned);
}
