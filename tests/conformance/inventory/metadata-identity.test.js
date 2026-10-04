import test from 'node:test';
import assert from 'node:assert/strict';
import { compareMembers } from '../../../scripts/conformance/inventory/bcl-api-diff.js';
import { winuiApiDiff } from '../../../scripts/conformance/inventory/winui-api-diff.js';

function reference(parameters) {
  return {files:[],rows:parameters.map(parameter=>({assembly:'Example',owner:'Example.Api',kind:'method',name:'Invoke',
    isStatic:true,genericArity:0,result:'System.Void',parameters:[parameter],signature:`Example.Api::Invoke(${parameter}):System.Void`}))};
}

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
