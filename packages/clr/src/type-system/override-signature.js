import { cliSystemName } from '@sharpforge/cil';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

const fail = message => loadError(LoadErrorCode.TypeLoad, message);

/** Context-local, bounded signature keys for implicit class override matching. */
export class OverrideSignatures {
  #loader;
  #keys = new WeakMap();
  #identities = new WeakMap();
  #count = 0;
  #limit;
  constructor(loader, limit) { this.#loader = loader; this.#limit = limit; }
  #identity(type) {
    if (!this.#identities.has(type)) {
      if (this.#count >= this.#limit) throw loadError(LoadErrorCode.LimitExceeded, 'Override signature identity limit exceeded');
      this.#identities.set(type, ++this.#count);
    }
    return `t${this.#identities.get(type)}`;
  }
  async key(method, signal) {
    checkCancellation(signal);
    if (this.#keys.has(method)) return this.#keys.get(method);
    const signature = method.signature;
    if (signature.callingConvention !== 0 || signature.explicitThis || signature.sentinel !== -1) {
      throw fail('Virtual base-definition matching requires a default instance signature');
    }
    const arity = method.genericParameters.length;
    if (method.genericParameters.some(parameter => parameter.genericParameterAttributes || parameter.genericParameterConstraintTokens.length)) {
      throw fail('Constrained generic override matching requires the generic constraint service');
    }
    const types = [];
    for (const type of [signature.returnType, ...signature.parameters]) {
      types.push(await this.#type(type, method.module, arity, signal));
    }
    const key = `${Number(signature.hasThis)}:${arity}:${types.join(';')}`;
    checkCancellation(signal);
    this.#keys.set(method, key);
    return key;
  }
  async #type(node, module, arity, signal) {
    checkCancellation(signal);
    if (node.kind === 'primitive') return this.#identity(this.#loader.intrinsic(cliSystemName(node.name)));
    if (node.kind === 'class' || node.kind === 'valuetype') {
      const type = await this.#loader.load(module, node.token, { signal });
      if ((node.kind === 'valuetype') !== ['valuetype', 'enum'].includes(type.kind)) throw fail('Override signature type category mismatch');
      return this.#identity(type);
    }
    if (node.kind === 'genericParameter' && node.scope === 'method') {
      if (node.index >= arity) throw fail('Override signature method parameter exceeds its generic arity');
      return `m${node.index}`;
    }
    if (['byref', 'pointer', 'szarray', 'array'].includes(node.kind)) {
      if (node.kind === 'array' && (node.sizes.length || node.lowerBounds.some(bound => bound !== 0))) {
        throw fail('Sized or nonzero-bound arrays in override signatures require a later binding service');
      }
      return `${node.kind}:${node.rank ?? 0}(${await this.#type(node.element, module, arity, signal)})`;
    }
    throw fail(`Override signature ${node.kind} requires a later generic/modifier binding service`);
  }
}
