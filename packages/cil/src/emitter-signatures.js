import { parseSignatureType } from './metadata/signature-parser.js';
import { fieldSignature, methodSignature, localSignature, propertySignature } from './metadata/signature-members.js';

/** Bind declared image classes before interpreting punctuation in compatibility type strings. */
export class EmitterSignatures {
  constructor(typeTokens, resolveToken) {
    const namedTypes = new Map();
    for (const [name, token] of typeTokens) namedTypes.set(name, { kind: 'class', token });
    this.options = { namedTypes };
    this.resolveToken = resolveToken;
  }

  type(type) {
    return parseSignatureType(type, this.resolveToken, this.options);
  }

  types(types) {
    return types.map(type => this.type(type));
  }

  field(type) {
    return fieldSignature(this.type(type));
  }

  method(result, parameters, isStatic) {
    return methodSignature(this.type(result), this.types(parameters), isStatic);
  }

  locals(types) {
    return localSignature(this.types(types));
  }

  property(result, parameters, isStatic) {
    return propertySignature(this.type(result), this.types(parameters), isStatic);
  }
}
