import {formatSignatureType, parseSignatureType} from '../metadata.js';
import {requireProjectReference} from './project-reference-errors.js';

/** Give metadata type tokens their exact module identity without parsing assembly display-name punctuation. */
export function projectMetadataView(module, modules) {
  const metadata = module.inspector.metadata;
  const names = new Map(module.inspector.types.map(type => [type.token, '[' + module.key + ']' + type.name]));
  const profile = module.image.externalReferences;
  const tokens = module.inspector.debug?.referenceTokens;
  profile?.types.forEach((type, index) => names.set(tokens.types[index], externalTypeName(profile, type, modules)));
  const adapted = Object.create(metadata);
  adapted.typeName = function (token, depth = 0) {
    return names.get(token) ?? metadata.typeName.call(this, token, depth);
  };
  return adapted;
}

/** Remap existing image signature types through the same structured signature codecs used by CIL emission. */
export function projectTypeMapper(module, modules) {
  const names = new Map();
  for (const type of module.inspector.debug.types) {
    names.set(module.image.types[type.id].name, '[' + module.key + ']' + module.inspector.metadata.typeName(type.token));
  }
  const profile = module.image.externalReferences;
  for (const type of profile?.types ?? []) names.set(type.imageName, externalTypeName(profile, type, modules));
  const namedTypes = new Map();
  const tokenNames = new Map();
  let next = 1;
  const resolve = name => {
    const token = 0x01000000 + next++;
    tokenNames.set(token, names.get(name) ?? name);
    return token;
  };
  for (const name of names.keys()) namedTypes.set(name, {kind: 'class', token: resolve(name)});
  const cache = new Map();
  return value => {
    requireProjectReference(typeof value === 'string', 'PRJ0001', 'image signature type name');
    if (cache.has(value)) return cache.get(value);
    const mapped = names.get(value) ?? formatSignatureType(
      parseSignatureType(value, resolve, {namedTypes}), {typeName: token => tokenNames.get(token)},
    );
    cache.set(value, mapped);
    return mapped;
  };
}

function externalTypeName(profile, type, modules) {
  const key = profile.assemblies[type.assembly].key;
  const target = modules.get(key.toLowerCase());
  requireProjectReference(target, 'PRJ0002', key);
  return '[' + target.key + ']' + type.name;
}
