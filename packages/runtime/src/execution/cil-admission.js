import {AssemblyInspector, verifyCilAssembly} from '@sharpforge/cil';
import {requireVerifiedCil} from './verification-error.js';

/** Reuse normalized options when unchanged; explicit assembly limits override legacy verifier limits. */
export function cilAdmissionOptions(options) {
  if (!Object.hasOwn(options, 'maxInstructions') && !Object.hasOwn(options, 'maxBytes') &&
      !Object.hasOwn(options, 'assemblyLimits')) return options;
  const {maxInstructions: executionBudget, maxBytes: heapBudget, assemblyLimits, ...admission} = options;
  return assemblyLimits == null ? admission : {...admission, ...assemblyLimits};
}

/** Heap/execution budgets are independent of the explicit assembly decoding and verification limits. */
export function initializeCilAdmission(vm, bytes, options) {
  const inspectionOptions = cilAdmissionOptions(options);
  vm.inspector = bytes instanceof AssemblyInspector ? bytes : new AssemblyInspector(bytes, inspectionOptions);
  vm.report = verifyCilAssembly(vm.inspector, inspectionOptions);
  requireVerifiedCil(vm.report);
}
