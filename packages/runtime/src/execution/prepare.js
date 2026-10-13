import {VirtualMachine} from '../vm.js';
import {CilVirtualMachine} from '../cil-vm.js';
import {getDecodePlan} from './decode-plan.js';
import {executionCodeStatistics} from './code-version.js';
import {prepareSourceExecution} from './source-fusion.js';

const sourceReason = 'Source fusion preparation is disabled by the sourceFusion:false option';

/** Phase availability describes actual work, never a zero-duration substitute for an absent phase. */
export const executionPreparationCapabilities = Object.freeze({
  source: Object.freeze({status: 'available'}),
  cil: Object.freeze({status: 'available'}),
});

/** Prepare verified interpreter plans without advancing guest instructions, tasks, or optional Wasm compilation. */
export function prepareExecution(vm) {
  if (!(vm instanceof VirtualMachine) && !(vm instanceof CilVirtualMachine)) {
    throw new TypeError('Preparation requires a SharpForge VM');
  }
  if (!['ready', 'running', 'paused', 'waiting'].includes(vm.state)) {
    throw new TypeError('Preparation requires a live verified VM');
  }
  if (vm instanceof VirtualMachine) {
    if (!Array.isArray(vm.image?.methods)) throw new TypeError('Missing verified source image');
    const preparation = prepareSourceExecution(vm);
    return Object.freeze({...preparation, engine: 'source',
      ...(preparation.status === 'disabled' ? {reason: sourceReason} : {}), statistics: executionCodeStatistics(vm)});
  }
  if (vm.report?.success !== true || !Array.isArray(vm.report.methods)) {
    throw new TypeError('Missing successful CIL verification');
  }
  for (const token of vm.report.methods) getDecodePlan(vm, vm.inspector.getMethod(token));
  return Object.freeze({status: 'prepared', engine: 'cil', methods: vm.report.methods.length,
    statistics: executionCodeStatistics(vm)});
}
