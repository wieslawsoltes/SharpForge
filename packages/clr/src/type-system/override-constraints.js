import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

const unsupported = message => loadError(LoadErrorCode.TypeLoad, message);

/** Compare explicit method constraints without instantiating a generic type or executing a method. */
export class OverrideConstraints {
  #loader;
  #maxRows;
  #methods = new WeakMap();
  constructor(loader, maxRows) {
    this.#loader = loader;
    this.#maxRows = maxRows;
  }

  async #read(method, signal) {
    checkCancellation(signal);
    if (this.#methods.has(method)) return this.#methods.get(method);
    const module = method.module;
    if (module.rowCount(42) + module.rowCount(44) > this.#maxRows) {
      throw loadError(LoadErrorCode.LimitExceeded, 'Override generic metadata row limit exceeded');
    }
    const result = [];
    for (const parameter of method.genericParameters) {
      checkCancellation(signal);
      const flags = parameter.genericParameterAttributes;
      if ((flags & ~0x1c) || (flags & 0xc) === 0xc) {
        throw unsupported('Override constraints require invariant class, struct or constructor flags');
      }
      const types = new Set();
      for (const token of parameter.genericParameterConstraintTokens) {
        if (![1, 2].includes(token >>> 24)) {
          throw unsupported('Generic constraint expressions require a later substitution service');
        }
        types.add(await this.#loader.load(module, token, { signal }));
      }
      result.push({ flags, types });
    }
    checkCancellation(signal);
    this.#methods.set(method, result);
    return result;
  }

  /** The implementation can remove constraints but cannot add more restrictive requirements. */
  async check(implementation, declaration, signal) {
    const actual = await this.#read(implementation, signal);
    const expected = await this.#read(declaration, signal);
    if (actual.length !== expected.length) throw unsupported('Override generic constraint arities differ');
    for (let index = 0; index < actual.length; index++) {
      checkCancellation(signal);
      const derived = actual[index], base = expected[index];
      if (((derived.flags & 4) && !(base.flags & 4)) || ((derived.flags & 8) && !(base.flags & 8)) ||
          ((derived.flags & 16) && !(base.flags & 24))) {
        throw unsupported('Override introduces a stronger special generic constraint');
      }
      for (const type of derived.types) {
        if (this.#loader.isIntrinsic(type, 'System.Object')) continue;
        if ((derived.flags & 8) && this.#loader.isIntrinsic(type, 'System.ValueType')) continue;
        if (!base.types.has(type)) throw unsupported('Override introduces a different explicit generic constraint');
      }
    }
    checkCancellation(signal);
  }
}
