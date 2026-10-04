import {Op} from '@sharpforge/bytecode';
import {codedIndex} from '../metadata.js';
import {assemblyReferenceRegistry} from '../metadata/assembly-references.js';

function keyBytes(value) {
  return Uint8Array.from(value.match(/../g) ?? [], pair => Number.parseInt(pair, 16));
}

/** Allocate explicit project AssemblyRef and TypeRef rows before any signatures are encoded. */
export function prepareProjectReferenceTypes(context) {
  const profile = context.image.externalReferences;
  if (!profile) return;
  const {metadata} = context;
  const assemblies = profile.assemblies.map(({identity}) => {
    const flags = (identity.isRetargetable ? 0x100 : 0) | (identity.contentType === 'windowsRuntime' ? 0x200 : 0);
    const registry = assemblyReferenceRegistry([{name: identity.name, version: identity.version,
      culture: identity.cultureName, flags, publicKeyOrToken: keyBytes(identity.publicKeyToken)}]);
    const reference = registry.values().next().value;
    const [major, minor, build, revision] = reference.version;
    return metadata.manifest.assemblyRef({MajorVersion: major, MinorVersion: minor, BuildNumber: build,
      RevisionNumber: revision, Flags: reference.flags, PublicKeyOrToken: reference.publicKeyOrToken,
      Name: reference.name, Culture: reference.culture, HashValue: new Uint8Array()});
  });
  const references = new Map();
  function typeReference(name, assembly) {
    const key = assembly + ':' + name;
    if (references.has(key)) return references.get(key);
    const nested = name.lastIndexOf('+');
    const split = name.lastIndexOf('.');
    const scope = nested < 0 ? assembly : typeReference(name.slice(0, nested), assembly);
    const namespace = nested < 0 && split >= 0 ? name.slice(0, split) : '';
    const simple = nested < 0 ? name.slice(split + 1) : name.slice(nested + 1);
    const token = metadata.add(1, [codedIndex('ResolutionScope', scope),
      metadata.string(simple), metadata.string(namespace)]);
    references.set(key, token);
    return token;
  }
  const types = profile.types.map(type => {
    const token = typeReference(type.name, assemblies[type.assembly]);
    context.typeTokens.set(type.imageName, token);
    return token;
  });
  context.projectReferences = {assemblies, types, methods: [], fields: []};
}

/** Encode only the declared project member signatures, using the preallocated external type tokens. */
export function prepareProjectReferenceMembers(context) {
  const profile = context.image.externalReferences;
  if (!profile) return;
  const {metadata, signatures, projectReferences} = context;
  projectReferences.methods = profile.methods.map(method => metadata.member(
    projectReferences.types[method.type], method.name,
    signatures.method(method.returnType, method.parameters, method.isStatic),
  ));
  projectReferences.fields = profile.fields.map(field => metadata.member(
    projectReferences.types[field.type], field.name, signatures.field(field.fieldType),
  ));
}

function callInstruction(context, operation, state) {
  const {writer, input, argument, count, adapt} = state;
  const profile = context.image.externalReferences;
  const method = profile.methods[argument];
  const construct = operation === Op.EXTNEWOBJ;
  const parameters = [...(!construct && !method.isStatic ? [profile.types[method.type].imageName] : []),
    ...method.parameters];
  adapt(input.slice(input.length - count), parameters);
  writer.op(construct ? 'newobj' : method.isStatic ? 'call' : 'callvirt', context.projectReferences.methods[argument]);
  if (!construct && method.returnType === 'void') writer.op('ldnull');
}

function fieldInstruction(context, operation, state) {
  const {writer, argument, input, convert, scratch} = state;
  const field = context.image.externalReferences.fields[argument];
  const token = context.projectReferences.fields[argument];
  const store = operation === Op.EXTSTFLD || operation === Op.EXTSTSTATIC;
  if (!store) {
    writer.op(field.isStatic ? 'ldsfld' : 'ldfld', token);
    return;
  }
  convert(input.at(-1), field.fieldType);
  if (field.isStatic) writer.op('dup').op('stsfld', token);
  else {
    const slot = scratch(field.fieldType, 998);
    writer.local('stloc', slot).local('ldloc', slot).op('stfld', token).local('ldloc', slot);
  }
}

const emitters = new Map([
  [Op.EXTCALL, callInstruction], [Op.EXTNEWOBJ, callInstruction],
  [Op.EXTLDFLD, fieldInstruction], [Op.EXTSTFLD, fieldInstruction],
  [Op.EXTLDSTATIC, fieldInstruction], [Op.EXTSTSTATIC, fieldInstruction],
]);

/** Extend the method emitter without changing the existing instruction dispatch contract. */
export function emitProjectInstruction(context, operation, state) {
  const emit = emitters.get(operation);
  if (!emit) return false;
  emit(context, operation, state);
  return true;
}
