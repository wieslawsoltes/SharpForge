import {frameworkType} from '@sharpforge/framework';
import {verifyCilAssembly, mergeVerifiedStackReports} from '@sharpforge/cil';
import {ManagedFault, isReference} from '../heap.js';
import {loweredDelegateInfo} from './delegate-identity.js';
import {boundDelegateCall} from '../execution/delegate-targets.js';

/** Resolve the compiler's explicit delegate representation and genuine CLI delegates at one call seam. */
export function managedDelegateTarget(vm, delegate, args) {
  if (!isReference(delegate)) throw new ManagedFault('ArgumentException', 'A managed delegate is required');
  const platform = vm.platform, record = vm.heap.get(delegate);
  let method, values;
  if (record.kind === 'delegate') {
    const signature = frameworkType(record.type);
    if (signature && signature.parameters.length !== args.length) throw new ManagedFault('ArgumentException', 'Delegate argument count mismatch');
    method = platform.get(delegate, 'method');
    if (method < 0 && platform.ui.bindingServices.events.entries.has(-method)) return {native: true};
    const target = vm.inspector ? vm.inspector.getMethod(method) : vm.image.methods[method];
    if (!target) throw new ManagedFault('MissingMethodException', 'Delegate target is unavailable');
    if (vm.inspector) values = boundDelegateCall(vm, delegate, args).arguments;
    else values = target.isStatic ? args : [platform.get(delegate, 'receiver'), ...args];
  } else if (record.kind === 'object') {
    const info = loweredDelegateInfo(platform.ui, delegate), invoke = info?.invoke;
    if (!invoke || invoke.parameters.length !== args.length + 1) {
      throw new ManagedFault('ArgumentException', 'The object is not a matching compiler-generated delegate');
    }
    method = invoke.id;
    values = [delegate, ...args];
  } else throw new ManagedFault('ArgumentException', 'A managed delegate is required');
  if (vm.inspector && !vm.report.methods.includes(method)) {
    const report = verifyCilAssembly(vm.inspector, {methodToken: method});
    if (!report.success) throw new ManagedFault('InvalidProgramException', report.issues.map(issue => issue.message).join('; '));
    vm.report = mergeVerifiedStackReports(vm.inspector, vm.report, report);
  }
  const definition = vm.inspector ? vm.inspector.getMethod(method) : vm.image.methods[method];
  return {method, values, name: definition.asyncOrigin ?? definition.name};
}
