/**
 * Framework generics over types the registry does not list (SF-A02-T02.6).
 *
 * The framework registry is closed: it lists `Task<int>`, `Task<string>`, `Task<object>`, ... and nothing for
 * `Task<Animal>`. The runtime's objects carry no type arguments, so a construction over a reference type has the same
 * representation as the one over `object` and shares its code:
 *
 *   Task<Animal>, Task<Box<int>>, Task<int[]>   ->  the registry's `Task<object>`
 *
 * Only arguments whose values the framework can treat as plain references are erased: classes without value
 * equality (source classes that do not define equality, framework classes) and arrays. A record, a delegate or a
 * tuple has equality that differs from reference equality (and a tuple is a value type on .NET), so a construction
 * over one of them is not erased and stays unsupported.
 */
import { NamedTypeSymbol, ConstructedNamedTypeSymbol, ArrayTypeSymbol, TypeKind, TypeWithAnnotations, typeOf } from '../../symbols/types.js';

export class FrameworkConstructions {
  /** @param host the generator: `{isSource(symbol), analysis: {core}, bridge}` */
  constructor(host) {
    this.host = host;
  }
  /**
   * True for a type argument of `definition` whose values are plain references to the framework. A task only carries
   * its result, so every value the image represents as a reference qualifies there.
   */
  isErasable(type, definition) {
    if (definition === this.host.analysis.core.taskT) {
      const types = this.host.types;
      return type.specialType !== 'System_Object' && types.isReference(types.imageType(type));
    }
    if (type instanceof ArrayTypeSymbol) return type.rank === 1;
    if (!(type instanceof NamedTypeSymbol) || type.specialType) return false;
    if (type.typeKind !== TypeKind.Class || type.isRecord || type.isTupleType) return false;
    // A source class that defines its own equality is compared by it on .NET (`Contains`, `HashSet<T>`).
    if (this.host.isSource(type)) return !this.definesEquality(type);
    // A framework class is a plain reference too: `List<List<int>>`, `Dictionary<string, List<Animal>>`.
    return !!(this.host.bridge.registryName(type) ?? this.imageTypeOf(type));
  }
  /** True when a source class or one of its base classes declares `Equals` or `GetHashCode`, or implements `IEquatable<T>`. */
  definesEquality(type) {
    for (let current = type, depth = 0; current && depth < 64; current = current.baseType, depth++) {
      if (!this.host.isSource(current)) break;
      const definition = current.originalDefinition;
      if (definition.getMembers('Equals').length || definition.getMembers('GetHashCode').length) return true;
      if (current.interfaces.some(candidate => candidate.name === 'IEquatable')) return true;
    }
    return false;
  }
  /**
   * The registry's symbol for a framework construction: the listed one, or the one over `object` for every erasable
   * argument. Returns `{type, erased}` or null when the registry has neither.
   */
  registryConstruction(type) {
    if (!(type instanceof NamedTypeSymbol) || this.host.isSource(type)) return null;
    const definition = type.originalDefinition,
      provider = definition.instanceProvider;
    // Delegate types are lowered to image classes of their own: the registry's delegates are not shared.
    if (!definition.arity || !provider || definition.typeKind === TypeKind.Delegate) return null;
    const construct = typeArguments =>
      provider(
        definition,
        typeArguments.map(argument => new TypeWithAnnotations(argument)),
      );
    const typeArguments = type.typeArguments.map(typeOf),
      listed = construct(typeArguments);
    if (listed) return { type: listed, erased: false };
    if (!typeArguments.some(argument => this.isErasable(argument, definition))) return null;
    const object = this.host.analysis.core.object,
      shared = construct(typeArguments.map(argument => (this.isErasable(argument, definition) ? object : argument)));
    return shared ? { type: shared, erased: true } : null;
  }
  /**
   * For a construction of a registry generic that no registry instantiation can run: the display name of the
   * instantiation the registry would have to list (reference arguments over `object`). Null for any other type.
   */
  missingContract(type) {
    if (!(type instanceof NamedTypeSymbol) || this.host.isSource(type)) return null;
    const definition = type.originalDefinition;
    if (!definition.arity || !definition.instanceProvider || definition.typeKind === TypeKind.Delegate) return null;
    if (this.registryConstruction(type)) return null;
    const object = this.host.analysis.core.object,
      wanted = type.typeArguments.map(argument => (this.isErasable(typeOf(argument), definition) ? new TypeWithAnnotations(object) : argument));
    return new ConstructedNamedTypeSymbol(definition, wanted).toDisplayString();
  }
  /** The image type name of a framework construction the registry does not list under its own symbol, or null. */
  imageTypeOf(type) {
    const construction = this.registryConstruction(type);
    return construction ? this.host.bridge.registryName(construction.type) : null;
  }
}
