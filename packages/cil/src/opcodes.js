import { Reader, Writer, CilError } from './binary.js';
/** ECMA-335 opcode numbers. Only the explicitly supported safe managed profile is executable. */
// Numeric values and operand encodings follow ECMA-335 III, not an execution allowlist.
const rows = [];
function group(start, names, operand='') {
  names.split(' ').forEach((name,index)=>{if(name!=='-')rows.push([name,start+index,operand]);});
}
group(0x00,'nop break ldarg.0 ldarg.1 ldarg.2 ldarg.3 ldloc.0 ldloc.1 ldloc.2 ldloc.3 stloc.0 stloc.1 stloc.2 stloc.3');
group(0x0e,'ldarg.s ldarga.s starg.s ldloc.s ldloca.s stloc.s','u8');
group(0x14,'ldnull ldc.i4.m1 ldc.i4.0 ldc.i4.1 ldc.i4.2 ldc.i4.3 ldc.i4.4 ldc.i4.5 ldc.i4.6 ldc.i4.7 ldc.i4.8');
rows.push(['ldc.i4.s',0x1f,'i8'],['ldc.i4',0x20,'i32'],['ldc.i8',0x21,'i64'],['ldc.r4',0x22,'f32'],['ldc.r8',0x23,'f64']);
group(0x25,'dup pop');group(0x27,'jmp call calli','token');group(0x2a,'ret');
group(0x2b,'br.s brfalse.s brtrue.s beq.s bge.s bgt.s ble.s blt.s bne.un.s bge.un.s bgt.un.s ble.un.s blt.un.s','br8');
group(0x38,'br brfalse brtrue beq bge bgt ble blt bne.un bge.un bgt.un ble.un blt.un','br32');
rows.push(['switch',0x45,'switch']);
group(0x46,'ldind.i1 ldind.u1 ldind.i2 ldind.u2 ldind.i4 ldind.u4 ldind.i8 ldind.i ldind.r4 ldind.r8 ldind.ref stind.ref stind.i1 stind.i2 stind.i4 stind.i8 stind.r4 stind.r8 add sub mul div div.un rem rem.un and or xor shl shr shr.un neg not conv.i1 conv.i2 conv.i4 conv.i8 conv.r4 conv.r8 conv.u4 conv.u8');
group(0x6f,'callvirt cpobj ldobj ldstr newobj castclass isinst','token');group(0x76,'conv.r.un');group(0x79,'unbox','token');group(0x7a,'throw');
group(0x7b,'ldfld ldflda stfld ldsfld ldsflda stsfld stobj','token');
group(0x82,'conv.ovf.i1.un conv.ovf.i2.un conv.ovf.i4.un conv.ovf.i8.un conv.ovf.u1.un conv.ovf.u2.un conv.ovf.u4.un conv.ovf.u8.un conv.ovf.i.un conv.ovf.u.un');
group(0x8c,'box newarr','token');group(0x8e,'ldlen');group(0x8f,'ldelema','token');
group(0x90,'ldelem.i1 ldelem.u1 ldelem.i2 ldelem.u2 ldelem.i4 ldelem.u4 ldelem.i8 ldelem.i ldelem.r4 ldelem.r8 ldelem.ref stelem.i stelem.i1 stelem.i2 stelem.i4 stelem.i8 stelem.r4 stelem.r8 stelem.ref');
group(0xa3,'ldelem stelem unbox.any','token');group(0xb3,'conv.ovf.i1 conv.ovf.u1 conv.ovf.i2 conv.ovf.u2 conv.ovf.i4 conv.ovf.u4 conv.ovf.i8 conv.ovf.u8');
group(0xc2,'refanyval','token');group(0xc3,'ckfinite');group(0xc6,'mkrefany','token');group(0xd0,'ldtoken','token');
group(0xd1,'conv.u2 conv.u1 conv.i conv.ovf.i conv.ovf.u add.ovf add.ovf.un mul.ovf mul.ovf.un sub.ovf sub.ovf.un endfinally');
rows.push(['leave',0xdd,'br32'],['leave.s',0xde,'br8']);group(0xdf,'stind.i conv.u');
group(0xfe00,'arglist ceq cgt cgt.un clt clt.un');group(0xfe06,'ldftn ldvirtftn','token');
group(0xfe09,'ldarg ldarga starg ldloc ldloca stloc','u16');group(0xfe0f,'localloc');group(0xfe11,'endfilter');
rows.push(['unaligned.',0xfe12,'u8']);group(0xfe13,'volatile. tail.');group(0xfe15,'initobj constrained.','token');group(0xfe17,'cpblk initblk');
rows.push(['no.',0xfe19,'u8']);group(0xfe1a,'rethrow');group(0xfe1c,'sizeof','token');group(0xfe1d,'refanytype readonly.');
export const CilOpcodes = Object.freeze(Object.fromEntries(rows.map(([name,value,operand])=>[name,Object.freeze({name,value,operand})])));
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
