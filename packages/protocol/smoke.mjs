import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'protocol:unicode-framing', order: 640, async run(context) {
    const {result} = context;
    const {ProtocolMessageReader,encodeProtocolMessage}=await import('@sharpforge/protocol');
    const reader=new ProtocolMessageReader();
    assert.deepEqual(reader.feed(encodeProtocolMessage({id:1,result:'😀'})),[{id:1,result:'😀'}]);
  }},
  {id: 'protocol:configuration-done', order: 1340, async run(context) {
    const {source, vm, debugIL} = context;
    const {DebugAdapter}=await import('@sharpforge/protocol');
    const adapter09=new DebugAdapter();
    let seq09=0;
    for(const [command,args] of [['initialize',{}],['launch',{assembly:debugIL.assembly}],['setBreakpoints',{source:{path:'Program.cs'},breakpoints:[{line:2}]}]]){assert((await adapter09.handle({seq:++seq09,type:'request',command,arguments:args})).success);}
    adapter09.pump();
    assert.notEqual(adapter09.session.vm.state,'paused');
    assert((await adapter09.handle({seq:++seq09,type:'request',command:'configurationDone',arguments:{}})).success);
    adapter09.pump();
    assert.equal(adapter09.session.reason.reason,'breakpoint');
  }},
];

export async function smokeInstalledCli({directory, packageRoot, run}) {
  const {readFile} = await import('node:fs/promises');
  const {join} = await import('node:path');
  const {encodeProtocolMessage, ProtocolMessageReader} = await import('@sharpforge/protocol');
  const bins = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')).bin;
  for (const [bin, message] of [
    ['sharpforge-lsp', {jsonrpc: '2.0', id: 1, method: 'initialize', params: {}}],
    ['sharpforge-dap', {seq: 1, type: 'request', command: 'initialize', arguments: {}}]
  ]) {
    const output = run(process.execPath, [join(packageRoot, bins[bin])], {cwd: directory, input: encodeProtocolMessage(message), timeout: 10000});
    const messages = new ProtocolMessageReader().feed(output);
    assert(messages.some(m => m.id === 1 || m.request_seq === 1 && m.success), `Missing packaged ${bin} response`);
  }
}
