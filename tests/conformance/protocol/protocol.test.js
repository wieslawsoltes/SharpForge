import test from 'node:test';
import assert from 'node:assert/strict';
import {LanguageServer, DebugAdapter} from '@sharpforge/protocol';
import {loadModels, lspValidator, dapValidator} from '../../../scripts/conformance/protocol/schema.js';
import {probeUnsupported} from '../../../scripts/conformance/protocol/probe.js';
import {validator} from '../../../scripts/conformance/protocol/messages.js';
import {validateSession} from '../../../scripts/conformance/protocol/session.js';
import {replaySession, replayFiles} from '../../../scripts/conformance/protocol/replay.js';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const models = await loadModels();
test('pinned LSP model validates an actual initialization response and rejects malformed nested capabilities', async () => {
  const validate = validator('lsp', models), request = {jsonrpc:'2.0',id:1,method:'initialize',params:{processId:null,rootUri:null,capabilities:{}}};
  validate(request,'clientToServer'); const response = await new LanguageServer().handle(request); validate(response,'serverToClient');
  const type = lspValidator(models.lsp); response.result.capabilities.positionEncoding = 17;
  assert.throws(() => type.check(response.result,{kind:'reference',name:'InitializeResult'}));
  assert.throws(() => type.check(-1,{kind:'base',name:'uinteger'}));
  assert.throws(() => type.check(2147483648,{kind:'base',name:'integer'}));
});
test('pinned DAP model validates actual initialization response/events and request correlation', async () => {
  const validate = validator('dap',models), request={seq:1,type:'request',command:'initialize',arguments:{adapterID:'sharpforge'}};
  validate(request,'clientToServer'); const adapter = new DebugAdapter({send:message=>validate(message,'serverToClient')});
  validate(await adapter.handle(request),'serverToClient');
  assert.throws(()=>validate({seq:3,type:'response',request_seq:9,command:'initialize',success:true,body:{}},'serverToClient'),/Uncorrelated/);
});
test('LSP unsupported requests require method-not-found; malformed and duplicate IDs are rejected', () => {
  const validate=validator('lsp',models),request={jsonrpc:'2.0',id:1,method:'sharpforge/unsupported'};
  validate(request,'clientToServer'); validate({...request,id:'1'},'clientToServer'); assert.throws(()=>validate(request,'clientToServer'),/duplicate/);
  assert.throws(()=>validate({jsonrpc:'2.0',id:1,error:{code:-32602,message:'wrong error'}},'serverToClient'),/-32601/);
  assert.throws(()=>validator('lsp',models)({jsonrpc:'1.0',method:'initialized',params:{}},'clientToServer'),/2.0/);
});
test('DAP error responses preserve correlation and messages while satisfying the pinned schema', async () => {
  const adapter = new DebugAdapter(), schema = dapValidator(models.dap);
  const cases = [
    {command:'unsupportedCommand',message:"DAP request 'unsupportedCommand' is not implemented"},
    {command:'launch',arguments:{assembly:[256]},message:'launch.assembly must contain at most 64 MiB of unsigned bytes'},
    {command:'continue',message:'A configured, paused debug session is required'},
  ];
  for (const [index, fixture] of cases.entries()) {
    const request={seq:100+index,type:'request',command:fixture.command,arguments:fixture.arguments};
    const response=await adapter.handle(request);
    assert.deepEqual(response,{seq:index+1,type:'response',request_seq:request.seq,command:request.command,success:false,message:fixture.message,body:{}});
    schema.check(response,'ErrorResponse');
  }
});
test('DAP schema detects missing error bodies and the product probe returns a valid error response', async () => {
  const error={seq:1,type:'response',request_seq:1,command:'unsupportedCommand',success:false,message:'unsupported'};
  assert.throws(()=>dapValidator(models.dap).check(error,'ErrorResponse'),/body.*missing required/);
  dapValidator(models.dap).check({...error,body:{}},'ErrorResponse');
  const report=await probeUnsupported(), dap=report.results.find(row=>row.protocol==='dap');
  assert.equal(dap.actual.success,false); assert.match(dap.actual.message,/not implemented/);
  assert.deepEqual(dap.actual.body,{});
  assert.equal(dap.status,'passed'); assert.equal(report.status,'passed');
  assert.equal(report.qualification,'unknown');
});
test('real stdio replay validates synthetic tooling traffic without calling it a VS Code recording', async () => {
  const session={schemaVersion:1,protocol:'lsp',kind:'synthetic',complete:true,messages:[
    {direction:'clientToServer',message:{jsonrpc:'2.0',id:1,method:'sharpforge/unsupported'}},
    {direction:'serverToClient',message:{jsonrpc:'2.0',id:1,error:{code:-32601,message:"Method 'sharpforge/unsupported' is not implemented"}}},
  ]};
  await assert.rejects(replaySession(session),/Synthetic/);
  const result=await replaySession(session,{allowSynthetic:true}); assert.equal(result.status,'passed'); assert.equal(result.qualification,'synthetic-tooling-only');
  const wrong=structuredClone(session);wrong.messages[1].message.error.message='changed';
  assert.equal((await replaySession(wrong,{allowSynthetic:true})).status,'different');
});
test('recording provenance and complete traffic are mandatory; no recordings means not-run', async () => {
  assert.throws(()=>validateSession({schemaVersion:1,protocol:'dap',kind:'recording',complete:true,messages:[{direction:'clientToServer',message:{}}]}),/provenance/);
  assert.throws(()=>validateSession({schemaVersion:1,protocol:'lsp',kind:'synthetic',complete:false,messages:[]}),/incomplete/);
  const dir=await mkdtemp(join(tmpdir(),'sf-protocol-report-'));
  try {const report=await replayFiles([],{output:join(dir,'report.json')});assert.equal(report.status,'not-run');assert.equal(report.qualification,'unknown');}
  finally {await rm(dir,{recursive:true,force:true});}
});
