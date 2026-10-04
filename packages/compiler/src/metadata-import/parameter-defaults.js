import { Decimal } from '../constants/constant-value.js';
import { decodeAttributeBlob } from './attributes.js';

const DECIMAL_CONSTANT = 'System.Runtime.CompilerServices.DecimalConstantAttribute';
const HAS_DEFAULT = 0x1000;

/** Decimal defaults are attributes; other optional defaults are Constant rows (ECMA-335 II.22.9). */
export function importedParameterDefault(metadata, token, flags) {
  const constant = flags & HAS_DEFAULT ? metadata.constant(token) : undefined;
  if (constant) return constant;
  for (const attribute of metadata.customAttributes(token)) {
    if (attribute.fullName !== DECIMAL_CONSTANT) continue;
    const decoded = decodeAttributeBlob(attribute.blob, attribute.parameterTypes);
    if (decoded.hasErrors || decoded.constructorArguments.length !== 5) continue;
    const [scale, sign, high, middle, low] = decoded.constructorArguments.map(argument => argument.value);
    if (!Number.isInteger(scale) || scale < 0 || scale > 28 || !Number.isInteger(sign) || sign < 0 || sign > 255) continue;
    const words = [high, middle, low];
    if (!words.every(value => Number.isInteger(value) && value >= -0x80000000 && value <= 0xffffffff)) continue;
    const magnitude = (BigInt(high >>> 0) << 64n) | (BigInt(middle >>> 0) << 32n) | BigInt(low >>> 0);
    return { value: new Decimal(sign ? -magnitude : magnitude, scale) };
  }
  return undefined;
}
