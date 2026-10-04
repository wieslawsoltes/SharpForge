import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { extractNative,bclMetadata,winuiMetadata,diagnosticMetadata } from '../../../scripts/conformance/inventory/native-metadata.js';
import { bclApiDiff,compareMembers } from '../../../scripts/conformance/inventory/bcl-api-diff.js';
import { winuiApiDiff } from '../../../scripts/conformance/inventory/winui-api-diff.js';
import { resolveToolchain } from '../../../scripts/conformance/oracle/toolchain.js';
import { encodeSignature, token } from '@sharpforge/cil';
import { genericCallFixture } from '../../support/generic-call-fixture.js';

const toolchain=await resolveToolchain();
test('native reader retains nested function-pointer conventions, flags, generic arity and vararg boundaries',async()=>{
  const primitive=name=>({kind:'primitive',name}), integer=primitive('int'), voidType=primitive('void');
  const pointer=options=>({kind:'functionPointer',signature:{kind:'method',returnType:voidType,parameters:[integer,integer],...options}});
  const display=(header,generic=0,required=2,result='System.Void')=>`method[header=0x${header};generic=${generic};required=${required}] ${result} *(System.Int32,System.Int32)`;
  // These explicit metadata-only type definitions make modifier tokens independent of reference ordering.
  const cdecl='System.Runtime.CompilerServices.CallConvCdecl', stdcall='System.Runtime.CompilerServices.CallConvStdcall';
  const modifier=(kind,index)=>({kind,token:token(2,index),element:voidType});
  const cases=[
    ['Managed',pointer({}),display('00')],
    ['Unmanaged',pointer({callingConvention:9}),display('09')],
    ['Cdecl',pointer({callingConvention:1}),display('01')],
    ['Stdcall',pointer({callingConvention:2}),display('02')],
    ['Instance',pointer({hasThis:true}),display('20')],
    ['ExplicitThis',pointer({hasThis:true,explicitThis:true}),display('60')],
    ['GenericOne',pointer({genericArity:1}),display('10',1)],
    ['GenericTwo',pointer({genericArity:2}),display('10',2)],
    ['VarargsNone',pointer({callingConvention:5}),display('05')],
    ['VarargsFirst',pointer({callingConvention:5,sentinel:0}),display('05',0,0)],
    ['VarargsMiddle',pointer({callingConvention:5,sentinel:1}),display('05',0,1)],
    ['OptionalCdecl',pointer({callingConvention:9,returnType:modifier('modopt',3)}),display('09',0,2,`System.Void modopt(${cdecl})`)],
    ['OptionalStdcall',pointer({callingConvention:9,returnType:modifier('modopt',4)}),display('09',0,2,`System.Void modopt(${stdcall})`)],
    ['RequiredCdecl',pointer({callingConvention:9,returnType:modifier('modreq',3)}),display('09',0,2,`System.Void modreq(${cdecl})`)],
    ['Nested',pointer({returnType:pointer({callingConvention:9})}),display('00',0,2,display('09'))],
  ];
  const assembly=genericCallFixture([
    {name:'PointerApi',flags:0x100081,methods:cases.map(([name,type])=>({name,static:false,flags:0x5c6,
      signature:encodeSignature({kind:'method',hasThis:true,returnType:voidType,parameters:[type]})}))},
    {name:cdecl,methods:[]},{name:stdcall,methods:[]},
    {name:'Program',methods:[{name:'Main',body:writer=>writer.op('ret')}]},
  ]);
  const directory=await mkdtemp(path.join(os.tmpdir(),'sf-pointer-metadata-')),file=path.join(directory,'Pointers.dll');
  try {
    await writeFile(file,assembly);
    const reference=await extractNative('metadata',[file],{toolchain});
    const methods=reference.rows.filter(row=>row.owner==='PointerApi'&&row.kind==='method');
    assert.equal(methods.length,cases.length);
    for(const [name,,expected] of cases)assert.deepEqual(methods.find(row=>row.name===name).parameters,[expected],name);
    assert.equal(new Set(methods.map(row=>row.parameters[0])).size,cases.length);
    const cdeclMember=methods.find(row=>row.name==='Cdecl');
    const contract={id:1,owner:'PointerApi',name:'Cdecl',isStatic:false,result:'void',parameters:[display('00')]};
    assert.equal(compareMembers({rows:[cdeclMember]},{registryTypes:new Map(),registryContracts:[contract]}).rows[0].status,'missing');
    assert.equal(compareMembers({rows:[cdeclMember]},{registryTypes:new Map(),registryContracts:[{...contract,parameters:[display('01')]}]}).rows[0].status,'implemented');
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('native reader distinguishes SZ arrays, non-SZ rank one and complete general-array shapes',async()=>{
  const integer={kind:'primitive',name:'int'}, voidType={kind:'primitive',name:'void'};
  const array=(rank,sizes=[],lowerBounds=[],element=integer)=>({kind:'array',element,rank,sizes,lowerBounds});
  const vector={kind:'szarray',element:integer};
  const cases=[
    ['Vector',vector,'System.Int32[]'],
    ['GeneralOne',array(1),'System.Int32[*]'],
    ['GeneralTwo',array(2),'System.Int32[,]'],
    ['GeneralThree',array(3),'System.Int32[,,]'],
    ['ExplicitZero',array(1,[],[0]),'System.Int32[rank=1;sizes=();lower=(0)]'],
    ['NegativeLower',array(1,[],[-1]),'System.Int32[rank=1;sizes=();lower=(-1)]'],
    ['ZeroSize',array(1,[0]),'System.Int32[rank=1;sizes=(0);lower=()]'],
    ['KnownSize',array(1,[3]),'System.Int32[rank=1;sizes=(3);lower=()]'],
    ['SizePrefix',array(2,[3]),'System.Int32[rank=2;sizes=(3);lower=()]'],
    ['LowerPrefix',array(2,[],[0]),'System.Int32[rank=2;sizes=();lower=(0)]'],
    ['BothPrefixes',array(2,[3],[0]),'System.Int32[rank=2;sizes=(3);lower=(0)]'],
    ['FullLower',array(2,[3],[0,0]),'System.Int32[rank=2;sizes=(3);lower=(0,0)]'],
    ['FullShape',array(2,[3,4],[-1,2]),'System.Int32[rank=2;sizes=(3,4);lower=(-1,2)]'],
    ['NestedVector',{kind:'szarray',element:array(1)},'System.Int32[*][]'],
    ['NestedGeneral',array(2,[3],[1],vector),'System.Int32[][rank=2;sizes=(3);lower=(1)]'],
  ];
  const assembly=genericCallFixture([
    {name:'ArrayApi',flags:0x100081,methods:cases.map(([name,type])=>({name,static:false,flags:0x5c6,
      signature:encodeSignature({kind:'method',hasThis:true,returnType:voidType,parameters:[type]})}))},
    {name:'Program',methods:[{name:'Main',body:writer=>writer.op('ret')}]},
  ]);
  const directory=await mkdtemp(path.join(os.tmpdir(),'sf-array-metadata-')),file=path.join(directory,'Arrays.dll');
  try {
    await writeFile(file,assembly);
    const reference=await extractNative('metadata',[file],{toolchain});
    const methods=reference.rows.filter(row=>row.owner==='ArrayApi'&&row.kind==='method');
    assert.equal(methods.length,cases.length);
    for(const [name,,expected] of cases)assert.deepEqual(methods.find(row=>row.name===name).parameters,[expected],name);
    assert.equal(new Set(methods.map(row=>row.parameters[0])).size,cases.length);
    const member=methods.find(row=>row.name==='GeneralOne');
    const contract={id:1,owner:'ArrayApi',name:'GeneralOne',isStatic:false,result:'void',parameters:['int[]']};
    assert.equal(compareMembers({rows:[member]},{registryTypes:new Map(),registryContracts:[contract]}).rows[0].status,'missing');
    assert.equal(compareMembers({rows:[member]},{registryTypes:new Map(),registryContracts:[{...contract,parameters:['int[*]']}]}).rows[0].status,'implemented');
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('real pinned reference pack yields public metadata across all 167 assemblies',async()=>{
  const reference=await bclMetadata({toolchain});assert.equal(reference.files.length,167);assert.ok(reference.rows.length>40000);
  assert.ok(reference.rows.some(r=>r.owner==='System.GC'&&r.name==='Collect'));
  const result=bclApiDiff(reference);assert.equal(result.rows.length,reference.rows.length);assert.ok(result.rows.some(r=>r.status==='missing'));
  assert.ok(reference.files.every(f=>/^[a-f0-9]{64}$/.test(f.sha256)));
});
test('actual restored pinned WinMD contains native Button properties and events',async()=>{
  const reference=await winuiMetadata({toolchain});assert.ok(reference.rows.some(r=>r.owner==='Microsoft.UI.Xaml.Controls.Button'));
  assert.ok(reference.rows.some(r=>r.kind==='event'&&r.name==='Click'));
  const result=winuiApiDiff(reference);assert.equal(result.rows.length,reference.rows.length);assert.ok(result.controls.length>100);
});
test('real Roslyn ErrorCode enumeration includes compile errors and warnings',async()=>{
  const result=await diagnosticMetadata({toolchain});assert.ok(result.rows.length>1000);assert.ok(result.rows.some(r=>r.name==='ERR_SemicolonExpected'&&r.value===1002));assert.ok(result.rows.some(r=>r.name.startsWith('WRN_')));
});
test('native extractor rejects malformed PE, empty inputs, invalid mode and cancellation',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'sf-native-negative-')),file=path.join(dir,'bad.dll');
  try {
    await writeFile(file,Buffer.from([0x4d,0x5a,0,0]));
    await assert.rejects(extractNative('metadata',[file],{toolchain}),/BadImage|metadata|image/i);
    await assert.rejects(extractNative('metadata',[],{toolchain}),/input count/i);
    await assert.rejects(extractNative('bad-mode',[],{toolchain}),/Unknown/);
    const controller=new AbortController();controller.abort();await assert.rejects(extractNative('ecma',[],{toolchain,signal:controller.signal}),/cancel|abort/i);
  }finally{await rm(dir,{recursive:true,force:true});}
});
