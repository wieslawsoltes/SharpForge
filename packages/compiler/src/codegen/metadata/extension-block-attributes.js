/** Language-generated attributes of extension grouping declarations and their shipped marker contract. */
import { encodeCustomAttribute, token } from '@sharpforge/cil';
import { SymbolKind } from '../../symbols/types.js';
import { compilerAttributeConstructorToken } from './compiler-attribute-definitions.js';

const EXTENSION_ATTRIBUTE = 'System.Runtime.CompilerServices.ExtensionAttribute';

/** Emits only extension-owned attributes; normal symbol/parameter metadata is handled by the common writer. */
export function writeExtensionBlockAttributes(attributes, assemblyAlreadyMarked) {
  const writer = attributes.writer;
  const extensions = writer.extensions;
  if (!extensions?.markerAttribute) return;
  for (const type of extensions.markedTypes) {
    if (!writer.plans.get(type).methods.some(method => method.symbol?.isExtensionMethod)) {
      attributes.wellKnown(writer.typeToken(type), EXTENSION_ATTRIBUTE);
    }
  }
  if (!assemblyAlreadyMarked) attributes.wellKnown(token(0x20, 1), EXTENSION_ATTRIBUTE);
  const contract = extensions.markerAttribute;
  const constructor = compilerAttributeConstructorToken(attributes, contract);
  for (const [declaration, marker] of extensions.declarations) {
    const parent = declaration.kind === SymbolKind.Property ? writer.propertyTokens.get(declaration) : writer.methodTokens.get(declaration);
    attributes.add(parent, constructor, encodeCustomAttribute(['string'], [marker]));
  }
  for (const marker of extensions.markers) attributes.compilerGenerated(writer.methodTokens.get(marker));
}
