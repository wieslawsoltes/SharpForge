/**
 * Metadata tokens for the types a compilation mentions (SF-A02-T29).
 *
 * A source type is a TypeDef whose token is fixed before any signature is written; every other type definition is a
 * TypeRef (nested ones scoped by the TypeRef of their enclosing type). A type that is not a definition - a constructed
 * generic, an array, a type parameter - is a TypeSpec over its signature blob.
 */
import { token } from '@sharpforge/cil';
import { SymbolKind, TypeKind, substituteType } from '../../symbols/types.js';
import { encodeTypeSignature, needsTypeSpec, typeDefOrRefEncoded, ElementType } from '../generics.js';
import { contractAssemblyOf } from './reference-contracts.js';
import { referencedAssemblyOf } from './reference-identities.js';

const OBJECT = 'System.Object';

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
  // A delegate type the compiler declares for a lambda or method group (C# 10) cannot be named in source.
  if (type.isSynthesizedDelegate) return '<>f__AnonymousDelegate' + type.synthesizedOrdinal;
  if (!type.isFileLocal) return type.metadataName;
  const uri = String(type.locations?.[0]?.uri ?? ''),
    stem = (uri.split(/[\\/]/).pop() ?? '').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_]/g, '_');
  return `<${stem}>F${stableHash(uri)}__${type.metadataName}`;
}

export class TypeTokens {
  /**
   * @param builder a MetadataBuilder  @param {object[]} sourceTypes the source type definitions in TypeDef order (after `<Module>`)
   * @param {(definition: object, fullName: string) => string|undefined} [assemblyOf] the referenced assembly that
   *   defines a type (reference-identities.js); without it only the contract table decides
   */
  constructor(builder, sourceTypes, assemblyOf = referencedAssemblyOf) {
    this.builder = builder;
    this.assemblyOf = assemblyOf;
    this.definitions = new Map(sourceTypes.map((type, index) => [type, token(2, index + 2)]));
    this.references = new Map();
    this.tokenOf = definition => this.definitionToken(definition);
    /** The substitution types are read under before they are encoded, or null (see `within`). */
    this.substitution = null;
  }
  /**
   * A view of these tokens that reads every type under a substitution before encoding it: the code of a synthesized
   * generic class names the type parameters of the method it was made for by the class's own ones.
   * @param substitution a TypeMap, or null for these tokens themselves
   */
  within(substitution) {
    if (!substitution) return this;
    const view = Object.create(this);
    view.substitution = substitution;
    return view;
  }
  /** TypeDef/TypeRef of a type definition, or a framework signature modifier by its full metadata name. */
  definitionToken(type) {
    if (typeof type === 'string') return this.builder.typeRef(type);
    // An anonymous type is declared by its generic class (symbols/synthesized/anonymous-types.js).
    if (type.isAnonymousType) return this.definitionToken(type.metadataForm());
    const definition = type.originalDefinition ?? type,
      defined = this.definitions.get(definition);
    if (defined) return defined;
    return this.referenceToken(definition);
  }
  /** A TypeRef chain, including a local enclosing type when a synthesized nested definition is omitted by refout. */
  referenceToken(definition) {
    let reference = this.references.get(definition);
    if (reference) return reference;
    const outer = definition.containingType;
    if (definition.typeKind === TypeKind.Dynamic) {
      // `dynamic` is `System.Object` wherever a type is named by a token (`newarr`, `castclass`, a generic argument).
      reference = this.builder.typeRef(OBJECT, this.assemblyOf(definition, OBJECT) ?? contractAssemblyOf('System', 'Object'));
    } else if (outer) {
      reference = this.builder.addRow('TypeRef', { ResolutionScope: this.referenceToken(outer.originalDefinition ?? outer),
        Name: definition.metadataName, Namespace: '' });
    } else if (this.definitions.has(definition)) {
      // A nil ResolutionScope names the current module; TypeDef is not a valid ResolutionScope tag.
      reference = this.builder.addRow('TypeRef', { ResolutionScope: 0, Name: definitionNameOf(definition), Namespace: namespaceOf(definition) });
    } else {
      const namespace = namespaceOf(definition),
        name = definition.metadataName;
      // A type read from a reference assembly is referenced through that assembly; a registry type through its contract.
      const fullName = (namespace ? namespace + '.' : '') + name,
        assembly = this.assemblyOf(definition, fullName) ?? contractAssemblyOf(namespace, name);
      reference = this.builder.typeRef(fullName, assembly);
    }
    this.references.set(definition, reference);
    return reference;
  }
  /** The signature bytes of a type (ECMA-335 II.23.2.12). */
  signature(type) {
    try {
      return encodeTypeSignature(this.substitution ? substituteType(type, this.substitution) : type, this.tokenOf);
    } catch (error) {
      // The encoder names a type it has no signature for; anything else is a defect.
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
