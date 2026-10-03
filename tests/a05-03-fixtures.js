import {MetadataBuilder,Writer,CilWriter,signatureType,codedIndex,token,writePE,TEXT_RVA} from '@sharpforge/cil';

/** Independent CLI value-type signatures, including nested structs and byrefs. */
export function valueFixture(methods) {
  const md=new MetadataBuilder('ManagedValues'),inner=token(2,3),outer=token(2,4);
  const resolve=name=>name==='Fixture.Inner'?inner:name==='Fixture.Outer'?outer:md.typeRef(name);
  const type=(writer,name)=>{
    if(name.endsWith('&'))return type(writer.u8(0x10),name.slice(0,-1));
    if(['Fixture.Inner','Fixture.Outer'].includes(name))return writer.u8(0x11).compressed(codedIndex('TypeDefOrRef',resolve(name)));
    return signatureType(writer,name,resolve);
  };
  const signature=(result,parameters=[])=>{const w=new Writer().u8(0).compressed(parameters.length);type(w,result);parameters.forEach(name=>type(w,name));return w.finish();};
  const field=name=>type(new Writer().u8(6),name).finish();
  md.add(2,[0,md.string('<Module>'),0,0,1,1]);
  md.add(2,[0x100181,md.string('Program'),md.string('Fixture'),codedIndex('TypeDefOrRef',resolve('System.Object')),1,1]);
  md.add(2,[0x100109,md.string('Inner'),md.string('Fixture'),codedIndex('TypeDefOrRef',resolve('System.ValueType')),1,methods.length+1]);
  md.add(2,[0x100109,md.string('Outer'),md.string('Fixture'),codedIndex('TypeDefOrRef',resolve('System.ValueType')),3,methods.length+1]);
  const number=md.add(4,[6,md.string('Number'),md.blob(field('int'))]);
  const text=md.add(4,[6,md.string('Text'),md.blob(field('string'))]);
  const nested=md.add(4,[6,md.string('Value'),md.blob(field('Fixture.Inner'))]);
  const tokens={};for(const method of methods)tokens[method.name]=md.add(6,[0,0,0x96,md.string(method.name),md.blob(signature(method.result??'void',method.parameters)),1]);
  const context={md,inner,outer,number,text,nested,methods:tokens,resolve,member:(owner,name,result,parameters=[])=>md.member(resolve(owner),name,signature(result,parameters))};
  const section=new Writer().zero(72);
  methods.forEach((method,index)=>{
    const w=new CilWriter();method.body(w,context);const bytes=w.finish();let locals=0;
    if(method.locals?.length){const local=new Writer().u8(7).compressed(method.locals.length);method.locals.forEach(name=>type(local,name));locals=md.add(17,[md.blob(local.finish())]);}
    section.pad(4);md.rows[6][index][0]=TEXT_RVA+section.length;
    section.u16(0x3013).u16(16).u32(bytes.length).u32(locals).bytes(bytes);
  });
  section.pad(4);const offset=section.length,metadata=md.finish(undefined,new Uint8Array([3,7,6]));section.bytes(metadata);
  return writePE(section.finish(),offset,metadata.length,tokens[methods[0].name]);
}
