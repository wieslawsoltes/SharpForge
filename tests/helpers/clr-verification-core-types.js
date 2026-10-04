import { MetadataBuilder, AssemblyInspector, createMetadataVerificationTypeSystem, codedIndex } from '@sharpforge/cil';
import { AssemblyLoadSession } from '../../packages/clr/src/index.js';
import { metadataImage } from '../fixtures/a03-metadata/fixture.js';

function definition(builder, name, base = 0, flags = 1) {
  return builder.addRow('TypeDef', { Flags: flags, Name: name, Namespace: name === '<Module>' ? '' : 'Authority',
    Extends: base, FieldList: 1, MethodList: 1 });
}

export function coreBindingImage(name = 'BindingCore') {
  const builder = new MetadataBuilder(name, { assemblyVersion: [1, 0, 0, 0] });
  definition(builder, '<Module>', 0, 0);
  const object = definition(builder, 'Root');
  const valueType = definition(builder, 'ValueRoot', object, 0x81);
  const enumeration = definition(builder, 'EnumRoot', valueType, 0x81);
  const ordinary = definition(builder, 'Ordinary', object);
  const value = definition(builder, 'Value', valueType, 0x101);
  const open = definition(builder, 'Open', object);
  builder.addRow('GenericParam', { Number: 0, Flags: 0, Owner: open, Name: 'T' });
  const tokens = { object, valueType, enum: enumeration, ordinary, value, open };
  return { bytes: metadataImage(builder), tokens };
}

export function inputBindingImage(name = 'BindingInput', { cyclic = false } = {}) {
  const builder = new MetadataBuilder(name, { assemblyVersion: [1, 0, 0, 0],
    assemblyReferences: ['BindingCore', 'OtherCore', 'MissingCore'].map(name => ({ name, version: [1, 0, 0, 0] })) });
  const tokens = {};
  definition(builder, '<Module>', 0, 0);
  for (const [role, name, flags] of [['object', 'Root', 1], ['valueType', 'ValueRoot', 0x101], ['enum', 'EnumRoot', 0x101]]) {
    tokens[role] = builder.typeRef(`Authority.${name}`, 'BindingCore');
    tokens[`${role}Child`] = definition(builder, `${name}Child`, tokens[role], flags);
  }
  tokens.other = builder.typeRef('Authority.Root', 'OtherCore');
  tokens.open = builder.typeRef('Authority.Open', 'BindingCore');
  tokens.missing = builder.typeRef('Authority.Root', 'MissingCore');
  if (cyclic) builder.rows[1][(tokens.object & 0xffffff) - 1][0] = codedIndex('ResolutionScope', tokens.object);
  return { bytes: metadataImage(builder), tokens };
}

export async function coreBindingFixture(options = {}) {
  const core = coreBindingImage();
  const input = inputBindingImage();
  const context = new AssemblyLoadSession().createContext(options);
  const coreModule = (await context.loadFromStream(core.bytes)).manifestModule;
  const module = (await context.loadFromStream(input.bytes)).manifestModule;
  const other = coreBindingImage('OtherCore');
  const otherModule = (await context.loadFromStream(other.bytes)).manifestModule;
  const inspector = new AssemblyInspector(core.bytes);
  const types = createMetadataVerificationTypeSystem(inspector);
  const roots = Object.fromEntries(['object', 'valueType', 'enum'].map(role => [role, types.resolveType(core.tokens[role]).value]));
  const bindingOptions = { coreModule, context: types, ...roots,
    tokens: [input.tokens.object, input.tokens.valueType, input.tokens.enum] };
  return { context, module, coreModule, otherModule, core, input, types, inspector, bindingOptions };
}
