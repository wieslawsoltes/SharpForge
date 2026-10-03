import {MetadataBuilder,Writer,CilWriter,signatureType,codedIndex,writePE,TEXT_RVA} from '@sharpforge/cil';

/** ARRAY signatures and pseudo-method MemberRefs, independent of the source emitter. */
export function arrayFixture(body) {
  const md=new MetadataBuilder('ManagedArrays');
  const type=(w,name)=>{
    if(name.endsWith('&'))return type(w.u8(0x10),name.slice(0,-1));
    if(name==='int[,]')return w.u8(0x14).u8(8).compressed(2).compressed(0).compressed(0);
    return signatureType(w,name,name=>md.typeRef(name));
  };
  const signature=(result,parameters=[],instance=false)=>{const w=new Writer().u8(instance?0x20:0).compressed(parameters.length);type(w,result);parameters.forEach(parameter=>type(w,parameter));return w.finish();};
  const array=md.add(27,[md.blob(type(new Writer(),'int[,]').finish())]);
  const member=(name,result,parameters)=>md.member(array,name,signature(result,parameters,true));
  const context={ctor:member('.ctor','void',['int','int']),boundedCtor:member('.ctor','void',['int','int','int','int']),get:member('Get','int',['int','int']),set:member('Set','void',['int','int','int']),address:member('Address','int&',['int','int']),collect:md.member(md.typeRef('System.GC'),'Collect',signature('void'))};
  md.add(2,[0,md.string('<Module>'),0,0,1,1]);
  md.add(2,[0x100181,md.string('Program'),md.string('Fixture'),codedIndex('TypeDefOrRef',md.typeRef('System.Object')),1,1]);
  const method=md.add(6,[0,0,0x96,md.string('Main'),md.blob(signature('int')),1]);
  const locals=new Writer().u8(7).compressed(2);type(locals,'int[,]');type(locals,'int&');
  const localToken=md.add(17,[md.blob(locals.finish())]),il=new CilWriter();body(il,context);const bytes=il.finish();
  const section=new Writer().zero(72).pad(4);md.rows[6][0][0]=TEXT_RVA+section.length;
  section.u16(0x3013).u16(8).u32(bytes.length).u32(localToken).bytes(bytes).pad(4);
  const offset=section.length,metadata=md.finish(undefined,new Uint8Array([5,7,8]));section.bytes(metadata);
  return writePE(section.finish(),offset,metadata.length,method);
}
