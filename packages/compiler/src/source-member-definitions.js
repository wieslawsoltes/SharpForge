import { CilError } from '@sharpforge/cil';
import { Accessibility } from './symbols/types.js';
import { accessibilityFromSyntax } from './symbols/members.js';
import { sourceTypeDefinitions } from './source-type-definitions.js';
import { backingFieldName } from './lowering/generated-names.js';

const maximumMembers = 200000;
const rangeKey = node => JSON.stringify([node?.uri, node?.start, node?.end]);
const fullName = type => (type.namespace ? type.namespace + '.' : '') + type.name;
const memberKey = (name, isStatic) => JSON.stringify([name, isStatic]);
const methodKey = (name, isStatic, count) => JSON.stringify([name, isStatic, count]);

function addCandidate(index, key, value) {
  index.set(key, index.has(key) ? null : value);
}

function fieldDefinition(node) {
  return { access: accessibilityFromSyntax(node.modifiers), isReadOnly: node.modifiers.includes('readonly') };
}

function propertyDefinitions(node, owner) {
  const access = accessibilityFromSyntax(node.modifiers);
  const isStatic = node.modifiers.includes('static');
  for (const accessor of node.accessors) {
    owner.accessors.set(memberKey(accessor.name + '_' + node.name, isStatic),
      accessibilityFromSyntax(accessor.modifiers, access));
  }
  if (node.accessors.length && node.accessors.every(accessor => !accessor.body)) {
    owner.fields.set(memberKey(backingFieldName(node.name), isStatic), {
      access: Accessibility.Private, isReadOnly: !node.accessors.some(accessor => accessor.name === 'set' || accessor.name === 'init'),
    });
  }
}

function sourceMembers(parsedFiles) {
  const types = new Map();
  const ranges = new Map();
  let count = 0;
  for (const file of parsedFiles) {
    for (const declaration of file.root.members) {
      if (declaration.kind !== 'Class') continue;
      const name = fullName(declaration);
      const owner = types.get(name) ?? { fields: new Map(), methods: new Map(), accessors: new Map(),
        hasInstanceConstructor: false, implicitConstructorAccess: Accessibility.Public };
      if (declaration.modifiers.includes('abstract')) owner.implicitConstructorAccess = Accessibility.Protected;
      types.set(name, owner);
      for (const member of declaration.members) {
        if (++count > maximumMembers) throw new CilError('Source member declaration limit exceeded');
        const isStatic = member.modifiers.includes('static');
        if (member.kind === 'Field') owner.fields.set(memberKey(member.name, isStatic), fieldDefinition(member));
        if (member.kind === 'Property') propertyDefinitions(member, owner);
        if (member.kind !== 'Method') continue;
        if (member.name === '.ctor' && !isStatic) owner.hasInstanceConstructor = true;
        const definition = { name: member.name, access: accessibilityFromSyntax(member.modifiers) };
        addCandidate(ranges, rangeKey(member) + ':' + member.name, definition);
        addCandidate(owner.methods, methodKey(member.name, isStatic, member.parameters.length), definition);
      }
    }
  }
  return { types, ranges };
}

function sourceMethodName(method) {
  if (method.name === '<cctor>') return '.ctor';
  return method.name;
}

function methodDefinition(method, owner, ranges) {
  const accessor = owner?.accessors.get(memberKey(method.name, method.isStatic));
  if (accessor) return accessor;
  // Semantic initialization materializes an implicit constructor body when field initializers need one.
  if (method.name === '.ctor' && !method.isStatic && !method.parameters.length && owner && !owner.hasInstanceConstructor) {
    return owner.implicitConstructorAccess;
  }
  const name = sourceMethodName(method);
  const definition = method.sourceRange ? ranges.get(rangeKey(method.sourceRange) + ':' + name) : undefined;
  if (definition) return definition.access;
  // Async kickoff methods intentionally have no source range; the public entry keeps its declaration's access.
  if (method.asyncRole === 'kickoff') {
    const declaration = owner?.methods.get(methodKey(name, method.isStatic, method.parameters.length));
    if (declaration) return declaration.access;
  }
  return Accessibility.Internal;
}

function validateImage(image) {
  if (!Array.isArray(image?.methods) || !Array.isArray(image?.statics)
    || image.methods.length + image.statics.length > maximumMembers) {
    throw new CilError('Invalid image members or source member definition limit exceeded');
  }
  let count = image.methods.length + image.statics.length;
  for (const type of image.types) {
    if (!Array.isArray(type.fields)) throw new CilError('Source member metadata requires image field tables');
    count += type.fields.length;
    if (count > maximumMembers) throw new CilError('Source member definition limit exceeded');
  }
}

/**
 * Produce version-1 method/instance-field/static-field metadata for every original image slot in O(source + image).
 * Parsed compilation units are reused; source spans disambiguate overloads. Generated helpers remain internal and
 * generated storage private. Input is limited to 20000 files, 100000 types and 200000 members; malformed input
 * throws CilError. This non-executable emission contract preserves declared access and readonly field flags.
 */
export function sourceMemberDefinitions(parsedFiles, image) {
  const typeDefinitions = sourceTypeDefinitions(parsedFiles, image);
  validateImage(image);
  const source = sourceMembers(parsedFiles);
  const owners = new Map(image.types.map(type => [type.name, source.types.get(fullName(typeDefinitions[type.name]))]));
  const defaultField = { access: Accessibility.Private, isReadOnly: false };
  const statics = new Map();
  for (const type of image.types) {
    const owner = owners.get(type.name);
    for (const [key, definition] of owner?.fields ?? []) {
      const [name, isStatic] = JSON.parse(key);
      if (isStatic) statics.set(type.name + '.' + name, definition);
    }
  }
  return {
    version: 1,
    methods: image.methods.map(method => ({ id: method.id,
      access: methodDefinition(method, owners.get(method.owner), source.ranges) })),
    fields: image.types.flatMap(type => type.fields.map(field => ({ type: type.id, index: field.index,
      ...(owners.get(type.name)?.fields.get(memberKey(field.name, false)) ?? defaultField) }))),
    statics: image.statics.map((field, index) => ({ index, ...(statics.get(field.name) ?? defaultField) })),
  };
}
