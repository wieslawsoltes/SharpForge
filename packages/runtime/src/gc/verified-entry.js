import {verifyCilAssembly} from '@sharpforge/cil';
import {ManagedFault} from './fault.js';

/** Runtime-selected callbacks add only a successfully verified, bounded CIL graph. */
export function verifyManagedEntry(vm, methodToken) {
  if (!vm.inspector || vm.report.methods.includes(methodToken)) return;
  const maximum = vm.options.maxMethods ?? 10000;
  const report = verifyCilAssembly(vm.inspector, {methodToken, maxMethods: maximum});
  if (!report.success) {
    const details = report.issues.map(issue => issue.message).join('; ');
    throw new ManagedFault('InvalidProgramException', 'Managed callback failed IL verification: ' + details);
  }
  const methods = new Set(vm.report.methods);
  for (const token of report.methods) methods.add(token);
  if (methods.size > maximum) {
    throw new ManagedFault('ExecutionLimitException', 'Verified managed callback method limit exceeded');
  }
  // Code is immutable for this inspector. Successful graph expansion is derived
  // verification metadata and can be reused by subsequent callback invocations.
  vm.report.methods = [...methods];
  Object.assign(vm.report.stackHeights, report.stackHeights);
}
