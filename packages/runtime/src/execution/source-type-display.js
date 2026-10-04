function suffix(type) {
  return type.vector ? '[]' : type.rank === 1 ? '[*]' : '[' + ','.repeat(type.rank - 1) + ']';
}

/** Logical source construction names affect reflection/formatting only, never layout, casting or call ownership. */
export function sourceTypeDisplay(identity) {
  if (identity.element) return sourceTypeDisplay(identity.element) + suffix(identity);
  return identity.name + (identity.arguments.length ? '[' + identity.arguments.map(sourceTypeDisplay).join(',') + ']' : '');
}

export function sourceTypeSimpleName(identity) {
  if (identity.element) return sourceTypeSimpleName(identity.element) + suffix(identity);
  return identity.name.slice(Math.max(identity.name.lastIndexOf('.'), identity.name.lastIndexOf('+')) + 1);
}

function assemblyType(identity) {
  return identity.element ? assemblyType(identity.element) : identity;
}

export function sourceTypeFullName(identity, assemblyIdentity) {
  if (identity.element) return sourceTypeFullName(identity.element, assemblyIdentity) + suffix(identity);
  if (!identity.arguments.length) return identity.name;
  return identity.name + '[[' + identity.arguments.map(argument =>
    sourceTypeFullName(argument, assemblyIdentity) + ', ' + assemblyIdentity(assemblyType(argument))).join('],[') + ']]';
}
