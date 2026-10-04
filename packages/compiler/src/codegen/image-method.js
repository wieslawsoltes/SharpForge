/** Preserve virtual slot identity in the execution image without retaining source symbols. */
export function imageVirtualFlags(method) {
  const modifiers = method.node?.modifiers ?? [];
  const isOverride = method.isOverride ?? modifiers.includes('override');
  const isVirtual = method.isVirtual ?? (isOverride || modifiers.includes('virtual') || modifiers.includes('abstract'));
  if (!isVirtual) return {};
  return {isVirtual: true, ...(!isOverride ? {isNewSlot: true} : {}),
    ...(method.isFinal || modifiers.includes('sealed') ? {isFinal: true} : {})};
}

/** Serialize either compilation pipeline's method record into the shared source image. */
export function imageMethod(method) {
  const node = method.node;
  const hasSource = method.hasSource ?? (node?.body && (!node.asyncRole || node.asyncRole === 'body') &&
    !method.name.startsWith('<startup>'));
  const asyncRole = method.asyncRole ?? node?.asyncRole;
  return {
    ...(hasSource && node?.uri ? {sourceRange: {uri: node.uri, start: node.start, end: node.end}} : {}),
    ...(asyncRole ? {asyncRole, asyncOrigin: method.asyncOrigin ?? node?.asyncOrigin} : {}),
    id: method.id,
    name: method.name,
    qualifiedName: method.qualifiedName,
    owner: method.owner?.name ?? null,
    isStatic: method.isStatic,
    returnType: method.returnType,
    ...imageVirtualFlags(method),
    ...(method.accessor ? {accessor: method.accessor} : {}),
    ...(method.implementsDispose ? {implementsDispose: true} : {}),
    parameters: method.parameters.map(parameter => ({name: parameter.name, type: parameter.type})),
    locals: method.locals ?? [],
    code: method.code ?? new Int32Array(),
    handlers: method.handlers ?? []
  };
}
