import { cliSystemName } from '@sharpforge/cil';
import { TypeKind } from './type-desc.js';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

async function definition(service, signature, operation) {
  const type = await operation.resolveType(signature.token);
  const value = [TypeKind.ValueType, TypeKind.Enum].includes(type.kind);
  if ((signature.kind === 'valuetype') !== value) {
    throw loadError(LoadErrorCode.TypeLoad, 'Signature class/value category does not match its definition');
  }
  return type;
}

async function element(service, signature, operation) {
  const type = await service.resolve(signature.element, operation);
  return service.loader.constructElement(signature.kind, type, signature.kind === 'szarray' ? 1 : signature.rank ?? 0);
}

async function functionPointer(service, signature, operation) {
  const parameters = [];
  for (const parameter of signature.signature.parameters) {
    parameters.push(await service.resolve(parameter, operation));
  }
  const returnType = await service.resolve(signature.signature.returnType, operation);
  return service.functionPointer({ ...signature.signature, returnType, parameters });
}

const handlers = Object.freeze(Object.assign(Object.create(null), {
  primitive: (service, signature) => service.loader.intrinsic(cliSystemName(signature.name)),
  class: definition,
  valuetype: definition,
  szarray: element,
  array: element,
  pointer: element,
  byref: element,
  functionPointer,
}));

/** Decode-independent signature dispatch; extensions receive the same explicit resolution operation. */
export class SignatureTypes {
  #functionPointer;
  #extensions;

  constructor(loader, createFunctionPointer, extensions = null) {
    this.loader = loader;
    this.#functionPointer = createFunctionPointer;
    this.#extensions = extensions;
    Object.freeze(this);
  }

  functionPointer(signature) {
    return this.#functionPointer(signature);
  }

  async resolve(signature, operation) {
    checkCancellation(operation.signal);
    const handler = this.#extensions && Object.hasOwn(this.#extensions, signature.kind)
      ? this.#extensions[signature.kind] : handlers[signature.kind];
    if (!handler) {
      throw loadError(LoadErrorCode.TypeLoad, `Signature type ${signature.kind} requires generic/modifier type services`);
    }
    return handler(this, signature, operation);
  }
}
