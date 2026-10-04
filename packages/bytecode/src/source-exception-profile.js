import {
  exceptionIntrinsicDefinitions
} from './exception-intrinsic-profile.js';

/** Source adapters only expose signatures whose constructor semantics the shared runtime implements. */
function sourceSignature(descriptor) {
  if (descriptor.owner === 'System.Exception' &&
    (descriptor.name === 'get_Message' || descriptor.name === '.ctor' &&
      descriptor.parameters.length === 1 && descriptor.parameters[0] === 'string')) return false;
  if (descriptor.name !== '.ctor') return true;
  // The one-string forms on these classes name a parameter/object, rather than supplying a message.
  if (['System.ArgumentNullException', 'System.ArgumentOutOfRangeException', 'System.ObjectDisposedException']
    .includes(descriptor.owner) && descriptor.parameters.length === 1) return false;
  return true;
}

/** Existing Exception(string)/Message keep their released builtin identities; new signatures append. */
export const sourceExceptionDefinitions = Object.freeze(exceptionIntrinsicDefinitions.filter(sourceSignature));
