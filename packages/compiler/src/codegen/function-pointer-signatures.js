/** ECMA-335 function-pointer signatures, including ref-slot and extensible calling-convention modifiers. */
import { RefKind } from '../symbols/types.js';

const BY_REFERENCE = 0x10;
const REQUIRED_MODIFIER = 0x1f;
const OPTIONAL_MODIFIER = 0x20;
const conventions = Object.freeze({ Cdecl: 1, Stdcall: 2, Thiscall: 3, Fastcall: 4 });
const conventionNamespace = 'System.Runtime.CompilerServices.CallConv';

function slotSignature(type, refKind, encode) {
  const bytes = [];
  const modifier = refKind === RefKind.Out ? 'System.Runtime.InteropServices.OutAttribute'
    : refKind === RefKind.In || refKind === RefKind.RefReadOnly ? 'System.Runtime.InteropServices.InAttribute' : null;
  if (modifier) bytes.push(REQUIRED_MODIFIER, ...encode.modifier(modifier));
  if (refKind === RefKind.RefReadOnlyParameter) {
    bytes.push(OPTIONAL_MODIFIER, ...encode.modifier('System.Runtime.CompilerServices.RequiresLocationAttribute'));
  }
  if (refKind && refKind !== RefKind.None) bytes.push(BY_REFERENCE);
  bytes.push(...encode.type(type));
  return bytes;
}

/**
 * MethodDefSig-shaped bytes following ELEMENT_TYPE_FNPTR, also used verbatim as a calli StandAloneSig.
 * `encode` supplies `type(TypeSymbol)`, `count(integer)` and `modifier(fullMetadataName)` byte encoders.
 */
export function encodeFunctionPointerSignature(signature, encode) {
  const names = signature.unmanagedConventions;
  const managed = signature.callingConvention === 'managed';
  const legacy = names.length === 1 ? conventions[names[0]] : null;
  const convention = managed ? 0 : legacy ?? 9;
  const bytes = [convention, ...encode.count(signature.parameters.length)];
  if (!managed && !legacy) {
    for (const name of names) bytes.push(OPTIONAL_MODIFIER, ...encode.modifier(conventionNamespace + name));
  }
  bytes.push(...slotSignature(signature.returnType.type, signature.returnRefKind, encode));
  for (const parameter of signature.parameters) bytes.push(...slotSignature(parameter.type.type, parameter.refKind, encode));
  return bytes;
}
