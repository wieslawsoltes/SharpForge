import {Writer,codedIndex,token,methodSignature} from '@sharpforge/cil';
import {managedFixture} from './managed-fixtures.js';

/** Independent enum TypeDef, value__ storage, literal Constant rows, and FlagsAttribute. */
export function enumFixture({underlying='int',members=[['None',0],['A',1],['B',2]],flags=false,body,result='void',locals=[]}={}) {
  const enumToken=token(2,3),element={sbyte:4,byte:5,short:6,ushort:7,int:8,uint:9,long:10,ulong:11}[underlying];
  return managedFixture({methods:[{name:'Main',result,locals,body:(w,c)=>body(w,{...c,enumToken})}],decorate:({md})=>{
    md.add(2,[0x101,md.string('Choice'),md.string('Fixture'),codedIndex('TypeDefOrRef',md.typeRef('System.Enum')),1,2]);
    md.add(4,[0x606,md.string('value__'),md.blob(new Writer().u8(6).u8(element).finish())]);
    for(const [name,value] of members) {
      const field=md.add(4,[0x8056,md.string(name),md.blob(new Writer().u8(6).u8(0x11).compressed(codedIndex('TypeDefOrRef',enumToken)).finish())]);
      const bytes=new Writer(),bits={sbyte:8,byte:8,short:16,ushort:16,int:32,uint:32,long:64,ulong:64}[underlying];
      let raw=BigInt.asUintN(bits,BigInt(value));for(let i=0;i<bits/8;i++){bytes.u8(Number(raw&255n));raw>>=8n;}
      md.add(11,[element,codedIndex('HasConstant',field),md.blob(bytes.finish())]);
    }
    if(flags){const ctor=md.member(md.typeRef('System.FlagsAttribute'),'.ctor',methodSignature('void',[],false,name=>md.typeRef(name)));md.add(12,[codedIndex('HasCustomAttribute',enumToken),codedIndex('CustomAttributeType',ctor),md.blob(new Uint8Array([1,0,0,0]))]);}
  }});
}
