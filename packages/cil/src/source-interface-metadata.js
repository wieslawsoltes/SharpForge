import {
  codedIndex,
  decodeCoded,
  token
} from './metadata.js';
import {
  CilError
} from './binary.js';

export function emitSourceMethodImpls(context) {
  for (const method of context.image.methods) {
    for (const declaration of method.explicitInterfaceImplementations ?? []) {
      const bodyToken = context.methodTokens.get(method.id),
        declarationToken = context.methodTokens.get(declaration);
      const owner = context.typeTokens.get(method.owner);
      if (!owner || !declarationToken) throw new CilError('Invalid source MethodImpl identity');
      context.metadata.add(25, [owner & 0xffffff, codedIndex('MethodDefOrRef', bodyToken), codedIndex('MethodDefOrRef', declarationToken)]);
    }
  }
}

export function sourceAbstractDebug(descriptor) {
  const method = descriptor.original;
  return {
    id: method.id,
    token: descriptor.token,
    name: method.name,
    qualifiedName: method.qualifiedName,
    ...(method.sourceRange ? {
      sourceRange: method.sourceRange
    } : {}),
    ...(method.accessor ? {
      accessor: method.accessor
    } : {}),
    locals: [],
    spans: []
  };
}

export function sourceAbstractBody(row, info) {
  if (row[0] !== 0 || !(row[2] & 0x40) || row[2] & 0x10 || info.locals.length || info.spans.length)
    throw new CilError('Invalid abstract source method body');
  return {
    code: new Uint8Array(),
    localSignature: 0,
    handlers: []
  };
}

export function loadSourceDispatchFlags(flags) {
  if (!(flags & 0x40)) return {};
  return {
    isVirtual: true,
    isAbstract: !!(flags & 0x400),
    isFinal: !!(flags & 0x20),
    isNewSlot: !!(flags & 0x100),
    access: ({
      1: 'private',
      3: 'internal',
      4: 'protected',
      6: 'public'
    })[flags & 7]
  };
}

export function loadSourceMethodImpls(metadata, methods, types) {
  for (const row of metadata.rows[25] ?? []) {
    const body = methods.get(decodeCoded('MethodDefOrRef', row[1]));
    const declaration = methods.get(decodeCoded('MethodDefOrRef', row[2]));
    if (!body || !declaration || body.owner !== types.get(token(2, row[0]))?.name)
      throw new CilError('Invalid source MethodImpl mapping');
    (body.explicitInterfaceImplementations ??= []).push(declaration.id);
  }
}
