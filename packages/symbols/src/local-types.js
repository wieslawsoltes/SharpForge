import { fail } from './contracts.js';
import { createMetadataTypeNames } from './metadata-type-names.js';
import { annotationContext, hasLocalAnnotations } from './local-annotations.js';
import { annotationDisplay } from './annotation-display.js';
import { readLocalSignatures, localSlotLimits } from './local-signatures.js';
import { createLocalSlotLookup } from './unnamed-slots.js';

function snapshotTypes(pe, symbols, options) {
  const limits = localSlotLimits(options);
  const { signatures, methods } = readLocalSignatures(pe, symbols, limits);
  const displays = createMetadataTypeNames(pe.metadata, 'Local');
  const needed = new Map();
  for (const scope of symbols.scopes) {
    if (!scope.variables.length) continue;
    let slots = needed.get(scope.methodToken);
    if (!slots) needed.set(scope.methodToken, (slots = new Set()));
    for (const local of scope.variables) slots.add(local.index);
  }
  const facts = new Map();
  for (const [method, slots] of needed) {
    const { token } = methods.get(method);
    const locals = new Map();
    for (const slot of slots) {
      const type = signatures.get(token)?.[slot];
      if (token && !type) fail('Local variable slot is outside its signature');
      locals.set(
        slot,
        type
          ? { type, typeName: displays.format(type), typeReason: null }
          : { type: null, typeName: null, typeReason: 'missing-local-signature' },
      );
    }
    facts.set(method, locals);
  }
  let annotations, context;
  for (const scope of symbols.scopes)
    for (const local of scope.variables) {
      if (!hasLocalAnnotations(local)) continue;
      const type = facts.get(scope.methodToken)?.get(local.index)?.type;
      if (type)
        (annotations ??= new Map()).set(
          local.id,
          annotationDisplay(type, local, (context ??= annotationContext(pe.metadata, displays))),
        );
    }
  let constants;
  for (const value of symbols.constants ?? []) {
    if (hasLocalAnnotations(value))
      (constants ??= new Map()).set(value.id, {
        displayTypeName: value.displayTypeName,
        annotationReason: value.annotationReason,
      });
  }
  const localSlots = createLocalSlotLookup(methods, signatures, symbols.scopes, displays, limits);
  return { facts, annotations, constants, localSlots };
}

/** Snapshot declared local types while metadata is available; query results never borrow ASTs or PE bytes. */
export function bindLocalTypes(lookup, pe, symbols, options) {
  const { facts, annotations, constants, localSlots } = snapshotTypes(pe, symbols, options);
  const scopeTree = (methodToken) => {
    const roots = lookup(methodToken),
      pending = [...roots];
    const locals = structuredClone(facts.get(methodToken));
    while (pending.length) {
      const scope = pending.pop();
      for (const local of scope.locals) Object.assign(local, locals?.get(local.index), annotations?.get(local.id));
      for (const constant of scope.constantAnnotations ?? []) Object.assign(constant, constants?.get(constant.id));
      for (const child of scope.children) pending.push(child);
    }
    return roots;
  };
  return { scopeTree, localSlots };
}
