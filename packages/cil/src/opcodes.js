import { Reader, CilError } from './binary.js';
import { CilOpcodes } from './opcodes/catalog.js';
export { CilOpcodes } from './opcodes/catalog.js';
const byValue = new Map(Object.values(CilOpcodes).map(op=>[op.value,op]));
export { CilWriter } from './opcodes/writer.js';
export function decodeInstructions(bytes,{maxInstructions=1_000_000}={}) {
  const r = new Reader(bytes), result = [];
  while (r.position < r.end) { if(result.length>=maxInstructions)throw new CilError('IL instruction limit exceeded'); const offset = r.position; let value = r.u8(); if (value === 0xfe) value = 0xfe00 | r.u8(); const op = byValue.get(value); if (!op) throw new CilError(`Unsupported CIL opcode 0x${value.toString(16)}`,offset); let operand;
    switch (op.operand) { case 'u8': operand=r.u8(); break; case 'i8': operand=(r.u8()<<24)>>24; break; case 'u16': operand=r.u16(); break; case 'i32': operand=r.i32(); break; case 'f32': operand=r.f32(); break; case 'f64': operand=r.f64(); break; case 'i64': operand=r.i64(); break; case 'switch': {const count=r.u32(); if(count>1_000_000||count>(r.end-r.position)/4)throw new CilError('Invalid switch table',offset);const end=r.position+count*4;operand=Array.from({length:count},()=>r.i32()+end);break;} case 'token': operand=r.u32(); break; case 'br32': operand=r.i32()+r.position; break; case 'br8': operand=((r.u8()<<24)>>24)+r.position; break; }
    result.push({offset, size:r.position-offset, name:op.name, operand, operandKind:op.operand});
  }
  const starts = new Set(result.map(i=>i.offset)); for (const i of result) for(const target of i.operandKind==='switch'?i.operand:i.operandKind.startsWith('br')?[i.operand]:[])if(!starts.has(target))throw new CilError('Branch target is not an instruction boundary',i.offset);
  return result;
}
