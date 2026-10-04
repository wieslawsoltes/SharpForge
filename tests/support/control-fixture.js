// Standalone metadata/IL assembler; it deliberately does not use the C# compiler.
import {MetadataBuilder,Writer,CilWriter,methodSignature,localSignature,fieldSignature,codedIndex,token,writePE,TEXT_RVA} from '@sharpforge/cil';
export function controlFixture(types,{name='ControlFixture',entry='Program.Main',decorate}={}) {
  const md=new MetadataBuilder(name),typeTokens=new Map(types.map((type,index)=>[type.name,token(2,index+2)])),methods=new Map(),fields=new Map();
  const resolve=name=>typeTokens.get(name)??md.typeRef(name),object=resolve('System.Object');
  md.add(2,[0,md.string('<Module>'),0,0,1,1]);let methodRow=1,fieldRow=1;
  const context={md,types:typeTokens,methods,fields,resolve,
    member:(owner,name,result,parameters=[],isStatic=true)=>md.member(typeof owner==='number'?owner:resolve(owner),name,methodSignature(result,parameters,isStatic,resolve)),
    signature:(result,parameters=[],isStatic=true)=>methodSignature(result,parameters,isStatic,resolve),
    typeSpec:bytes=>md.add(27,[md.blob(bytes)]),
    methodSpec:(method,arguments_)=>md.add(43,[codedIndex('MethodDefOrRef',method),md.blob(new Writer().u8(0x0a).compressed(arguments_.length).bytes(arguments_.flat()).finish())])};
  for(const type of types) {
    const base=typeof type.base==='function'?type.base(context):resolve(type.base??'System.Object');
    md.add(2,[type.flags??0x100001,md.string(type.name),0,type.interface?0:codedIndex('TypeDefOrRef',base),fieldRow,methodRow]);
    for(const field of type.fields??[])fields.set(type.name+'.'+field.name,token(4,fieldRow++));
    for(const method of type.methods)methods.set(type.name+'.'+method.name,token(6,methodRow++));
  }
  const definitions=[];
  for(const type of types) {
    for(const field of type.fields??[])md.add(4,[field.flags??0x16,md.string(field.name),md.blob(field.signature??fieldSignature(field.type??'int',resolve))]);
    for(const [index,parameter] of (type.genericParameters??[]).entries())md.add(42,[index,parameter.flags??0,codedIndex('TypeOrMethodDef',typeTokens.get(type.name)),md.string(parameter.name??'T'+index)]);
    for(const method of type.methods) {
      const parameters=method.parameters??[],start=(md.rows[8]?.length??0)+1;
      parameters.forEach((_,index)=>md.add(8,[method.parameterFlags?.[index]??0,index+1,md.string('arg'+index)]));
      const methodToken=methods.get(type.name+'.'+method.name),signature=typeof method.signature==='function'?method.signature(context):method.signature??methodSignature(method.result??'void',parameters,method.static!==false,resolve);
      md.add(6,[0,method.implFlags??0,method.flags??(method.static===false?0x86:0x96),md.string(method.name),md.blob(signature),start]);
      for(const [index,parameter] of (method.genericParameters??[]).entries())md.add(42,[index,parameter.flags??0,codedIndex('TypeOrMethodDef',methodToken),md.string(parameter.name??'T'+index)]);
      definitions.push({...method,token:methodToken});
    }
    for(const iface of type.interfaces??[])md.add(9,[typeTokens.get(type.name)&0xffffff,codedIndex('TypeDefOrRef',typeof iface==='function'?iface(context):resolve(iface))]);
  }
  const section=new Writer().zero(72);
  for(const method of definitions) {
    if(!method.body)continue;
    const writer=new CilWriter();writer.label=writer.mark.bind(writer);method.body(writer,context);const code=writer.finish(),handlers=method.handlers?.(writer.labels,context)??[];
    const localBytes=(typeof method.localBytes==='function'?method.localBytes(context):method.localBytes)??(method.locals?.length?localSignature(method.locals,resolve):null),locals=localBytes?md.add(17,[md.blob(localBytes)]):0;
    section.pad(4);md.rows[6][(method.token&0xffffff)-1][0]=TEXT_RVA+section.length;
    section.u16(0x3003|(method.initLocals===false?0:0x10)|(handlers.length?8:0)).u16(method.maxStack??16).u32(code.length).u32(locals).bytes(code);
    if(handlers.length){section.pad(4);const size=4+handlers.length*24;section.u8(0x41).u8(size).u8(size>>>8).u8(size>>>16);for(const handler of handlers)section.u32(handler.flags??0).u32(handler.start).u32(handler.end-handler.start).u32(handler.target).u32(handler.handlerEnd-handler.target).u32(handler.catchType??0);}
  }
  decorate?.(context);section.pad(4);const offset=section.length,metadata=md.finish(undefined,new Uint8Array([0xa0,5,2]));section.bytes(metadata);
  return writePE(section.finish(),offset,metadata.length,entry===null?0:methods.get(entry));
}
export const genericInstance=(type,args)=>new Writer().u8(0x15).u8(0x12).compressed(codedIndex('TypeDefOrRef',type)).compressed(args.length).bytes(args.flat()).finish();
