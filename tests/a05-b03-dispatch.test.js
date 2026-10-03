import test from 'node:test';
import assert from 'node:assert/strict';
import {MetadataBuilder,Writer,CilWriter,methodSignature,localSignature,codedIndex,token,writePE,TEXT_RVA,verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';

// Independent metadata builder: explicit slots and MethodImpl rows cannot be expressed
// by the in-repository C# compiler's current virtual-method surface.
function fixture(classes,main,{methodImpl=[],interfaces=[],memberRef=false}={}) {
  const md=new MetadataBuilder('VirtualDispatch'),typeTokens=new Map(classes.map((type,index)=>[type.name,token(2,index+2)]));
  const object=md.typeRef('System.Object'),resolve=name=>typeTokens.get(name)??md.typeRef(name),methods=new Map();
  md.add(2,[0,md.string('<Module>'),0,0,1,1]);let nextMethod=1;
  for(const type of classes) {
    md.add(2,[type.flags??0x100001,md.string(type.name),0,type.interface?0:codedIndex('TypeDefOrRef',type.base?resolve(type.base):object),1,nextMethod]);
    for(const method of type.methods)methods.set(type.name+'::'+method.name,token(6,nextMethod++));
  }
  const program=md.add(2,[0x100001,md.string('Program'),0,codedIndex('TypeDefOrRef',object),1,nextMethod]);
  const entry=token(6,nextMethod),definitions=[];
  for(const type of classes)for(const method of type.methods)definitions.push({...method,owner:type.name,token:methods.get(type.name+'::'+method.name)});
  definitions.push({name:'Main',owner:'Program',token:entry,flags:0x96,result:'int',locals:['object'],body:main});
  for(const method of definitions)md.add(6,[0,0,method.flags??0x1c6,md.string(method.name),md.blob(methodSignature(method.result??'int',method.parameters??[],!!(method.flags&0x10),resolve)),1]);
  const methodRef=name=>{
    const definition=definitions.find(method=>method.owner+'::'+method.name===name);
    return memberRef?md.member(resolve(definition.owner),definition.name,methodSignature(definition.result??'int',definition.parameters??[],false,resolve)):methods.get(name);
  };
  const context={md,types:typeTokens,methods,methodRef,objectCtor:()=>md.member(object,'.ctor',methodSignature('void',[],false,resolve))};
  const section=new Writer().zero(72);
  for(const method of definitions) {
    if(!method.body)continue;
    const writer=new CilWriter();method.body(writer,context);const code=writer.finish(),locals=method.locals?md.add(17,[md.blob(localSignature(method.locals,resolve))]):0;
    section.pad(4);md.rows[6][(method.token&0xffffff)-1][0]=TEXT_RVA+section.length;
    section.u16(0x3013).u16(8).u32(code.length).u32(locals).bytes(code);
  }
  for(const [owner,iface] of interfaces)md.add(9,[resolve(owner)&0xffffff,codedIndex('TypeDefOrRef',resolve(iface))]);
  for(const [owner,body,declaration] of methodImpl)md.add(25,[resolve(owner)&0xffffff,codedIndex('MethodDefOrRef',methods.get(body)),codedIndex('MethodDefOrRef',methods.get(declaration))]);
  section.pad(4);const offset=section.length,metadata=md.finish(undefined,new Uint8Array([3,7,0]));section.bytes(metadata);
  return writePE(section.finish(),offset,metadata.length,entry);
}
const ctor=base=>({name:'.ctor',result:'void',flags:0x1886,body:(w,c)=>w.op('ldarg.0').op('call',base?c.methods.get(base+'::.ctor'):c.objectCtor()).op('ret')});
const constant=(name,value,flags=0x1c6)=>({name,flags,body:w=>w.op('ldc.i4',value).op('ret')});
const invoke=(type,method)=>(w,c)=>w.op('newobj',c.methods.get(type+'::.ctor')).op('callvirt',c.methodRef(method)).op('ret');
const run=bytes=>{const result=new CilVirtualMachine(bytes).run();assert.equal(result.state,'terminated',result.fault?.stack);return result.returnValue;};

for(const memberRef of [false,true])test(`A05 B03 newslot preserves base declaration through ${memberRef?'MemberRef':'MethodDef'}`,()=>{
  const bytes=fixture([
    {name:'A',methods:[ctor(),constant('F',1)]},
    {name:'B',base:'A',methods:[ctor('A'),constant('F',2)]},
    {name:'C',base:'B',methods:[ctor('B'),constant('F',3,0xc6)]}
  ],(w,c)=>w.op('newobj',c.methods.get('C::.ctor')).op('stloc.0')
    .op('ldloc.0').op('callvirt',c.methodRef('A::F')).op('ldc.i4',10).op('mul')
    .op('ldloc.0').op('callvirt',c.methodRef('B::F')).op('add').op('ret'),{memberRef});
  assert.equal(run(bytes),13);
});
test('A05 B03 nonvirtual hiding cannot override the base virtual slot',()=>{
  const bytes=fixture([{name:'A',methods:[ctor(),constant('F',1)]},{name:'B',base:'A',methods:[ctor('A'),constant('F',2,0x86)]}],invoke('B','A::F'));
  assert.equal(run(bytes),1);
});
test('A05 B03 verifier qualifies reachable reuse-slot overrides',()=>{
  const bytes=fixture([{name:'A',methods:[ctor(),constant('F',1)]},{name:'B',base:'A',methods:[ctor('A'),constant('F',2,0xc6)]}],invoke('B','A::F'));
  const report=verifyCilAssembly(bytes);assert(report.success,JSON.stringify(report.issues));assert(report.methods.includes(token(6,4)));assert.equal(run(bytes),2);
});
test('A05 B03 explicit class MethodImpl can use a differently named body',()=>{
  const bytes=fixture([{name:'A',methods:[ctor(),constant('F',1)]},{name:'B',base:'A',methods:[ctor('A'),constant('Different',9)]}],invoke('B','A::F'),{methodImpl:[['B','B::Different','A::F']]});
  assert.equal(run(bytes),9);
});
test('A05 B03 explicit interface MethodImpl dispatches without executing an abstract declaration',()=>{
  const bytes=fixture([
    {name:'I',interface:true,flags:0xa1,methods:[{name:'F',flags:0x5c6}]},
    {name:'C',methods:[ctor(),constant('Different',7,0x1e1)]}
  ],invoke('C','I::F'),{interfaces:[['C','I']],methodImpl:[['C','C::Different','I::F']]});
  assert.equal(run(bytes),7);
});
test('A05 B03 invalid MethodImpl signatures and duplicate slots fail verification',()=>{
  for(const mismatch of [true,false]) {
    const body=mismatch?{name:'Different',flags:0x1c6,result:'long',body:w=>w.op('ldc.i8',9n).op('ret')}:constant('Different',9);
    const row=['B','B::Different','A::F'];
    const bytes=fixture([{name:'A',methods:[ctor(),constant('F',1)]},{name:'B',base:'A',methods:[ctor('A'),body]}],invoke('B','A::F'),{methodImpl:mismatch?[row]:[row,row]});
    const report=verifyCilAssembly(bytes);assert.equal(report.success,false);assert.match(JSON.stringify(report.issues),/MethodImpl/);
    assert.throws(()=>new CilVirtualMachine(bytes),/verification failed/);
  }
});
test('A05 B03 a final class virtual slot cannot be overridden',()=>{
  const bytes=fixture([{name:'A',methods:[ctor(),constant('F',1,0x1e6)]},{name:'B',base:'A',methods:[ctor('A'),constant('F',2,0xc6)]}],invoke('B','A::F'));
  const report=verifyCilAssembly(bytes);assert.equal(report.success,false);assert.match(JSON.stringify(report.issues),/final virtual/);
});
test('A05 B03 inherited interface mapping follows overrides without merging independent class slots',()=>{
  const bytes=fixture([
    {name:'I',interface:true,flags:0xa1,methods:[{name:'F',flags:0x5c6}]},
    {name:'A',methods:[ctor(),constant('F',1)]},
    {name:'B',base:'A',methods:[ctor('A'),constant('F',2,0xc6)]}
  ],invoke('B','I::F'),{interfaces:[['A','I']]});
  assert.equal(run(bytes),2);
});
