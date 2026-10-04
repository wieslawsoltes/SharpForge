import {scalarMetadataType} from './scalar-emission.js';
import { parseSignatureType } from './metadata/signature-parser.js';
import { fieldSignature, methodSignature, localSignature, propertySignature } from './metadata/signature-members.js';

/** Bind declared image classes before interpreting punctuation in compatibility type strings. */
export class EmitterSignatures {
  constructor(typeTokens, resolveToken, types = []) {
    const namedTypes = new Map();
    const values = new Set(types.filter(type => type.valueType).map(type => type.name));
    for (const [name, token] of typeTokens) namedTypes.set(name, {kind: values.has(name) ? 'valuetype' : 'class', token});
    this.options = { namedTypes };
    this.resolveToken = resolveToken;
  }

  type(type) {
    for (const name of ['ArgIterator', 'RuntimeArgumentHandle', 'RuntimeTypeHandle', 'RuntimeMethodHandle', 'RuntimeFieldHandle']) {
      const fullName = 'System.' + name;
      if (typeof type === 'string' && type.includes(fullName) && !this.options.namedTypes.has(fullName))
        this.options.namedTypes.set(fullName, {kind: 'valuetype', token: this.resolveToken(fullName)});
    }
    if (typeof type === 'string' && /(?:^|[<, ])(?:decimal|System\.Decimal)(?:$|[>\[&,])/.test(type)) {
      const decimal = {kind: 'valuetype', token: this.resolveToken('System.Decimal')};
      this.options.namedTypes.set('decimal', decimal);
      this.options.namedTypes.set('System.Decimal', decimal);
    }
    return parseSignatureType(scalarMetadataType(type), this.resolveToken, this.options);
  }

  types(types) {
    return types.map(type => this.type(type));
  }

  field(type) {
    return fieldSignature(this.type(type));
  }

  method(result, parameters, isStatic, options = {}) {
    return methodSignature(this.type(result), this.types(parameters), isStatic, undefined, options);
  }

  locals(types) {
    return localSignature(this.types(types));
  }

  property(result, parameters, isStatic) {
    return propertySignature(this.type(result), this.types(parameters), isStatic);
  }
}
