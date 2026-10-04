import { baseContext } from './clr-methods-base-fixtures.js';

/** Explicit test-host identities for calling-convention modifiers; production framework binding is separate. */
export function functionPointerContext() {
  const context = baseContext();
  for (const name of ['CallConvCdecl', 'CallConvSuppressGCTransition']) {
    context.types.defineIntrinsic(`System.Runtime.CompilerServices.${name}`);
  }
  return context;
}
