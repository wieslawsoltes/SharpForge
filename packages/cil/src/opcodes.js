import { Reader, Writer, CilError } from './binary.js';
import { CilOpcodes } from './opcodes/catalog.js';
export { CilOpcodes } from './opcodes/catalog.js';
const byValue = new Map(Object.values(CilOpcodes).map(op=>[op.value,op]));
export class CilWriter extends Writer {
  constructor(capacity){super(capacity);this.labels=new Map();this.fixups=[];}
  mark(name){if(typeof name!=='string'||!name||this.labels.has(name))throw new CilError('Duplicate or invalid IL label');this.labels.set(name,this.length);return this;}
  finish(){for(const fixup of this.fixups){if(!this.labels.has(fixup.label))throw new CilError(`Undefined IL label '${fixup.label}'`);const delta=this.labels.get(fixup.label)-fixup.base;if(fixup.size===1){if(delta< -128||delta>127)throw new CilError('Short branch displacement out of range');this.view.setInt8(fixup.at,delta);}else this.patch32(fixup.at,delta);}return super.finish();}

  op(name, operand) { const op = CilOpcodes[name]; if (!op) throw new CilError(`Unsupported CIL opcode ${name}`); if (op.value > 255) this.u8(0xfe).u8(op.value & 255); else this.u8(op.value); if(op.operand.startsWith('br')&&typeof operand==='string'){const size=op.operand==='br8'?1:4;this.fixups.push({at:this.length,base:this.length+size,size,label:operand});operand=0;} switch (op.operand) { case 'u8': case 'i8': case 'br8': this.u8(operand); break; case 'u16': this.u16(operand); break; case 'i32': case 'token': case 'br32': this.u32(operand); break; case 'f32': this.f32(operand); break; case 'f64': this.f64(operand); break; case 'i64': this.i64(operand); break; case 'switch': {const base=this.length+4+operand.length*4;this.u32(operand.length);for(const target of operand){if(typeof target==='string'){this.fixups.push({at:this.length,base,size:4,label:target});this.u32(0);}else this.u32(target);}break;} } return this; }
  local(name, index) { if (!Number.isInteger(index) || index < 0 || index > 65535) throw new CilError('Local index exceeds CLI limit'); return this.op(name, index); }
  integer(value) { return this.op('ldc.i4', value); }
}
export function decodeInstructions(bytes,{maxInstructions=1_000_000}={}) {
  const r = new Reader(bytes), result = [];
  while (r.position < r.end) { if(result.length>=maxInstructions)throw new CilError('IL instruction limit exceeded'); const offset = r.position; let value = r.u8(); if (value === 0xfe) value = 0xfe00 | r.u8(); const op = byValue.get(value); if (!op) throw new CilError(`Unsupported CIL opcode 0x${value.toString(16)}`,offset); let operand;
    switch (op.operand) { case 'u8': operand=r.u8(); break; case 'i8': operand=(r.u8()<<24)>>24; break; case 'u16': operand=r.u16(); break; case 'i32': operand=r.i32(); break; case 'f32': operand=r.f32(); break; case 'f64': operand=r.f64(); break; case 'i64': operand=r.i64(); break; case 'switch': {const count=r.u32(); if(count>1_000_000||count>(r.end-r.position)/4)throw new CilError('Invalid switch table',offset);const end=r.position+count*4;operand=Array.from({length:count},()=>r.i32()+end);break;} case 'token': operand=r.u32(); break; case 'br32': operand=r.i32()+r.position; break; case 'br8': operand=((r.u8()<<24)>>24)+r.position; break; }
    result.push({offset, size:r.position-offset, name:op.name, operand, operandKind:op.operand});
  }
  const starts = new Set(result.map(i=>i.offset)); for (const i of result) for(const target of i.operandKind==='switch'?i.operand:i.operandKind.startsWith('br')?[i.operand]:[])if(!starts.has(target))throw new CilError('Branch target is not an instruction boundary',i.offset);
  return result;
}
