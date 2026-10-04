import { fail } from './contracts.js';
import { snapshotClosureFacts, unavailableClosure } from './closure-facts.js';

function lookupFromFacts(snapshot, bound) {
  let index;
  const hasMaps = snapshot.hasMaps;
  return (methodToken) => {
    if (!Number.isInteger(methodToken) || methodToken < 0x06000001 || methodToken > 0x06ffffff) {
      fail('Invalid closure method query');
    }
    if (!bound) return unavailableClosure(methodToken, 'unbound-symbols');
    if (!hasMaps) return unavailableClosure(methodToken, 'missing-lambda-map');
    if (!index) {
      const methods = new Map();
      for (const fact of snapshot.facts) {
        if (methods.has(fact.methodToken)) fail('Ambiguous closure method mapping');
        methods.set(fact.methodToken, fact);
      }
      index = methods;
      snapshot = null;
    }
    const fact = index.get(methodToken);
    if (!fact) return unavailableClosure(methodToken, 'unsupported-or-unmapped-lambda');
    return { ...fact, captures: fact.captures.map((field) => ({ ...field })) };
  };
}

/** Bind generation-zero C# display-class lambdas to EnC identities and directly captured fields. */
export function createClosureLookup(pe, symbols, { maxClosureEntries = 100_000 } = {}) {
  if (!Number.isInteger(maxClosureEntries) || maxClosureEntries < 0 || maxClosureEntries > 1_000_000) {
    fail('Invalid closure entry limit');
  }
  const snapshot = symbols.bound
    ? snapshotClosureFacts(pe.metadata, symbols.custom, maxClosureEntries)
    : { facts: [], hasMaps: false };
  return lookupFromFacts(snapshot, symbols.bound);
}
