import {AssemblyInspector, verifyCilAssembly} from '@sharpforge/cil';
import {requireVerifiedCil} from './verification-error.js';

/** Preserve legacy verifier limits while separating runtime quotas and flattening explicit assembly limits. */
export function cilVerificationOptions(options) {
  const {maxInstructions: executionBudget, maxBytes: heapBudget, assemblyLimits, ...verificationOptions} = options;
  return {...verificationOptions, ...assemblyLimits};
}

/** Heap/execution budgets are independent of the explicit assembly decoding and verification limits. */
export function admitCilAssembly(vm, bytes, options) {
  const inspectionOptions = cilVerificationOptions(options);
  vm.inspector = bytes instanceof AssemblyInspector ? bytes : new AssemblyInspector(bytes, inspectionOptions);
  vm.report = verifyCilAssembly(vm.inspector, inspectionOptions);
  requireVerifiedCil(vm.report);
}
