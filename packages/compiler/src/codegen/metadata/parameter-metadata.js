import { encodeCustomAttribute } from '@sharpforge/cil';
import { ArrayTypeSymbol } from '../../symbols/types.js';
import { MetadataEmitError } from './type-tokens.js';
import { methodSignature } from './member-signatures.js';
import { constantTypeOf, constantRowValue, NULL_REFERENCE_CONSTANT } from './constant-metadata.js';
import { parameterDefaultConstant } from '../../constants/parameter-default.js';
import { writeRefParameterAttributes } from './ref-declaration-metadata.js';

const DECIMAL_CONSTANT = 'System.Runtime.CompilerServices.DecimalConstantAttribute';
const PARAM_COLLECTION = 'System.Runtime.CompilerServices.ParamCollectionAttribute';
const WORD_MASK = 0xffffffffn;

/** Writes an optional parameter's Constant row; the public builder sets Param.HasDefault atomically. */
export function writeParameterConstant(builder, parent, parameter) {
  if (!parameter?.hasExplicitDefaultValue) return;
  const constant = parameterDefaultConstant(parameter);
  if (constant?.type === 'decimal') return;
  // `default(S)` and `default(T)` have no scalar compiler constant. CLI metadata represents these as null.
  const type = constant ? constantTypeOf(constant) : NULL_REFERENCE_CONSTANT;
  if (type === undefined) {
    throw new MetadataEmitError(`the default value of parameter '${parameter.name}' cannot be represented in metadata`);
  }
  builder.definitions.constantValue({
    Parent: parent,
    Type: type,
    Value: constant ? constantRowValue(constant) : null,
  });
}

/** Emits parameter markers and the decimal default encoding required by native reflection and importing compilers. */
export function writeParameterAttributes(writer, parent, parameter) {
  writeRefParameterAttributes(writer, parent, parameter);
  if (parameter.isParams) {
    writer.wellKnown(parent, parameter.type instanceof ArrayTypeSymbol ? 'System.ParamArrayAttribute' : PARAM_COLLECTION);
  }
  const constant = parameterDefaultConstant(parameter);
  if (!parameter.hasExplicitDefaultValue || constant?.type !== 'decimal') return;
  const decimal = constant.value;
  const negative = decimal.mantissa < 0n;
  const magnitude = negative ? -decimal.mantissa : decimal.mantissa;
  const values = [decimal.scale, negative ? 128 : 0,
    Number((magnitude >> 64n) & WORD_MASK), Number((magnitude >> 32n) & WORD_MASK), Number(magnitude & WORD_MASK)];
  const types = [writer.core.byte, writer.core.byte, writer.core.uint, writer.core.uint, writer.core.uint];
  const shape = { isStatic: false, returnType: writer.core.void, parameters: types.map(type => ({ type })) };
  const constructor = writer.builder.member(writer.frameworkAttribute(DECIMAL_CONSTANT), '.ctor', methodSignature(writer.types, shape));
  writer.add(parent, constructor, encodeCustomAttribute(['byte', 'byte', 'uint', 'uint', 'uint'], values));
}
