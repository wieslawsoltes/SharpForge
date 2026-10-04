import { ConstantValue, Decimal } from './constant-value.js';
import { stripNullable } from '../conversions/nullable.js';
import { importedConstant } from '../metadata-import/imported-constant.js';

/** Normalize source typed constants and metadata scalar defaults at their point of use. */
export function parameterDefaultConstant(parameter) {
  if (!parameter?.hasExplicitDefaultValue) return null;
  const raw = parameter.explicitDefaultValue;
  if (raw instanceof ConstantValue) return raw;
  if (raw instanceof Decimal) return ConstantValue.decimal(raw);
  return importedConstant({ hasConstantValue: true, constantValue: raw, type: stripNullable(parameter.type) });
}
