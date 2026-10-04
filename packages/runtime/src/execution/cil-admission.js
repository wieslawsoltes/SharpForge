import { AssemblyInspector, verifyCilAssembly } from '@sharpforge/cil';
import { requireVerifiedCil } from './verification-error.js';

/** Callers supply normalized, runtime-owned options; execution budgets stay separate from static decoding limits. */
export function cilAdmissionOptions(options) {
  if (!Object.hasOwn(options, 'maxInstructions')) return options;
  const { maxInstructions: _executionBudget, ...admission } = options;
  return admission;
}

/** Admit an ordinary PE with the same options for inspection and verification, preserving existing inspector identity. */
export function initializeCilAdmission(vm, bytes, options) {
  const admission = cilAdmissionOptions(options);
  vm.inspector = bytes instanceof AssemblyInspector ? bytes : new AssemblyInspector(bytes, admission);
  vm.report = verifyCilAssembly(vm.inspector, admission);
  requireVerifiedCil(vm.report);
}
