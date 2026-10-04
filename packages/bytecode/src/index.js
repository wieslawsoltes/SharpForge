import {verifySourceTypeIdentities} from './source-type-identity.js';
export {copySourceTypeIdentity, sourceTypeIdentities} from './source-type-identity.js';
import {
  sourceNullableInstruction
} from './source-nullable-profile.js';
export {
  sourceNullableElement,
  sourceNullableInstruction
}
from './source-nullable-profile.js';
import {
  sourceCallArity
} from './source-call-arity.js';
import {
  memoryStackEffect
} from './memory-stack-effect.js';
import {
  sourceObjectSlot
} from './object-slots.js';
export {
  sourceObjectSlot,
  objectSlotKey
}
from './object-slots.js';
import {
  sourceValueInstruction
} from './source-value-profile.js';
export {
  sourceValueInstruction
}
from './source-value-profile.js';
import {
  exceptionRegionEntries
} from './exception-regions.js';
import {
  controlStackEffect
} from './control-stack-effect.js';
export {
  exceptionIntrinsicDefinitions
}
from './exception-intrinsic-profile.js';
export {
  syncIntrinsicDefinitions,
  isSynchronizationIntrinsic
}
from './sync-intrinsic-profile.js';
export {
  varargsIntrinsicDefinitions,
  varargsTypeDefinition,
  fixedCallSignature,
  validVarargsSignature
}
from './varargs-profile.js';
export {
  sourceArrayBuiltins,
  sourceMemoryBuiltins
}
from './array-intrinsic-profile.js';
import {
  verifyNumericInstruction,
  verifyScalarConstant
} from './numeric/source-profile.js';
import {
  enumTypes,
  frameworkType
} from '@sharpforge/framework';
export {
  smallInteger,
  smallIntegerIndirect
}
from './numeric/small-int.js';
export {
  managedExceptionTypes,
  exceptionTypeName,
  exceptionBaseType,
  exceptionHResult,
  exceptionMatches
}
from './exception-types.js';
import {
  FORMAT_VERSION,
  Op,
  OpName,
  BinaryName,
  UnaryName
} from './opcodes.js';
export {
  FORMAT_VERSION,
  EnumConvertBase,
  Op,
  OpName,
  Binary,
  BinaryName,
  Unary,
  UnaryName
}
from './opcodes.js';
import {
  recordSourceStacks,
  discardSourceStacks
} from './source-stack-proof.js';
export {
  verifiedSourceStackBound
}
from './source-stack-proof.js';
import {
  Builtins
} from './builtins.js';
export {
  Builtins,
  BuiltinMap,
  frameworkBuiltin,
  CONTRACT_BUILTIN_OFFSET,
  createBuiltinRegistry
}
from './builtins.js';
export {
  builtinOwners,
  builtinMemberShape,
  builtinParameterType
}
from './builtin-metadata.js';
export function disassemble(image, methodId) {
  const methods = methodId === undefined ? image.methods : [image.methods[methodId]];
  return methods.map(m => ({
    name: m.qualifiedName,
    id: m.id,
    instructions: Array.from({
      length: m.code.length / 3
    }, (_, i) => ({
      offset: i,
      op: OpName[m.code[i * 3]],
      a: m.code[i * 3 + 1],
      b: m.code[i * 3 + 2],
      point: m.code[i * 3] === Op.SEQ ? image.sequencePoints[m.code[i * 3 + 1]] : null
    }))
  }));
}
export function serializeImage(image) {
  return JSON.stringify(image, (key, value) => value instanceof Int32Array ? {
    $int32: [...value]
  } : value);
}
export function deserializeImage(text) {
  const image = JSON.parse(text, (key, value) => value?.$int32 ? Int32Array.from(value.$int32) : value);
  if (image.formatVersion !== FORMAT_VERSION) throw new Error('Unsupported SharpForge bytecode version');
  return image;
}
/** Structural and stack-height verification for compiler output and externally loaded images. */
export function verifyImage(image, {
  stackBounds = false
} = {}) {
  const errors = [],
    bounds = stackBounds ? [] : null;
  if (image?.formatVersion !== FORMAT_VERSION || !Array.isArray(image?.methods) || !Array.isArray(image?.constants) || !Array.isArray(image?.types) ||
    !Array.isArray(image?.sequencePoints) || !Array.isArray(image?.statics)) {
    discardSourceStacks(image);
    return ['Malformed or incompatible bytecode image'];
  }
  const fail = (m, pc, msg) => {
    if (errors.length < 100) errors.push(`${m?.qualifiedName??'<image>'}:${pc}: ${msg}`);
  };
  if (!image.constants.every(verifyScalarConstant) || !image.statics.every(s => verifyScalarConstant(s.value))) fail(null, 0,
    'Invalid scalar constant');
  if (image.outputKind === 'library' ? image.entryPoint !== null : !Number.isInteger(image.entryPoint) || !image.methods[image.entryPoint]) fail(null,
    0, 'Invalid entry point');
  const valueTypes = new Map(image.types.map(type => [type.name, type]));
  verifySourceTypeIdentities(image.types, fail);
  for (const m of image.methods) {
    if (m.objectSlot !== undefined && m.objectSlot !== sourceObjectSlot(m)) fail(m, 0, 'Invalid Object override slot');
    if (!(m.code instanceof Int32Array) || m.code.length % 3 || m.code.length > 3_000_000 || !Array.isArray(m.locals) || !Array.isArray(m.handlers)) {
      fail(m, 0, 'Invalid code or metadata');
      continue;
    }
    if (m.isAbstract) {
      if (m.code.length || m.handlers.length || m.isStatic || !m.isVirtual) fail(m, 0, 'Invalid abstract method');
      continue;
    }
    const n = m.code.length / 3,
      heights = new Map(),
      queue = [
        [0, 0]
      ];
    let peak = 0;
    queue.push(...exceptionRegionEntries(m, fail));
    while (queue.length) {
      const [pc, height] = queue.pop();
      if (pc < 0 || pc >= n) {
        fail(m, pc, 'Control flow leaves the method');
        continue;
      }
      if (heights.has(pc)) {
        if (heights.get(pc) !== height) fail(m, pc, 'Inconsistent stack height at join');
        continue;
      }
      heights.set(pc, height);
      const op = m.code[pc * 3],
        a = m.code[pc * 3 + 1],
        b = m.code[pc * 3 + 2];
      let need = 0,
        delta = 0;
      let valueInstruction;
      try {
        valueInstruction = sourceValueInstruction(image, op, a, valueTypes) ?? sourceNullableInstruction(image, op, a, b, valueTypes);
      } catch (error) {
        fail(m, pc, error.message);
        continue;
      }
      if (valueInstruction) {
        need = valueInstruction.need;
        delta = valueInstruction.delta;
      } else {
        const context = {
            image,
            method: m
          },
          memoryEffect = controlStackEffect(op, a, b, context) ?? memoryStackEffect(op, a, b, context);
        if (memoryEffect) {
          ({
            need,
            delta
          } = memoryEffect);
          if (memoryEffect.error) fail(m, pc, memoryEffect.error);
        } else switch (op) {
          case Op.ENUM:
            if (!enumTypes[a]) fail(m, pc, 'Invalid enum type');
            delta = 1;
            break;
          case Op.DELEGATE:
            need = 1;
            if (!image.methods[a] || frameworkType(image.constants[b])?.kind !== 'delegate') fail(m, pc, 'Invalid delegate');
            break;
          case Op.ENDFILTER:
            need = 1;
            delta = -1;
            if (height !== 1 || !m.handlers.some(h => h.filter !== undefined && pc >= h.filter && pc < h.target)) fail(m, pc,
            'Invalid filter exit');
            break;
          case Op.NOP:
            break;
          case Op.ENDFINALLY:
            if (height !== 0) fail(m, pc, 'Finally must have an empty stack');
            break;
          case Op.SEQ:
            if (!image.sequencePoints[a]) fail(m, pc, 'Invalid sequence point');
            break;
          case Op.CONST:
            if (a < 0 || a >= image.constants.length) fail(m, pc, 'Invalid constant');
            delta = 1;
            break;
          case Op.LDLOC:
          case Op.STLOC:
            if (a < 0 || a >= m.locals.length) fail(m, pc, 'Invalid local');
            if (op === Op.LDLOC) delta = 1;
            else need = 1;
            break;
          case Op.LDSTATIC:
          case Op.STSTATIC:
            if (a < 0 || a >= image.statics.length) fail(m, pc, 'Invalid static');
            if (op === Op.LDSTATIC) delta = 1;
            else need = 1;
            break;
          case Op.LDFLD:
            need = 1;
            break;
          case Op.STFLD:
            need = 2;
            delta = -1;
            break;
          case Op.DUP:
            need = 1;
            delta = 1;
            break;
          case Op.POP:
            need = 1;
            delta = -1;
            break;
          case Op.BINARY:
            need = 2;
            delta = -1;
            if (!BinaryName[a]) fail(m, pc, 'Invalid binary operator');
            if (!verifyNumericInstruction('binary', BinaryName[a], b)) fail(m, pc, 'Invalid binary mode');
            break;
          case Op.CONVERT:
            need = 1;
            if (!verifyNumericInstruction('convert', a, b)) fail(m, pc, 'Invalid numeric conversion');
            break;
          case Op.UNARY:
            need = 1;
            if (!verifyNumericInstruction('unary', UnaryName[a], b)) fail(m, pc, 'Invalid unary operator');
            break;
          case Op.JUMP:
            break;
          case Op.JFALSE:
          case Op.JTRUE:
            need = 1;
            delta = -1;
            break;
          case Op.CALL:
            if (!image.methods[a] || image.methods[a].isAbstract) fail(m, pc, 'Invalid method');
            else if (!sourceCallArity(image.methods[a], b)) fail(m, pc, 'Invalid argument count');
            need = b;
            delta = 1 - b;
            break;
          case Op.BUILTIN:
            if (!Builtins[a] || b < Builtins[a].min || b > Builtins[a].max) fail(m, pc, 'Invalid intrinsic');
            need = b;
            delta = 1 - b;
            break;
          case Op.RET:
            need = 1;
            delta = -1;
            if (height !== 1) fail(m, pc, 'Return stack must contain exactly one value');
            break;
          case Op.NEWOBJ:
            if (!image.types[a]) fail(m, pc, 'Invalid managed type');
            delta = 1;
            break;
          case Op.NEWARR:
            if (typeof image.constants[a] !== 'string') fail(m, pc, 'Invalid array element type');
            need = 1;
            break;
          case Op.LDELEM:
            need = 2;
            delta = -1;
            break;
          case Op.STELEM:
            need = 3;
            delta = -2;
            break;
          case Op.LENGTH:
            need = 1;
            break;
          case Op.THROW:
            need = 1;
            delta = -1;
            break;
          case Op.RETHROW:
            break;
          default:
            fail(m, pc, 'Unknown opcode');
            continue;
        }
      }
      if (height < need) {
        fail(m, pc, 'Stack underflow');
        continue;
      }
      peak = Math.max(peak, height, height + delta);
      if (op === Op.RET || op === Op.THROW || op === Op.RETHROW || op === Op.ENDFINALLY || op === Op.ENDFILTER) continue;
      if (op === Op.JUMP || op === Op.JFALSE || op === Op.JTRUE) queue.push([a, height + delta]);
      if (op !== Op.JUMP) queue.push([pc + 1, height + delta]);
    }
    bounds?.push([m, peak]);
  }
  if (errors.length) discardSourceStacks(image);
  else if (bounds) recordSourceStacks(image, bounds);
  return errors;
}

export {
  float,
  floatBinary,
  floatCompare,
  finiteFloat,
  ieeeRemainder,
  int64Binary,
  int64Compare,
  int64Unary,
  uint32Binary,
  uint32Compare,
  convert,
  conversionTargets,
  number,
  isNumber,
  singleToInt32Bits,
  doubleToInt64Bits,
  int32BitsToSingle,
  int64BitsToDouble,
  nativeIntegerBits,
  isNativeInteger,
  nativeInteger,
  nativeBinary,
  nativeSize,
  decimal,
  decimalZero,
  decimalMaxCoefficient,
  isDecimal,
  decimalFromBits,
  decimalBits,
  decimalParse,
  decimalFromInteger,
  decimalFromFloat,
  decimalToInteger,
  decimalToFloat,
  decimalCompare,
  decimalNegate,
  decimalAbs,
  decimalAdd,
  decimalMultiply,
  decimalDivide,
  decimalRemainder,
  decimalRound,
  decimalBinary,
  decimalFormat,
  decimalIntrinsicDefinitions,
  isDecimalConstantField,
  NumericType,
  numericTypeNames,
  numericAliases,
  numericTypeName,
  numericTypeId,
  numericMode,
  decodeNumericMode,
  isNumericMode,
  integerType,
  encodeScalar,
  decodeScalar
}
from './numeric/index.js';
