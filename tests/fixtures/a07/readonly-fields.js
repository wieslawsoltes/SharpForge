import {createRegistry, types} from '@sharpforge/framework';
import {codedIndex, fieldSignature} from '@sharpforge/cil';
import {managedFixture} from '../../managed-fixtures.js';

export const fieldOwner = 'System.Diagnostics.ReadonlyFieldProfile';
// CoreLib identity recorded by the Stopwatch .NET 10.0.5 native fixture, assembly version 10.0.0.0.
export const fieldAssemblyIdentities = Object.freeze({
  runtime: Object.freeze({name: 'System.Runtime', version: [8, 0, 0, 0], token: 'b03f5f7f11d50a3a', culture: ''}),
  core: Object.freeze({name: 'System.Private.CoreLib', version: [10, 0, 0, 0], token: '7cec85d7bea7798e', culture: ''})
});

export function readonlyFields({addressable = false} = {}) {
  const scalar = (type, value) => ({type, isStatic: true, readOnly: true, addressable,
    assemblies: ['System.Runtime', 'System.Private.CoreLib'], value});
  return {
    Frequency: scalar('long', {scalar: 'long', value: '1000000000'}),
    IsHighResolution: scalar('bool', true),
    Maximum: scalar('long', {scalar: 'long', value: '9223372036854775807'})
  };
}

export function readonlyRegistry(options) {
  const registry = createRegistry({reservations: [{name: 'fixture', start: 100, size: 4}]});
  registry.define(fieldOwner, {kind: 'bcl', family: 'readonly-field-fixture', fields: readonlyFields(options)});
  return registry;
}

/** Each test restores the public registry entry; production registration remains closed and transactional. */
export function installReadonlyProfile(context, options) {
  const registry = readonlyRegistry(options);
  const previous = types.get(fieldOwner);
  types.set(fieldOwner, registry.frameworkType(fieldOwner));
  context.after(() => previous ? types.set(fieldOwner, previous) : types.delete(fieldOwner));
  return registry;
}

export function fieldReference(context, options = {}) {
  const {owner = fieldOwner, name = 'Frequency', type = 'long', identity = fieldAssemblyIdentities.runtime} = options;
  const metadata = context.md;
  const bytes = Uint8Array.from(identity.token.match(/../g) ?? [], pair => parseInt(pair, 16));
  const assembly = metadata.add(35, [...identity.version, 0, metadata.blob(bytes),
    metadata.string(identity.name), metadata.string(identity.culture), 0]);
  const dot = owner.lastIndexOf('.');
  const ownerToken = metadata.add(1, [codedIndex('ResolutionScope', assembly),
    metadata.string(options.metadataName ?? owner.slice(dot + 1)), metadata.string(options.metadataNamespace ?? owner.slice(0, dot))]);
  return metadata.member(ownerToken, name, options.signatureBytes ?? fieldSignature(type, context.resolve));
}

export function fieldAssembly(options = {}) {
  const {opcode = 'ldsfld', type = 'long', discardValue = false} = options;
  const readsValue = opcode === 'ldsfld' || opcode === 'ldfld';
  return managedFixture({methods: [{name: 'Main', result: readsValue && !discardValue ? type : 'void', body(writer, context) {
    const field = fieldReference(context, options);
    if (['ldfld', 'stfld', 'ldflda'].includes(opcode)) writer.op('ldnull');
    if (opcode === 'stfld' || opcode === 'stsfld') writer.op(type === 'long' ? 'ldc.i8' : 'ldc.i4', type === 'long' ? 0n : 0);
    writer.op(opcode, field);
    if (opcode.endsWith('flda') || readsValue && discardValue) writer.op('pop');
    writer.op('ret');
  }}]});
}
