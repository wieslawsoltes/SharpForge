import {AssemblyInspector, verifyCilAssembly} from '@sharpforge/cil';
import {requireVerifiedCil} from './verification-error.js';

/** Runtime instruction quotas count executed steps, independently of bounded method decoding and EH admission. */
export function admitCilAssembly(vm, bytes, options) {
  const {maxInstructions: executionBudget, ...inspectionOptions} = options;
  vm.inspector = bytes instanceof AssemblyInspector ? bytes : new AssemblyInspector(bytes, inspectionOptions);
  vm.report = verifyCilAssembly(vm.inspector, inspectionOptions);
  requireVerifiedCil(vm.report);
}
