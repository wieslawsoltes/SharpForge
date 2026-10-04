import {Op, Builtins} from '@sharpforge/bytecode';
import {CilError} from './binary.js';
import {arrayElementType, spanElementType, valueTypeName} from './source-memory-types.js';

/** The compiler always puts a bridge's closed type literal immediately before its call. */
export function sourceMemoryTypeArgument(image, method, pc) {
  if (pc < 1 || method.code[(pc - 1) * 3] !== Op.CONST) throw new CilError('Missing memory bridge type literal');
  const type = image.constants[method.code[(pc - 1) * 3 + 1]];
  if (typeof type !== 'string') throw new CilError('Invalid memory bridge type literal');
  return type;
}

export function transferSourceMemory({op, a, b, stack, pop, image, method, pc, typeMap}) {
  switch (op) {
    case Op.ADDRESS: {
      const kind = a & 255;
      let type;
      if (kind <= 1) type = method.locals[b]?.type;
      else if (kind === 2) type = image.statics[b]?.type;
      else if (kind === 3) { pop(); pop(); type = image.constants[b]; }
      else if (kind === 4) type = typeMap.get(valueTypeName(pop()))?.fields[b]?.type;
      else if (kind === 5) { stack.push(pop()); return true; }
      if (!type) throw new CilError('Invalid managed address target type');
      stack.push(type + '&'); break;
    }
    case Op.LDIND: pop(); stack.push(image.constants[a]); break;
    case Op.STIND: pop(); pop(); stack.push(image.constants[a]); break;
    case Op.NEWRECT:
      for (let index = 0; index < b; index++) pop();
      stack.push(image.constants[a] + '[' + ','.repeat(b - 1) + ']'); break;
    case Op.STRECT: pop();
      // fall through
    case Op.LDRECT: case Op.RECTADDR: {
      for (let index = 0; index < a; index++) pop();
      stack.push(arrayElementType(pop()) + (op === Op.RECTADDR ? '&' : '')); break;
    }
    case Op.STACKALLOC: pop(); stack.push('System.Span<' + image.constants[a] + '>'); break;
    case Op.SPANSET: pop();
      // fall through
    case Op.SPANGET: case Op.SPANADDR:
      pop(); stack.push(spanElementType(pop()) + (op === Op.SPANADDR ? '&' : '')); break;
    case Op.SPANSLICE: {
      for (let index = 0; index < b; index++) pop();
      stack.push(valueTypeName(pop())); break;
    }
    case Op.SPANLENGTH: pop(); stack.push('int'); break;
    case Op.SPANREADONLY: stack.push('System.ReadOnlySpan<' + spanElementType(pop()) + '>'); break;
    case Op.SPANDEFAULT: stack.push(image.constants[a]); break;
    case Op.BUILTIN: {
      const operation = Builtins[a]?.arrayRuntime?.operation;
      if (!['typeOf', 'cast', 'spanFromArray', 'spanFromString', 'spanToArray'].includes(operation)) return false;
      const args = stack.splice(stack.length - b, b);
      stack.push(operation === 'typeOf' ? 'System.Type' : operation === 'spanToArray'
        ? spanElementType(args[0]) + '[]' : sourceMemoryTypeArgument(image, method, pc));
      break;
    }
    default: return false;
  }
  return true;
}
