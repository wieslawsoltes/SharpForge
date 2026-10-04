import { fail } from './contracts.js';

function occurrenceTree(node) {
  if (node.kind === 'genericInstance')
    return { ...node, type: occurrenceTree(node.type), arguments: node.arguments.map(occurrenceTree) };
  if (node.kind === 'functionPointer')
    return {
      ...node,
      signature: {
        ...node.signature,
        returnType: occurrenceTree(node.signature.returnType),
        parameters: node.signature.parameters.map(occurrenceTree),
      },
    };
  return node.element ? { ...node, element: occurrenceTree(node.element) } : { ...node };
}

/** Project source annotations without changing the declared signature tree. */
export function annotationDisplay(type, annotations, context) {
  const dynamic = new WeakSet(),
    tuples = new WeakMap();
  const flags = annotations.dynamicFlags ?? [];
  const names = annotations.tupleElementNames;
  let flagIndex = 0,
    nameIndex = names?.length ?? 0,
    reason = null,
    nodes = 0;
  const reject = (value) => {
    reason ??= value;
  };
  function children(node) {
    if (node.kind === 'genericInstance') return node.arguments;
    if (node.kind === 'functionPointer') return [node.signature.returnType, ...node.signature.parameters];
    return node.element ? [node.element] : [];
  }
  function elements(node) {
    if (node.kind !== 'genericInstance' || node.type.kind !== 'valuetype') return null;
    const name = context.frameworkName(node.type.token);
    if (!name?.startsWith('ValueTuple`')) return null;
    const arity = Number(name.slice(11));
    if (node.arguments.length !== arity) return null;
    if (arity < 8) return node.arguments;
    const rest = elements(node.arguments[7]);
    return rest ? [...node.arguments.slice(0, 7), ...rest] : null;
  }
  function visit(node, depth) {
    if (++nodes > 256 || depth > 32) fail('Local annotation type complexity limit exceeded');
    const transparent = ['modreq', 'modopt', 'pinned'].includes(node.kind);
    if (!transparent) {
      const flag = flags[flagIndex++] ?? false;
      const object =
        (node.kind === 'primitive' && node.name === 'object') ||
        (node.kind === 'class' && context.frameworkName(node.token) === 'Object');
      if (flag) {
        if (object) dynamic.add(node);
        else reject('dynamic-type-mismatch');
      }
    }
    for (const child of children(node)) visit(child, depth + 1);
  }
  function tupleVisit(node) {
    const nested = children(node);
    for (let index = nested.length - 1; index >= 0; index--) tupleVisit(nested[index]);
    const items = elements(node);
    if (!items) return;
    if (items.length > nameIndex) {
      reject('tuple-name-count-mismatch');
      return;
    }
    nameIndex -= items.length;
    tuples.set(node, { items, names: names.slice(nameIndex, nameIndex + items.length) });
  }
  // Primitive decoder nodes may be shared between different signature occurrences.
  // Preflight before making a bounded occurrence tree, so one dynamic bit cannot rename every object slot.
  function preflight(node, depth) {
    if (++nodes > 256 || depth > 32) fail('Local annotation type complexity limit exceeded');
    for (const child of children(node)) preflight(child, depth + 1);
  }
  preflight(type, 0);
  type = occurrenceTree(type);
  nodes = 0;
  visit(type, 0);
  if (flags.slice(flagIndex).some(Boolean)) reject('dynamic-type-mismatch');
  if (names) {
    tupleVisit(type);
    if (nameIndex) reject('tuple-type-mismatch');
  }
  if (reason) return { displayTypeName: null, annotationReason: reason };
  const formatType = (node, formatChild) => {
    if (dynamic.has(node)) return 'dynamic';
    const tuple = tuples.get(node);
    if (tuple && tuple.items.length > 1) {
      return (
        '(' +
        tuple.items
          .map((item, index) => formatChild(item) + (tuple.names[index] ? ' ' + tuple.names[index] : ''))
          .join(', ') +
        ')'
      );
    }
    return undefined;
  };
  return { displayTypeName: context.format(type, formatType), annotationReason: null };
}
