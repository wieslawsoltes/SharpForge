import { TypeKind } from '../type-system/type-desc.js';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

/** Simultaneous handle substitution in a loaded definition's graph; argument inheritance is not expanded. */
export class InstantiationTypeSubstitution {
  #arguments;
  #operations;
  #cache = new WeakMap();
  #maxDepth;

  constructor(definition, arguments_, operations, maxDepth) {
    this.#arguments = new Map(definition.genericParameters.map((parameter, index) => [parameter, arguments_[index]]));
    this.#operations = operations;
    this.#maxDepth = maxDepth;
  }

  apply(type, depth = 0) {
    checkCancellation(this.#operations.signal);
    this.#operations.visit();
    if (depth >= this.#maxDepth) throw loadError(LoadErrorCode.LimitExceeded, 'Generic substitution depth exceeded');
    if (type === null) return null;
    if (this.#arguments.has(type)) return this.#arguments.get(type);
    const cached = this.#cache.get(type);
    if (cached) return cached;
    const result = this.#map(type, depth);
    this.#cache.set(type, result);
    return result;
  }

  #map(type, depth) {
    if (type.elementType) {
      const element = this.apply(type.elementType, depth + 1);
      return element === type.elementType ? type : this.#operations.element(type.kind, element, type.rank);
    }
    if (type.kind === TypeKind.FunctionPointer) return this.#functionPointer(type, depth);
    const arguments_ = type.genericDefinition ? type.genericArguments : type.genericParameters;
    if (!arguments_.length) return type;
    const mapped = arguments_.map(argument => this.apply(argument, depth + 1));
    if (mapped.every((argument, index) => argument === arguments_[index])) return type;
    return this.#operations.instantiate(type.genericDefinition ?? type, mapped);
  }

  #functionPointer(type, depth) {
    const signature = type.signature;
    const returnType = this.apply(signature.returnType, depth + 1);
    const parameters = signature.parameters.map(parameter => this.apply(parameter, depth + 1));
    if (returnType === signature.returnType && parameters.every((parameter, index) => parameter === signature.parameters[index])) return type;
    return this.#operations.functionPointer({ ...signature, returnType, parameters });
  }
}
