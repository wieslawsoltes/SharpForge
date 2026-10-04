import {VirtualMachine} from '../vm.js';
import {CilVirtualMachine} from '../cil-vm.js';
import {getDecodePlan} from './decode-plan.js';
import {getSourceFusionPlan} from './source-fusion.js';
import {executionCodeStatistics} from './code-version.js';

/** Prepare derived interpreter plans without executing IL, starting tasks, or compiling the optional Wasm tier. */
export function prepareExecution(vm) {
  if (!['ready', 'running', 'paused'].includes(vm?.state)) throw new TypeError('Preparation requires a live verified VM');
  let count = 0;
  if (vm instanceof CilVirtualMachine) {
    if (vm.report?.success !== true || !Array.isArray(vm.report.methods)) throw new TypeError('Missing successful CIL verification');
    for (const token of vm.report.methods) {
      getDecodePlan(vm, vm.inspector.getMethod(token));
      count++;
    }
  } else if (vm instanceof VirtualMachine) {
    if (vm.options.sourceFusion === false) return {status: 'unsupported', reason: 'Source fusion preparation is disabled'};
    for (const method of vm.image.methods) {
      getSourceFusionPlan(vm, method);
      count++;
    }
  } else throw new TypeError('Preparation requires a SharpForge VM');
  return {status: 'prepared', engine: vm instanceof CilVirtualMachine ? 'cil' : 'source', methods: count,
    statistics: executionCodeStatistics(vm)};
}
