import { cliSystemName } from '@sharpforge/cil';
import { OverrideConstraints } from './override-constraints.js';
import { GenericOverrideDefinitions } from './generic-override-definitions.js';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

const fail = message => loadError(LoadErrorCode.TypeLoad, message);
const constrained = parameter => parameter.genericParameterAttributes || parameter.genericParameterConstraintTokens.length;

/** Context-local, bounded signature keys for implicit class override matching. */
export class OverrideSignatures {
  #loader;
  #keys = new WeakMap();
  #identities = new WeakMap();
  #count = 0;
  #limit;
  #genericDefinitions;
  #constraints;
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
    if (signature.genericArity && method.module.rowCount(42) + method.module.rowCount(44) > this.#limit) {
      throw loadError(LoadErrorCode.LimitExceeded, 'Override generic metadata row limit exceeded');
    }
    const arity = method.genericParameters.length;
    const types = [];
    for (const type of [signature.returnType, ...signature.parameters]) {
      types.push(await this.#type(type, method.module, arity, signal));
    }
    const key = `${Number(signature.hasThis)}:${arity}:${types.join(';')}`;
    checkCancellation(signal);
    this.#keys.set(method, key);
    return key;
  }
  checkConstraints(implementation, declaration, signal) {
    if (!implementation.genericParameters.some(constrained) && !declaration.genericParameters.some(constrained)) return null;
    this.#constraints ??= new OverrideConstraints(this.#loader, this.#limit);
    return this.#constraints.check(implementation, declaration, signal);
  }
  async #type(node, module, arity, signal, allowModifiers = true) {
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
    if (node.kind === 'modreq' || node.kind === 'modopt') {
      if (!allowModifiers) throw fail('Modified generic override argument subtrees require later binding');
      const modifier = await this.#modifier(module, node.token, signal);
      return `${node.kind}:${this.#identity(modifier)}(${await this.#type(node.element, module, arity, signal)})`;
    }
    if (node.kind === 'genericInstance') {
      this.#genericDefinitions ??= new GenericOverrideDefinitions(this.#loader, this.#limit);
      const definition = await this.#genericDefinitions.resolve(module, node, signal);
      const argumentsList = [];
      for (const argument of node.arguments) argumentsList.push(await this.#type(argument, module, arity, signal, false));
      return `g${this.#identity(definition)}[${argumentsList.join(';')}]`;
    }
    if (['byref', 'pointer', 'szarray', 'array'].includes(node.kind)) {
      if (node.kind === 'array' && (node.sizes.length || node.lowerBounds.some(bound => bound !== 0))) {
        throw fail('Sized or nonzero-bound arrays in override signatures require a later binding service');
      }
      return `${node.kind}:${node.rank ?? 0}(${await this.#type(node.element, module, arity, signal, allowModifiers)})`;
    }
    throw fail(`Override signature ${node.kind} requires a later binding service`);
  }
  async #modifier(module, token, signal) {
    if (![1, 2].includes(token >>> 24)) throw fail('Override modifiers require a TypeDef or TypeRef definition');
    const type = await this.#loader.load(module, token, { signal });
    checkCancellation(signal);
    const metadata = type.module;
    if (metadata && metadata.rowCount(42) + metadata.rowCount(44) > this.#limit) {
      throw loadError(LoadErrorCode.LimitExceeded, 'Override modifier metadata row limit exceeded');
    }
    if (type.genericParameters.length) throw fail('Open generic override modifiers require generic binding');
    return type;
  }
}
