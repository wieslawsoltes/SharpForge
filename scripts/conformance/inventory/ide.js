import path from 'node:path';
import { LanguageServer, DebugAdapter } from '../../../packages/protocol/src/index.js';
import { compile } from '../../../packages/compiler/src/index.js';
import { inventoryRoot, readJSON, counts } from './common.js';
const uri='file:///inventory.cs', source='class Program { static void Main() { int value=1; System.Console.WriteLine(value); } }';
export async function lspProbe(method) {
  const events=[], server=new LanguageServer({send:value=>events.push(value)});
  const initialize=await server.handle({id:1,method:'initialize',params:{capabilities:{workspace:{workspaceEdit:{documentChanges:true}}}}});
  await server.handle({method:'textDocument/didOpen',params:{textDocument:{uri,languageId:'csharp',version:1,text:source}}});
  const position={line:0,character:40}, range={start:{line:0,character:0},end:{line:0,character:source.length}};
  const params={textDocument:{uri,languageId:'csharp',version:2,text:source},position,positions:[position],range,context:{diagnostics:[],includeDeclaration:true},options:{tabSize:4,insertSpaces:true},newName:'renamed',query:'Program',contentChanges:[{text:source}],id:999};
  const hierarchy=await server.handle({id:2,method:'textDocument/prepareCallHierarchy',params});
  params.item=hierarchy.result?.[0]??{data:{uri,start:0,end:0}};
  // An id deliberately exposes dispatch recognition for notifications. This is
  // a routing probe, not a claim that notifications are legal requests.
  const response=await server.handle({id:3,method,params});
  const malformed=await new LanguageServer().handle({id:4,method,params:{}});
  return {status:response?.error?.code===-32601?'missing':response?.error?'unknown':'implemented',response,malformed,notificationEvents:events.map(e=>e.method),capabilities:initialize.result.capabilities};
}
export async function dapProbe(command) {
  const events=[], adapter=new DebugAdapter({send:value=>events.push(value)});
  const initialize=await adapter.handle({seq:1,type:'request',command:'initialize',arguments:{linesStartAt1:true,columnsStartAt1:true}});
  const compilation=compile(source);
  if(!compilation.success)throw new Error('DAP inventory fixture must compile');
  await adapter.handle({seq:2,type:'request',command:'launch',arguments:{image:compilation.image,stopOnEntry:true}});
  await adapter.handle({seq:3,type:'request',command:'configurationDone'});
  adapter.pump({instructionBudget:100,timeBudgetMs:20});
  const stack=await adapter.handle({seq:4,type:'request',command:'stackTrace',arguments:{threadId:1}}), frameId=stack.body?.stackFrames?.[0]?.id;
  const scopes=await adapter.handle({seq:5,type:'request',command:'scopes',arguments:{frameId}}), variablesReference=scopes.body?.scopes?.[0]?.variablesReference;
  const arguments_={image:compilation.image,stopOnEntry:true,threadId:1,frameId,variablesReference,source:{path:uri},line:1,column:1,breakpoints:[],filters:[],expression:'1+2',context:'watch',name:'value',value:'2',targetId:-1,memoryReference:'0x00000000',instructionCount:1};
  try {
    const response=await adapter.handle({seq:6,type:'request',command,arguments:arguments_});
    const malformed=await new DebugAdapter().handle({seq:7,type:'request',command,arguments:{}});
    return {status:response.success?'implemented':/is not implemented$/.test(response.message??'')?'missing':'unknown',response,malformed,capabilities:initialize.body,dynamicCapabilities:events.filter(e=>e.event==='capabilities').map(e=>e.body.capabilities)};
  } finally { adapter.session?.stop(); }
}
export async function ideInventory() {
  const lsp=await readJSON(path.join(inventoryRoot,'references/lsp-3.17.json')), dap=await readJSON(path.join(inventoryRoot,'references/dap.json')), rows=[];
  const lspCapabilities=(await lspProbe('initialize')).capabilities, dapCapabilities=(await dapProbe('initialize')).capabilities;
  for(const method of [...lsp.requests,...lsp.notifications]) {
    const observed=await lspProbe(method.method);
    rows.push({key:`lsp:method:${method.method}`,domain:'LSP',name:method.method,area:'A21',specRevision:'lsp-3.17',direction:method.messageDirection,kind:lsp.requests.includes(method)?'request':'notification',
      status:method.messageDirection==='serverToClient'?'not-applicable':observed.status,statusScope:'fresh handler dispatch with open document; no whole-method semantic qualification',
      probe:'scripts/conformance/inventory/ide.js#lspProbe',observation:{response:observed.response,malformed:observed.malformed,notificationEvents:observed.notificationEvents},
      reason:method.messageDirection==='serverToClient'?'Outbound client method is not an inbound server-handler obligation; transport/client behavior remains unknown':'Routing acceptance alone does not verify response semantics'});
  }
  for(const structure of lsp.structures.filter(x=>x.name.endsWith('Capabilities')))for(const property of structure.properties??[]) {
    const server=structure.name==='ServerCapabilities', declared=server&&Object.hasOwn(lspCapabilities,property.name);
    rows.push({key:`lsp:capability:${structure.name}.${property.name}`,domain:'LSP',name:`${structure.name}.${property.name}`,area:'A21',specRevision:'lsp-3.17',status:declared?'implemented':'unknown',
      statusScope:'initialize response declaration only',probe:'scripts/conformance/inventory/ide.js#lspProbe',reason:server?'Unadvertised capability has no behavioral evidence':'Client/nested negotiation capability requires a dedicated negotiation fixture',...(declared?{value:lspCapabilities[property.name]}:{})});
  }
  for(const [name,definition]of Object.entries(dap.definitions)) {
    if(!name.endsWith('Request')||name==='Request')continue;
    const command=definition.allOf?.flatMap(x=>x.properties?.command?.enum??[])[0];if(!command)throw new Error(`Pinned DAP request has no command: ${name}`);
    const observed=await dapProbe(command);
    rows.push({key:`dap:request:${command}`,domain:'DAP',name:command,area:'A14',specRevision:'dap-b584b597ab1bb43a28817a2b7582808f92d3b6e8',status:observed.status,statusScope:'fresh paused source-VM handler probe; native/CIL debugger semantics unqualified',probe:'scripts/conformance/inventory/ide.js#dapProbe',observation:{engine:'js-source-vm',response:observed.response,malformed:observed.malformed},reason:'Handler responses do not establish complete DAP behavior'});
  }
  for(const name of Object.keys(dap.definitions.Capabilities.properties))rows.push({key:`dap:capability:${name}`,domain:'DAP',name,area:'A14',specRevision:'dap-b584b597ab1bb43a28817a2b7582808f92d3b6e8',status:Object.hasOwn(dapCapabilities,name)?'implemented':'unknown',statusScope:'source-VM initialize declaration only; dynamic launch capabilities and CIL backend behavior are separate',probe:'scripts/conformance/inventory/ide.js#dapProbe',reason:'Capability declaration does not establish its behavior',...(Object.hasOwn(dapCapabilities,name)?{value:dapCapabilities[name]}:{})});
  const checklist=await readJSON(path.join(inventoryRoot,'surface-catalog.json'));
  rows.push(...checklist.rows.map(row=>({...row,key:`surface:${row.id}`,domain:'SURFACE',status:'unknown',specRevision:'sharpforge-surface-2026-10-03',statusScope:'versioned product obligation; behavioral evidence must be attached by its implementation owner',reason:'No verified obligation-specific artifact has been supplied'})));
  return {schemaVersion:1,rows,totals:counts(rows)};
}
