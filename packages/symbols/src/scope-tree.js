import { fail } from './contracts.js';
import { hasLocalAnnotations, copyLocalAnnotations } from './local-annotations.js';

function snapshot(scope) {
  return {
    id: scope.id,
    start: scope.start,
    end: scope.end,
    importScope: scope.importScope,
    locals: scope.variables.map((local) => {
      const { id, index, name, attributes, hidden } = local;
      return {
        id,
        index,
        name,
        attributes,
        compilerGenerated: hidden,
        type: null,
        typeName: null,
        typeReason: 'type-metadata-required',
        ...(hasLocalAnnotations(local) ? copyLocalAnnotations(local) : null),
      };
    }),
    constantIds: scope.constants.map(({ id }) => id),
    ...(scope.constants.some(hasLocalAnnotations)
      ? {
          constantAnnotations: scope.constants
            .filter(hasLocalAnnotations)
            .map((value) => ({ id: value.id, name: value.name, ...copyLocalAnnotations(value) })),
        }
      : null),
    children: [],
  };
}

/** Build a bounded lexical tree once; queries own all returned records and arrays. */
export function createScopeTree(scopes, methodCount) {
  let entries = scopes.length,
    characters = 0;
  if (entries > 100000) fail('Scope tree entry limit exceeded');
  for (const scope of scopes) {
    entries += scope.variables.length + scope.constants.length;
    if (entries > 100000) fail('Scope tree entry limit exceeded');
    for (const local of scope.variables) characters += local.name.length;
    if (characters > 1024 * 1024) fail('Scope tree name limit exceeded');
  }
  const methods = new Map();
  let stack = [],
    previous;
  for (const scope of scopes) {
    if (
      previous &&
      (scope.methodToken < previous.methodToken ||
        (scope.methodToken === previous.methodToken &&
          (scope.start < previous.start || (scope.start === previous.start && scope.end > previous.end))))
    )
      fail('Unsorted local scopes');
    if (!previous || previous.methodToken !== scope.methodToken) stack = [];
    while (stack.length && scope.start >= stack.at(-1).end) stack.pop();
    if (stack.length && scope.end > stack.at(-1).end) fail('Partially overlapping local scopes');
    if (stack.length >= 256) fail('Scope tree depth limit exceeded');
    const node = snapshot(scope);
    if (!methods.has(scope.methodToken)) methods.set(scope.methodToken, []);
    (stack.length ? stack.at(-1).children : methods.get(scope.methodToken)).push(node);
    stack.push(node);
    previous = scope;
  }
  return (methodToken) => {
    if (!Number.isInteger(methodToken) || methodToken < 0x06000001 || methodToken > 0x06000000 + methodCount)
      fail('Invalid scope tree method token');
    return structuredClone(methods.get(methodToken) ?? []);
  };
}
