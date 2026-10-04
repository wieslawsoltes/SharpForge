import { loadError, LoadErrorCode } from '../load-errors.js';

function parameter(service, signature, operation) {
  operation.beginGeneric();
  const arguments_ = operation.scope?.[`${signature.scope}Arguments`];
  if (!arguments_ || signature.index >= arguments_.length) {
    throw loadError(LoadErrorCode.TypeLoad, `Unbound ${signature.scope} generic parameter ${signature.index}`);
  }
  const type = arguments_[signature.index];
  operation.observe(type);
  return type;
}

async function instance(service, signature, operation) {
  operation.beginGeneric();
  if (![1, 2].includes(signature.type.token >>> 24)) {
    throw loadError(LoadErrorCode.TypeLoad, 'Generic signature definition requires a TypeDef or TypeRef token');
  }
  const definition = await service.resolve(signature.type, operation);
  const arguments_ = [];
  for (const argument of signature.arguments) {
    arguments_.push(await service.resolve(argument, operation));
  }
  return operation.instantiate(definition, arguments_);
}

/** CLR binding extensions consume ordered handles; replacement tokens are never reinterpreted in another module. */
export const genericSignatureTypes = Object.freeze({ genericParameter: parameter, genericInstance: instance });
