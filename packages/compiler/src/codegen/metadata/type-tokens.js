/**
 * Metadata tokens for the types a compilation mentions (SF-A02-T29).
 *
 * A source type is a TypeDef whose token is fixed before any signature is written; every other type definition is a
 * TypeRef (nested ones scoped by the TypeRef of their enclosing type). A type that is not a definition - a constructed
 * generic, an array, a type parameter - is a TypeSpec over its signature blob.
 */
import { token } from '@sharpforge/cil';
import { SymbolKind } from '../../symbols/types.js';
import { encodeTypeSignature, needsTypeSpec, typeDefOrRefEncoded, ElementType } from '../generics.js';
import { contractAssemblyOf } from './reference-contracts.js';

/** The reason a symbol cannot be written to metadata; the emitter reports it instead of writing a wrong row. */
export class MetadataEmitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MetadataEmitError';
  }
}

/** The namespace of a top-level type as it is written in metadata ('' for the global namespace and for nested types). */
export function namespaceOf(type) {
  if (type.containingType) return '';
  const names = [];
  for (let scope = type.containingSymbol; scope?.kind === SymbolKind.Namespace && scope.name; scope = scope.containingSymbol) names.unshift(scope.name);
  return names.join('.');
}

/** FNV-1a over the UTF-16 code units of a text, as eight hexadecimal digits: a stable name component. */
function stableHash(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

/**
 * The TypeDef name of a source type. A C# 11 `file` type is named `<File>F<hash>__Name`, as Roslyn names it, so that
 * equally named file-local types of different files do not collide; the hash here is of the file's URI (Roslyn
 * hashes the path with SHA-256).
 */
export function definitionNameOf(type) {
  if (!type.isFileLocal) return type.metadataName;
  const uri = String(type.locations?.[0]?.uri ?? ''),
    stem = (uri.split(/[\\/]/).pop() ?? '').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_]/g, '_');
  return `<${stem}>F${stableHash(uri)}__${type.metadataName}`;
}

export class TypeTokens {
  /** @param builder a MetadataBuilder  @param {object[]} sourceTypes the source type definitions in TypeDef order (after `<Module>`) */
  constructor(builder, sourceTypes) {
    this.builder = builder;
    this.definitions = new Map(sourceTypes.map((type, index) => [type, token(2, index + 2)]));
    this.references = new Map();
    this.tokenOf = definition => this.definitionToken(definition);
  }
  /** TypeDef or TypeRef token of a type definition. */
  definitionToken(type) {
    const definition = type.originalDefinition ?? type,
      defined = this.definitions.get(definition);
    if (defined) return defined;
    let reference = this.references.get(definition);
    if (reference) return reference;
    const outer = definition.containingType;
    if (outer) {
      reference = this.builder.addRow('TypeRef', { ResolutionScope: this.definitionToken(outer), Name: definition.metadataName, Namespace: '' });
    } else {
      const namespace = namespaceOf(definition),
        name = definition.metadataName;
      reference = this.builder.typeRef((namespace ? namespace + '.' : '') + name, contractAssemblyOf(namespace, name));
    }
    this.references.set(definition, reference);
    return reference;
  }
  /** The signature bytes of a type (ECMA-335 II.23.2.12). */
  signature(type) {
    try {
      return encodeTypeSignature(type, this.tokenOf);
    } catch (error) {
      // The encoder names the type it has no signature for (a function pointer, `dynamic`); anything else is a defect.
      if (/^Cannot encode /.test(error?.message ?? '')) throw new MetadataEmitError(error.message);
      throw error;
    }
  }
  /** The signature of a framework class the symbol table may not model, by its full metadata name (`CLASS TypeRef`). */
  frameworkClassSignature(fullName) {
    return [ElementType.Class, ...typeDefOrRefEncoded(this.builder.typeRef(fullName))];
  }
  /** TypeDefOrRef token for a base type, an interface, a constraint or an event type. */
  typeToken(type) {
    if (!needsTypeSpec(type)) return this.definitionToken(type);
    return this.builder.addRow('TypeSpec', { Signature: Uint8Array.from(this.signature(type)) });
  }
}
