// Independently authored CIL fixtures: no C# compiler, emitter or #SF profile is used.
import { MetadataBuilder, Writer, CilWriter, methodSignature, localSignature, fieldSignature, codedIndex, token, writePE, TEXT_RVA } from '@sharpforge/cil';
export function managedFixture({name='ManagedFixture',methods=[{name:'Main',result:'int',body:w=>w.op('ldc.i4',42).op('ret')}],fields=[],entry=0,decorate}={}){
  const md=new MetadataBuilder(name),resolve=t=>t==='Fixture.Program'?token(2,2):md.typeRef(t==='Exception'?'System.Exception':t),object=md.typeRef('System.Object');
  md.add(2,[0,md.string('<Module>'),0,0,1,1]);const type=md.add(2,[0x100001,md.string('Program'),md.string('Fixture'),codedIndex('TypeDefOrRef',object),1,1]);
  const ft={};for(const field of fields)ft[field.name]=md.add(4,[field.static===false?6:0x16,md.string(field.name),md.blob(fieldSignature(field.type??'int',resolve))]);
  const mt={};for(const method of methods){const paramStart=(md.rows[8]?.length??0)+1;for(let i=0;i<(method.parameters?.length??0);i++)md.add(8,[0,i+1,md.string('arg'+i)]);mt[method.name]=md.add(6,[0,0,method.flags??(method.static===false?0x86:0x96),md.string(method.name),md.blob(method.signature??methodSignature(method.result??'void',method.parameters??[],method.static!==false,resolve)),paramStart]);}
  const member=(owner,name,result,parameters=[],isStatic=true)=>md.member(md.typeRef(owner),name,methodSignature(result,parameters,isStatic,resolve));
  const context={md,methods:mt,fields:ft,type,member,resolve};const section=new Writer().zero(72);
  methods.forEach((method,index)=>{if(method.noBody)return;const w=new CilWriter();method.body(w,context);const code=w.finish(),handlers=method.handlers?.(w.labels,context)??[],locals=method.locals?.length?md.add(17,[md.blob(localSignature(method.locals,resolve))]):0;
    section.pad(4);md.rows[6][index][0]=TEXT_RVA+section.length;
    section.u16(0x3003|(method.initLocals===false?0:0x10)|(handlers.length?8:0)).u16(method.maxStack??8).u32(code.length).u32(locals).bytes(code);
    if(handlers.length){section.pad(4);const size=4+handlers.length*24;section.u8(0x41).u8(size).u8(size>>>8).u8(size>>>16);for(const h of handlers)section.u32(h.flags??0).u32(h.start).u32(h.end-h.start).u32(h.target).u32(h.handlerEnd-h.target).u32(h.catchType??0);}
  });decorate?.(context);section.pad(4);const offset=section.length,metadata=md.finish(undefined,new Uint8Array([7,3,1]));section.bytes(metadata);return writePE(section.finish(),offset,metadata.length,entry===null?0:token(6,entry+1));
}
export function arithmeticLibrary(){return managedFixture({name:'Arithmetic',entry:null,methods:[{name:'Add',parameters:['int','int'],result:'int',body:w=>w.op('ldarg.0').op('ldarg.1').op('add').op('ret')},{name:'Square',parameters:['int'],result:'int',body:w=>w.op('ldarg.0').op('ldarg.0').op('mul').op('ret')},{name:'Hello',result:'void',body:(w,c)=>w.op('ldstr',0x70000000+c.md.userString('Hello from ordinary CIL')).op('call',c.member('System.Console','WriteLine','void',['string'])).op('ret')}]});}
