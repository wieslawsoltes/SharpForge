/** Attributes on compiler-owned definitions; every constructor names an existing symbol or a local MethodDef. */
import { encodeCustomAttribute } from '@sharpforge/cil';
import { methodSymbolSignature } from './member-signatures.js';
import { requiredAttributeConstructor } from './compiler-attribute-symbols.js';
import { MetadataEmitError } from './type-tokens.js';

const GENERATED = 'System.Runtime.CompilerServices.CompilerGeneratedAttribute';

/** Writing never creates a new attribute definition after TypeDef tokens have been allocated. */
export function compilerAttributeConstructorToken(attributes, contract, constructor = contract?.constructor) {
  if (!contract || !constructor) throw new MetadataEmitError('A required compiler attribute constructor was not planned');
  return attributes.writer.methodTokens.get(constructor) ?? attributes.builder.member(
    attributes.types.typeToken(contract.type), '.ctor', methodSymbolSignature(attributes.types, constructor));
}

function requiredType(analysis, name) {
  const type = analysis.globalNamespace.lookupType(name, 0);
  if (!type || type.isErrorType?.()) throw new MetadataEmitError('Missing compiler attribute dependency: ' + name);
  return type;
}

function attributeUsage(attributes, parent, usage, analysis) {
  const type = requiredType(analysis, 'System.AttributeUsageAttribute');
  const target = requiredType(analysis, 'System.AttributeTargets');
  const constructor = requiredAttributeConstructor(type, [target], analysis.core.attribute);
  const named = [
    { name: 'AllowMultiple', isField: false, type: 'bool', value: usage.allowMultiple ?? false },
    { name: 'Inherited', isField: false, type: 'bool', value: usage.inherited ?? false },
  ];
  attributes.add(parent, compilerAttributeConstructorToken(attributes, { type, constructor }),
    encodeCustomAttribute(['int'], [usage.targets], named));
}

/** One call after normal CustomAttribute writing marks every local fallback, including EmbeddedAttribute itself. */
export function writeCompilerAttributeDefinitions(attributes) {
  const registry = attributes.writer.compilerAttributes;
  if (!registry?.definitions.size) return;
  const analysis = registry.analysis, embedded = registry.get('Microsoft.CodeAnalysis.EmbeddedAttribute');
  const embeddedConstructor = compilerAttributeConstructorToken(attributes, embedded);
  const generated = analysis.globalNamespace.lookupType(GENERATED, 0);
  // CompilerGenerated is optional in the target surface, as in Roslyn's synthesized-attribute contract.
  const generatedConstructor = generated && !generated.isErrorType?.() ? compilerAttributeConstructorToken(attributes, {
    type: generated, constructor: requiredAttributeConstructor(generated, [], analysis.core.attribute),
  }) : null;
  const marker = encodeCustomAttribute([], []);
  for (const contract of registry.definitions.values()) {
    const parent = attributes.writer.typeToken(contract.type);
    if (generatedConstructor) attributes.add(parent, generatedConstructor, marker);
    attributes.add(parent, embeddedConstructor, marker);
    if (contract.usage) attributeUsage(attributes, parent, contract.usage, analysis);
  }
}
