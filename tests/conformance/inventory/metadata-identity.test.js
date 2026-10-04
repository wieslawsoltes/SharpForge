import test from 'node:test';
import assert from 'node:assert/strict';
import { compareMembers } from '../../../scripts/conformance/inventory/bcl-api-diff.js';
import { winuiApiDiff } from '../../../scripts/conformance/inventory/winui-api-diff.js';
import { signatureKey } from '../../../scripts/conformance/inventory/common.js';
import { contracts } from '../../../packages/framework/src/index.js';

function reference(parameters) {
  return {files:[],rows:parameters.map(parameter=>({assembly:'Example',owner:'Example.Api',kind:'method',name:'Invoke',
    isStatic:true,genericArity:0,signatureHeader:0,result:'System.Void',parameters:[parameter],signature:`Example.Api::Invoke(${parameter}):System.Void`}))};
}

test('method headers retain ordinary keys and distinguish non-default conventions in BCL and WinUI',()=>{
  for(const isStatic of [true,false])for(const genericArity of [0,1]) {
    const ordinary=(isStatic?0:0x20)|(genericArity?0x10:0);
    const contract={id:7,owner:'Example.Api',kind:'method',name:'Invoke',isStatic,genericArity,result:'void',parameters:['int']};
    const member={...contract,assembly:'Example',kind:'method',result:'System.Void',parameters:['System.Int32']};
    const legacyKey=`Example.Api|Invoke|${isStatic?'static':'instance'}|${genericArity}|int|void`;
    assert.equal(signatureKey(contract),legacyKey);
    assert.equal(signatureKey({...member,signatureHeader:ordinary}),legacyKey);
    const headers=[ordinary,ordinary|5,ordinary|0x40,ordinary|0x80];
    const rows=headers.map(signatureHeader=>({...member,signatureHeader,signature:`Invoke header=${signatureHeader}`}));
    assert.equal(new Set(rows.map(row=>signatureKey(row,{requireHeader:true}))).size,headers.length);
    for(const compare of [compareMembers,winuiApiDiff]) {
      const options={registryTypes:new Map(),registryContracts:[contract]};
      const result=compare({rows},options);
      assert.deepEqual(result.rows.map(row=>row.status),['implemented','missing','missing','missing']);
      assert.equal(result.totals.denominator,headers.length);
      for(const [index,signatureHeader] of headers.entries()) {
        const explicit=compare({rows},{...options,registryContracts:[{...contract,signatureHeader}]});
        assert.deepEqual(explicit.rows.map(row=>row.status),headers.map((_,i)=>i===index?'implemented':'missing'));
      }
    }
  }
});

test('both inventories accept ordinary headers against the actual framework registry',()=>{
  const contract=contracts.find(row=>row.kind==='method');
  assert.ok(contract);
  const signatureHeader=(contract.isStatic?0:0x20)|((contract.genericArity??0)>0?0x10:0);
  const member={...contract,assembly:'RegistryFixture',signatureHeader,signature:'RegistryFixture::method'};
  for(const compare of [compareMembers,winuiApiDiff]) {
    assert.equal(compare({rows:[member]}).rows[0].status,'implemented');
    const historical={...member};delete historical.signatureHeader;
    assert.throws(()=>compare({rows:[historical]}),/historical metadata requires recapture/);
  }
});

test('native historical or malformed method headers cannot qualify an inventory match',()=>{
  const member={...reference(['System.Int32']).rows[0]}, contract={id:7,owner:member.owner,kind:'method',name:member.name,isStatic:true,result:'void',parameters:['int']};
  delete member.signatureHeader;
  for(const compare of [compareMembers,winuiApiDiff]) {
    const options={registryTypes:new Map(),registryContracts:[contract]};
    assert.throws(()=>compare({rows:[member]},options),/historical metadata requires recapture/);
    for(const signatureHeader of [undefined,null,'0',-1,256,1.5,NaN]) {
      assert.throws(()=>compare({rows:[{...member,signatureHeader}]},options),/header must be a byte/);
      assert.throws(()=>compare({rows:[{...member,signatureHeader:0}]},{...options,registryContracts:[{...contract,signatureHeader}]}),/header must be a byte/);
    }
  }
});

test('BCL and WinUI comparisons never alias function-pointer conventions, flags or vararg boundaries',()=>{
  const prefix=(header,generic=0,required=1)=>`method[header=0x${header};generic=${generic};required=${required}]`;
  const parameters=[
    ...['00','01','02','09','20','60'].map(header=>`${prefix(header)} System.Void *(System.Int32)`),
    `${prefix('10',1)} System.Void *(System.Int32)`,`${prefix('10',2)} System.Void *(System.Int32)`,
    `${prefix('05',0,0)} System.Void *(System.Int32)`,`${prefix('05')} System.Void *(System.Int32)`,
    `${prefix('09')} System.Void modopt(System.Runtime.CompilerServices.CallConvCdecl) *(System.Int32)`,
    `${prefix('09')} System.Void modopt(System.Runtime.CompilerServices.CallConvStdcall) *(System.Int32)`,
    `${prefix('09')} System.Void modreq(System.Runtime.CompilerServices.CallConvCdecl) *(System.Int32)`,
  ];
  const input=reference(parameters);
  for(const compare of [compareMembers,winuiApiDiff])for(const [index,parameter] of parameters.entries()) {
    const contract={id:index,owner:'Example.Api',name:'Invoke',isStatic:true,result:'void',parameters:[parameter]};
    const result=compare(input,{registryTypes:new Map(),registryContracts:[contract]});
    assert.deepEqual(result.rows.map(row=>row.status),parameters.map((_,i)=>i===index?'implemented':'missing'));
    assert.equal(result.totals.denominator,parameters.length);
    assert.deepEqual(result.rows[index].contractIds,[index]);
  }
});

test('BCL and WinUI comparisons keep array shape vectors, omitted bounds and nesting distinct',()=>{
  const parameters=['System.Int32[]','System.Int32[*]','System.Int32[,]','System.Int32[,,]',
    'System.Int32[rank=1;sizes=();lower=(0)]','System.Int32[rank=1;sizes=();lower=(-1)]',
    'System.Int32[rank=1;sizes=(0);lower=()]','System.Int32[rank=1;sizes=(3);lower=()]',
    'System.Int32[rank=2;sizes=(3);lower=()]','System.Int32[rank=2;sizes=(3);lower=(0)]',
    'System.Int32[rank=2;sizes=(3);lower=(0,0)]','System.Int32[rank=2;sizes=(3,4);lower=(-1,2)]',
    'System.Int32[*][]','System.Int32[][rank=2;sizes=(3);lower=(1)]'];
  const input=reference(parameters);
  for(const compare of [compareMembers,winuiApiDiff])for(const [index,parameter] of parameters.entries()) {
    const contract={id:index,owner:'Example.Api',name:'Invoke',isStatic:true,result:'void',parameters:[parameter.replace('System.Int32','int')]};
    const result=compare(input,{registryTypes:new Map(),registryContracts:[contract]});
    assert.deepEqual(result.rows.map(row=>row.status),parameters.map((_,i)=>i===index?'implemented':'missing'));
    assert.equal(result.totals.denominator,parameters.length);
  }
});
