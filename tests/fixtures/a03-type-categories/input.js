import { AssemblyInspector, MetadataBuilder, createMetadataVerificationTypeSystem } from '@sharpforge/cil';
import { metadataImage } from '../a03-metadata/fixture.js';

/** Synthetic authority contracts deliberately use non-platform names; identity is supplied explicitly. */
export function categoryFixture() {
  const builder = new MetadataBuilder('CategoryContracts');
  const tokens = {};
  function definition(name, base = 0, flags = 1) {
    return tokens[name] = builder.addRow('TypeDef', {
      Flags: flags, Name: name, Namespace: '', Extends: base, FieldList: 1, MethodList: 1,
    });
  }
  definition('<Module>', 0, 0);
  definition('Root');
  definition('ValueRoot', tokens.Root, 0x81);
  definition('EnumRoot', tokens.ValueRoot, 0x81);
  definition('Class', tokens.Root);
  definition('Derived', tokens.Class);
  definition('Struct', tokens.ValueRoot, 0x109);
  definition('Enum', tokens.EnumRoot, 0x101);
  definition('Interface', 0, 0xa1);
  definition('Open', tokens.Root);
  builder.addRow('GenericParam', { Number: 0, Flags: 0, Owner: tokens.Open, Name: 'T' });
  definition('Orphan');
  const inspect = () => new AssemblyInspector(metadataImage(builder));
  return { builder, tokens, definition, inspect };
}

export function coreAuthority(fixture = categoryFixture()) {
  const context = createMetadataVerificationTypeSystem(fixture.inspect());
  const resolveType = token => context.resolveType(token);
  const coreTypes = { context, object: resolveType(fixture.tokens.Root).value,
    valueType: resolveType(fixture.tokens.ValueRoot).value, enum: resolveType(fixture.tokens.EnumRoot).value, resolveType };
  return { ...fixture, coreTypes, context };
}

export function externalFixture(core) {
  const builder = new MetadataBuilder('ExternalCategoryContracts');
  const tokens = {};
  const bindings = new Map();
  const scope = builder.assemblyRef('Declared.Core');
  for (const name of ['Root', 'ValueRoot', 'EnumRoot', 'Class']) {
    tokens[name] = builder.addRow('TypeRef', { ResolutionScope: scope, Name: name, Namespace: '' });
    bindings.set(tokens[name], core.context.resolveType(core.tokens[name]));
  }
  function definition(name, base, flags = 1) {
    return tokens[name] = builder.addRow('TypeDef', {
      Flags: flags, Name: name, Namespace: '', Extends: base, FieldList: 1, MethodList: 1,
    });
  }
  definition('<Module>', 0, 0);
  definition('LocalClass', tokens.Class);
  definition('LocalDerived', tokens.LocalClass);
  definition('LocalValue', tokens.ValueRoot, 0x109);
  definition('LocalEnum', tokens.EnumRoot, 0x101);
  definition('LocalInterface', 0, 0xa1);
  const coreTypes = { ...core.coreTypes, resolveType: token => bindings.get(token) ?? { status: 'unknown', reason: 'unprepared' } };
  return { builder, tokens, bindings, coreTypes, definition, inspect: () => new AssemblyInspector(metadataImage(builder)) };
}
