import {Op, projectAssemblyKey, verifyProjectReferences} from '@sharpforge/bytecode';
import {decodeCoded, readSignature} from '../metadata.js';
import {requireProjectReference} from './project-reference-errors.js';

const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');

function referenceTokens(tokens, records, table, metadata, label) {
  requireProjectReference(Array.isArray(tokens) && tokens.length === records.length,
    'PRJ0001', label + ' token count');
  const seen = new Set();
  for (const token of tokens) {
    requireProjectReference(Number.isSafeInteger(token) && token >>> 24 === table && !seen.has(token),
      'PRJ0001', label + ' token identity');
    metadata.row(token);
    seen.add(token);
  }
  return tokens;
}

function assemblyScopes(metadata, profile, tokens) {
  return tokens.assemblies.map((token, index) => {
    const row = metadata.row(token);
    const identity = {name: metadata.string(row[6]), version: row.slice(0, 4), cultureName: metadata.string(row[7]),
      publicKeyToken: hex(metadata.blob(row[5])), isRetargetable: !!(row[4] & 0x100),
      contentType: row[4] & 0x200 ? 'windowsRuntime' : 'default'};
    requireProjectReference(!(row[4] & ~0x300) && projectAssemblyKey(identity) === profile.assemblies[index].key,
      'PRJ0001', 'AssemblyRef identity differs from its descriptor');
    return token;
  });
}

function rootScope(metadata, token) {
  const seen = new Set();
  while (token >>> 24 === 1) {
    requireProjectReference(!seen.has(token) && seen.size < 64, 'PRJ0001', 'recursive project TypeRef scope');
    seen.add(token);
    token = decodeCoded('ResolutionScope', metadata.row(token)[0]);
  }
  return token;
}

function memberMaps(metadata, profile, tokens) {
  const methods = new Map();
  const fields = new Map();
  for (const [kind, mapping] of [['methods', methods], ['fields', fields]]) {
    tokens[kind].forEach((token, index) => {
      const descriptor = profile[kind][index];
      const row = metadata.row(token);
      const signature = readSignature(metadata.blob(row[2]), metadata);
      const method = kind === 'methods';
      const valid = method ? signature.kind === 'method' && signature.isStatic === descriptor.isStatic
        && signature.returnType === descriptor.returnType
        && JSON.stringify(signature.parameters) === JSON.stringify(descriptor.parameters)
        : signature.kind === 'field' && signature.type === descriptor.fieldType;
      requireProjectReference(valid && decodeCoded('MemberRefParent', row[0]) === tokens.types[descriptor.type]
        && metadata.string(row[1]) === descriptor.name, 'PRJ0001', 'MemberRef differs from its descriptor');
      mapping.set(token, index);
    });
  }
  return {methods, fields};
}

/** Reconstruct external identities from actual metadata rows; no executable operation comes from the profile. */
export function readProjectReferenceProfile(metadata, debug) {
  const profile = debug.externalReferences;
  if (profile === undefined) {
    requireProjectReference(debug.referenceTokens === undefined, 'PRJ0001', 'tokens without external descriptors');
    return {metadata, profile: undefined, methods: new Map(), fields: new Map()};
  }
  const errors = verifyProjectReferences(profile);
  requireProjectReference(!errors.length, 'PRJ0001', errors.join('; '));
  const rawTokens = debug.referenceTokens;
  requireProjectReference(rawTokens && typeof rawTokens === 'object', 'PRJ0001', 'missing reference token map');
  const tokens = {};
  for (const [name, table] of [['assemblies', 35], ['types', 1], ['methods', 10], ['fields', 10]]) {
    tokens[name] = referenceTokens(rawTokens[name], profile[name], table, metadata, name);
  }
  const scopes = assemblyScopes(metadata, profile, tokens);
  const names = new Map();
  tokens.types.forEach((token, index) => {
    const descriptor = profile.types[index];
    requireProjectReference(rootScope(metadata, token) === scopes[descriptor.assembly]
      && metadata.typeName(token) === descriptor.name, 'PRJ0001', 'TypeRef differs from its descriptor');
    names.set(token, descriptor.imageName);
  });
  const adapted = Object.create(metadata);
  adapted.typeName = function (token, depth = 0) {
    return names.get(token) ?? metadata.typeName.call(this, token, depth);
  };
  return {metadata: adapted, profile, ...memberMaps(adapted, profile, tokens)};
}

/** Decode project operations only when the CIL operand is a validated project MemberRef. */
export function decodeProjectReferenceSpan(span, references) {
  if (!references.profile) return null;
  for (const instruction of span) {
    if (['call', 'callvirt', 'newobj'].includes(instruction.name) && references.methods.has(instruction.operand)) {
      const index = references.methods.get(instruction.operand);
      const method = references.profile.methods[index];
      const construct = instruction.name === 'newobj';
      requireProjectReference(!construct || method.name === '.ctor' && !method.isStatic,
        'PRJ0001', 'newobj must reference an instance constructor');
      return [construct ? Op.EXTNEWOBJ : Op.EXTCALL, index,
        method.parameters.length + (construct || method.isStatic ? 0 : 1)];
    }
    const operation = {ldfld: Op.EXTLDFLD, stfld: Op.EXTSTFLD, ldsfld: Op.EXTLDSTATIC, stsfld: Op.EXTSTSTATIC}[instruction.name];
    if (operation === undefined || !references.fields.has(instruction.operand)) continue;
    const index = references.fields.get(instruction.operand);
    const field = references.profile.fields[index];
    requireProjectReference(field.isStatic === ['ldsfld', 'stsfld'].includes(instruction.name),
      'PRJ0001', 'field storage kind differs from its descriptor');
    return [operation, index, 0];
  }
  return null;
}
