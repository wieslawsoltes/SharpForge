import { TypeKind } from '../type-system/type-desc.js';
import { loadError, LoadErrorCode } from '../load-errors.js';

/** Immutable construction shape depths, independent of the lazily completed inheritance graph. */
export class GenericTypeShapes {
  #depths = new WeakMap();
  #maxDepth;

  constructor(maxDepth) {
    this.#maxDepth = maxDepth;
  }

  depth(type, budget, operationDepth = 0) {
    if (--budget.remaining < 0) throw loadError(LoadErrorCode.LimitExceeded, 'Generic construction work limit exceeded');
    if (operationDepth >= this.#maxDepth) {
      throw loadError(LoadErrorCode.LimitExceeded, 'Generic construction depth exceeded');
    }
    const cached = this.#depths.get(type);
    if (cached !== undefined) return cached;
    let depth = 0;
    if (type.elementType) {
      depth = 1 + this.depth(type.elementType, budget, operationDepth + 1);
    } else if (type.kind === TypeKind.Instantiation) {
      for (const argument of type.genericArguments) {
        depth = Math.max(depth, 1 + this.depth(argument, budget, operationDepth + 1));
      }
    } else if (type.kind === TypeKind.FunctionPointer) {
      depth = 1 + this.depth(type.signature.returnType, budget, operationDepth + 1);
      for (const parameter of type.signature.parameters) {
        depth = Math.max(depth, 1 + this.depth(parameter, budget, operationDepth + 1));
      }
    }
    if (depth >= this.#maxDepth) throw loadError(LoadErrorCode.LimitExceeded, 'Generic construction depth exceeded');
    this.#depths.set(type, depth);
    return depth;
  }
}
