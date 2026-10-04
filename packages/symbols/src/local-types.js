import { decodeSignature } from '@sharpforge/cil';
import { fail } from './contracts.js';
import { createMetadataTypeNames } from './metadata-type-names.js';
import { annotationContext, hasLocalAnnotations } from './local-annotations.js';
import { annotationDisplay } from './annotation-display.js';

function localSignatures(pe, symbols) {
  const needed = new Map();
  for (const scope of symbols.scopes) {
    if (!scope.variables.length) continue;
    let slots = needed.get(scope.methodToken);
    if (!slots) needed.set(scope.methodToken, (slots = new Set()));
    for (const local of scope.variables) slots.add(local.index);
  }
  const signatures = new Map(),
    methods = new Map();
  let total = 0;
  for (const [method, slots] of needed) {
    const signature = symbols.methods[(method & 0xffffff) - 1]?.localSignature ?? 0;
    if (
      !Number.isInteger(signature) ||
      signature < 0 ||
      signature > 0xffffff ||
      signature > (pe.metadata.counts[17] ?? 0)
    )
      fail('Invalid local signature row id');
    let token = signature ? 0x11000000 | signature : 0;
    if (!token && pe.metadata.row(method)[0]) token = pe.methodBody(method).localSignature;
    methods.set(method, { token, slots });
    if (!token || signatures.has(token)) continue;
    if (token >>> 24 !== 17 || !(token & 0xffffff)) fail('Invalid local signature token');
    const bytes = pe.metadata.blob(pe.metadata.row(token)[0]);
    if (bytes.length > 4096 || (total += bytes.length) > 128 * 1024) fail('Local signature byte limit exceeded');
    signatures.set(token, bytes);
  }
  return { signatures, methods };
}

function snapshotTypes(pe, symbols) {
  const { signatures, methods } = localSignatures(pe, symbols);
  const displays = createMetadataTypeNames(pe.metadata, 'Local');
  for (const [token, bytes] of signatures) {
    const signature = decodeSignature(bytes, { maxDepth: 32, maxNodes: 4096 });
    if (signature.kind !== 'locals') fail('Expected local variable signature');
    signatures.set(token, signature.types);
  }
  const facts = new Map();
  for (const [method, { token, slots }] of methods) {
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
  const annotations = new Map();
  let context;
  for (const scope of symbols.scopes)
    for (const local of scope.variables) {
      if (!hasLocalAnnotations(local)) continue;
      const type = facts.get(scope.methodToken)?.get(local.index)?.type;
      if (type)
        annotations.set(
          local.id,
          annotationDisplay(type, local, (context ??= annotationContext(pe.metadata, displays))),
        );
    }
  const constants = new Map(
    symbols.constants
      ?.filter(hasLocalAnnotations)
      .map((value) => [value.id, { displayTypeName: value.displayTypeName, annotationReason: value.annotationReason }]),
  );
  return { facts, annotations, constants };
}

/** Snapshot declared local types while metadata is available; query results never borrow ASTs or PE bytes. */
export function bindLocalTypes(lookup, pe, symbols) {
  const { facts, annotations, constants } = snapshotTypes(pe, symbols);
  return (methodToken) => {
    const roots = lookup(methodToken),
      pending = [...roots];
    const locals = structuredClone(facts.get(methodToken));
    while (pending.length) {
      const scope = pending.pop();
      for (const local of scope.locals) Object.assign(local, locals?.get(local.index), annotations.get(local.id));
      for (const constant of scope.constantAnnotations ?? []) Object.assign(constant, constants.get(constant.id));
      for (const child of scope.children) pending.push(child);
    }
    return roots;
  };
}
