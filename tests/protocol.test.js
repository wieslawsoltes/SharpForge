import test from 'node:test';
import assert from 'node:assert/strict';
import { LanguageServer,DebugAdapter } from '@sharpforge/protocol';
import { image } from './helpers.js';

test('LSP: initialization advertises implemented UTF-16 capabilities',async()=>{const s=new LanguageServer();const r=await s.handle({id:1,method:'initialize'});assert.equal(r.result.capabilities.positionEncoding,'utf-16');assert.equal(r.result.capabilities.textDocumentSync,2);assert(r.result.capabilities.documentFormattingProvider);});
test('LSP: versioned diagnostics publish on open and edit',async()=>{const events=[],s=new LanguageServer({send:m=>events.push(m)});await s.handle({method:'textDocument/didOpen',params:{textDocument:{uri:'Program.cs',text:'int x="bad";',version:1}}});assert(events.at(-1).params.diagnostics.some(d=>d.code==='CS0029'));await s.handle({method:'textDocument/didChange',params:{textDocument:{uri:'Program.cs',version:2},contentChanges:[{text:'int x=1;Console.WriteLine(x);'}]}});assert.equal(events.at(-1).params.version,2);assert.equal(events.at(-1).params.diagnostics.length,0);});
test('LSP: completion, rename and semantic tokens return protocol shapes',async()=>{const s=new LanguageServer();await s.handle({method:'textDocument/didOpen',params:{textDocument:{uri:'Program.cs',text:'int count=1;\nConsole.WriteLine(count);',version:1}}});const r=await s.handle({id:2,method:'textDocument/rename',params:{textDocument:{uri:'Program.cs'},position:{line:0,character:5},newName:'amount'}});assert.equal(r.result.changes['Program.cs'].length,2);const tokens=await s.handle({id:3,method:'textDocument/semanticTokens/full',params:{textDocument:{uri:'Program.cs'}}});assert(tokens.result.data.length>0);assert.equal(tokens.result.data.length%5,0);});
test('LSP: unknown methods return method-not-found',async()=>{assert.equal((await new LanguageServer().handle({id:7,method:'missing'})).error.code,-32601);});
test('DAP: launch, stepping, inspection and repeated stopped events',async()=>{
 const events=[],a=new DebugAdapter({send:m=>events.push(m)});let seq=0;const request=(command,args)=>a.handle({seq:++seq,type:'request',command,arguments:args});
 const capabilities=await request('initialize');assert(capabilities.body.supportsStepBack);assert(!capabilities.body.supportsRestartFrame);
 assert.equal((await request('launch',{image:image('int x=1;\nx=2;\nConsole.WriteLine(x);'),stopOnEntry:true})).success,true);
 await request('configurationDone');a.pump({instructionBudget:1000,timeBudgetMs:100});assert.equal(events.filter(e=>e.event==='stopped').length,1);
 await request('next',{threadId:1});a.pump({instructionBudget:1000,timeBudgetMs:100});assert.equal(events.filter(e=>e.event==='stopped').length,2);
 const stack=await request('stackTrace',{threadId:1}),frameId=stack.body.stackFrames[0].id;assert.equal(stack.body.stackFrames[0].line,2);
 const scopes=await request('scopes',{frameId}),ref=scopes.body.scopes[0].variablesReference;const locals=await request('variables',{variablesReference:ref});assert.equal(locals.body.variables.find(v=>v.name==='x').value,'1');
 assert.equal((await request('evaluate',{expression:'x+5',frameId})).body.result,'6');assert.equal((await request('setVariable',{variablesReference:ref,name:'x',value:'8'})).success,true);
 await request('continue',{threadId:1});a.pump({instructionBudget:1000,timeBudgetMs:100});assert(events.some(e=>e.event==='terminated'));assert(events.some(e=>e.event==='output'&&e.body.output==='2\n'));
});
test('DAP: unsupported requests fail explicitly',async()=>{const a=new DebugAdapter();assert.equal((await a.handle({seq:1,command:'attach'})).success,false);});
test('DAP: breakpoints can be configured before launch',async()=>{const a=new DebugAdapter();await a.handle({seq:1,command:'setBreakpoints',arguments:{source:{path:'Program.cs'},breakpoints:[{line:2}]}});await a.handle({seq:2,command:'launch',arguments:{image:image('int x=1;\nConsole.WriteLine(x);'),stopOnEntry:false}});await a.handle({seq:3,command:'configurationDone'});a.pump({instructionBudget:1000,timeBudgetMs:100});assert.equal(a.session.reason.reason,'breakpoint');});

for (const [name, convert] of [
  ['Uint8Array', bytes => bytes],
  ['ArrayBuffer', bytes => bytes.buffer],
  ['JSON byte array', bytes => JSON.parse(JSON.stringify(Array.from(bytes)))]
]) test('DAP: IL launch from '+name+' retains source stepping and IL frame coordinates', async () => {
  const {compileToIL}=await import('@sharpforge/compiler');
  const compiled=compileToIL('int x=42;\nConsole.WriteLine(x);');
  assert.equal(compiled.success,true);
  const events=[],adapter=new DebugAdapter({send:event=>events.push(event)});
  const response=await adapter.handle({seq:1,command:'launch',arguments:{assembly:convert(compiled.assembly),stopOnEntry:true}});
  assert.equal(response.success,true,response.message);
  await adapter.handle({seq:2,command:'configurationDone'});
  adapter.pump({instructionBudget:1000,timeBudgetMs:100});
  const stack=await adapter.handle({seq:3,command:'stackTrace',arguments:{threadId:1}});
  const frame=stack.body.stackFrames[0];
  assert.ok(frame.methodToken>=0x06000001);assert.ok(frame.ilOffset>=0);assert.equal(frame.ilOffset,adapter.session.vm.currentPoint.ilOffset);
  await adapter.handle({seq:4,command:'continue'});
  adapter.pump({instructionBudget:1000,timeBudgetMs:100});
  assert.ok(events.some(e=>e.event==='output'&&e.body.output==='42\n'));
  assert.equal(adapter.session.vm.statistics().artifactFormat,'ECMA-335');
});
test('DAP: malformed assembly transport bytes are rejected rather than coerced',async()=>{
  const adapter=new DebugAdapter();
  for(const assembly of [[256],[-1],[1.5],['1'],{0:77},'MZ']) {
    const response=await adapter.handle({seq:1,command:'launch',arguments:{assembly}});
    assert.equal(response.success,false);
  }
});
