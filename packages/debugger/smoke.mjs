import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'debugger:cil-step', order: 550, async run(context) {
    const {vm, ordinary} = context;
    const {CilDebugSession}=await import('@sharpforge/debugger');
    const ds=new CilDebugSession(ordinary);
    ds.start();
    ds.runUntilStop();
    assert.equal(ds.reason.reason,'entry');
    assert(ds.disassemble(ds.stackTrace()[0].instructionPointerReference).length);
    ds.resume();
    ds.runUntilStop();
    assert.equal(ds.vm.output.join(''),'42\n');
    Object.assign(context, {CilDebugSession, ds});
  }},
  {id: 'debugger:reverse-replay', order: 770, async run(context) {
    const {vm, ordinary, CilDebugSession} = context;
    const replay=new CilDebugSession(ordinary,{recordHistory:true});
    replay.start();
    replay.runUntilStop();
    replay.resume();
    replay.runUntilStop();
    replay.stepBack();
    assert.equal(replay.vm.state,'paused');
    replay.reverseContinue();
    assert.equal(replay.vm.instructions,0);
    replay.resume();
    replay.runUntilStop();
    assert.equal(replay.vm.output.join(''),'42\n');
  }},
  {id: 'debugger:remap-breakpoints', order: 1210, async run(context) {
    const {remapSourceBreakpoints}=await import('@sharpforge/debugger');
    assert.equal(remapSourceBreakpoints('int x=1;','// comment\nint x=1;',[{line:1}])[0].line,2);
  }},
  {id: 'debugger:source-cil-breakpoints', order: 1280, async run(context) {
    const {compileToIL, loadAssembly, result, vm, CilDebugSession} = context;
    const {DebugSession,SourceBreakpointIndex}=await import('@sharpforge/debugger');
    const debugIL=compileToIL('for(int i=0;i<3;i++){\nConsole.WriteLine(i);\n}');
    assert(debugIL.success);
    for(const Session of [DebugSession,CilDebugSession]){const dbg=new Session(debugIL.assembly,{recordHistory:true});assert(dbg.setBreakpoints('Program.cs',[{line:2}])[0].verified);dbg.start(false);dbg.runUntilStop();assert.equal(dbg.reason.reason,'breakpoint');assert.equal(dbg.evaluate('i').result,'0');assert.equal(dbg.vm.output.join(''),'');dbg.resume('continue');dbg.runUntilStop();assert.equal(dbg.evaluate('i').result,'1');dbg.reverseContinue();assert.equal(dbg.evaluate('i').result,'0');assert.equal(dbg.breakpoints[0].hits,1);}
    const locationIndex=new SourceBreakpointIndex(loadAssembly(debugIL.assembly));
    assert.equal(locationIndex.resolve('Program.cs',{line:2}).point.line,2);
    Object.assign(context, {DebugSession, debugIL});
  }},
  {id: 'debugger:set-next-statement', order: 1600, async run(context) {
    const {compileToIL, vm, DebugSession} = context;
    const reloc=compileToIL('int x=20;\nx=x+22;\nConsole.WriteLine(x);'),rd=new DebugSession(reloc.image);
    rd.setBreakpoints('Program.cs',[{line:2}]);
    rd.start(false);
    rd.runUntilStop();
    rd.setNextStatement({uri:'Program.cs',line:3});
    rd.resume();
    rd.runUntilStop();
    assert.equal(rd.vm.output.join(''),'20\n');
  }},
  {id: 'debugger:structural-enc', order: 1860, async run(context) {
    const {compileToIL, DebugSession} = context;
    const initial='class P { static int A(int x){return x+1;} static void Main(){\nint x=2;\nConsole.WriteLine(A(x));\n}}';
    const es=new DebugSession(compileToIL(initial).image);
    es.setBreakpoints('Program.cs',[{line:3}]);
    es.start(false);
    es.runUntilStop();
    const updated=initial.replace('return x+1;','return B(x);').replace('static void Main()','static int B(int x){return x*21;} static void Main()');
    assert.equal(es.applyChanges(compileToIL(updated).image).summary.addedMethods,1);
    es.setBreakpoints('Program.cs',[]);
    es.resume();
    assert.equal(es.runUntilStop().output,'42\n');
  }},
];
