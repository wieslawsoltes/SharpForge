import {CilError} from '../binary.js';
import {resolveExecutionMethod} from '../call-profile.js';
import {verifyGenericCall} from '../generic-profile.js';
import {verifyControlCall} from '../control-execution-profile.js';
import {asyncCallbackTargets} from '../async-state-machines.js';
import {supportedDelegateCall} from '../delegate-profile.js';
import {frameworkInterfaceDefinition} from '../framework-interface-profile.js';
import {intrinsicDefinition} from '../intrinsic-profile.js';

/** Verify one direct call and retain structured unsupported-convention diagnostics at the public admission boundary. */
export function verifyExecutionCall(inspector, method, instruction, context, {pending, dispatch, issue}) {
  try {
    const descriptor = resolveExecutionMethod(inspector, instruction.operand, context);
    verifyGenericCall(inspector, descriptor, context);
    verifyControlCall(inspector, descriptor);
    for (const target of asyncCallbackTargets(inspector, descriptor)) pending.push(target);
    if (descriptor.kind !== 'method') throw new CilError('Call operand is not a method');
    const target = descriptor.resolvedToken ?? (descriptor.token >>> 24 === 6 ? descriptor.token : null);
    if (supportedDelegateCall(inspector, descriptor)) {
      // Delegate runtime methods have no IL body.
    } else if (target) {
      if (instruction.name === 'callvirt' && (inspector.methods.get(target)?.flags & 0x40)) {
        const targets = dispatch.targets(target);
        if (!targets.size) issue(method, instruction, 'IL_DISPATCH', 'Virtual method has no executable implementation');
        for (const implementation of targets) pending.push(implementation);
      } else pending.push(target);
    } else if (frameworkInterfaceDefinition(descriptor)) {
      const targets = dispatch.externalTargets(descriptor);
      for (const implementation of targets) pending.push(implementation);
      if (!targets.size && !intrinsicDefinition(descriptor)) {
        issue(method, instruction, 'IL_REFERENCE',
          `External interface '${descriptor.owner}::${descriptor.name}' has no executable implementation`);
      }
    } else if (!intrinsicDefinition(descriptor)) {
      issue(method, instruction, 'IL_REFERENCE', `External member '${descriptor.owner}::${descriptor.name}' is not implemented`);
    }
    if (instruction.name === 'newobj' && (descriptor.name !== '.ctor' || descriptor.signature.isStatic)) {
      issue(method, instruction, 'IL_CTOR', 'newobj requires an instance constructor');
    }
  } catch (error) {
    const details = {};
    for (const key of ['exceptionType', 'callingConvention', 'member']) {
      if (error[key] !== undefined) details[key] = error[key];
    }
    issue(method, instruction, error.code ?? 'IL_TOKEN', error.message, details);
  }
}
