import {CilError} from '../binary.js';
import {AssemblyInspector} from '../inspector.js';
import {selectMethod} from '../entry-selection.js';

/** Additional MethodDef roots share the ordinary traversal, metadata limits and authentic stack proofs. */
export function additionalVerificationRoots(tokens, maxMethods) {
  if (tokens === undefined) return [];
  if (!Array.isArray(tokens) || !Number.isSafeInteger(maxMethods) || maxMethods < 1 || tokens.length > maxMethods) {
    throw new CilError('Additional verification roots exceed the method limit');
  }
  for (const value of tokens) {
    if (!Number.isSafeInteger(value) || value < 0x06000001 || value > 0x06ffffff) {
      throw new CilError('Additional verification roots require MethodDef tokens');
    }
  }
  return tokens;
}

/** Prepare an ordinary entry and bounded extra roots without altering the reachable verifier traversal. */
export function verificationInput(input, configuration) {
  const {methodToken, arguments: args = [], maxMethods = 10000, additionalMethodTokens, ...options} = configuration;
  const inspector = input instanceof AssemblyInspector ? input : new AssemblyInspector(input, options);
  const pending = [...additionalVerificationRoots(additionalMethodTokens, maxMethods)];
  return {inspector, pending, entry: selectMethod(inspector, methodToken, args), maxMethods, options};
}
