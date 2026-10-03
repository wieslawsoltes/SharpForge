import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,compileToIL} from '@sharpforge/compiler';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';
import {Workspace} from '@sharpforge/workspace';
import {LanguageService} from '@sharpforge/language';
import {LanguageServer} from '@sharpforge/protocol';
import {applyWorkspaceEdits} from '@sharpforge/refactoring';
/** A program whose only diagnostic is a warning: the catch variable is never used (CS0168). */
const source='try { Console.WriteLine(10 / int.Parse("0")); }\ncatch (Exception e) { Console.WriteLine("caught"); }\nConsole.WriteLine("done");';
const summary=d=>`${d.code}:${d.severity}`;
test('A02-T34 a program with an unused catch variable builds, runs and reports exactly one warning',()=>{
  const built=compile(source);assert.equal(built.success,true);assert(built.image,'an image is produced despite the warning');
  assert.deepEqual(built.diagnostics.map(summary),['CS0168:warning']);assert.equal(built.diagnostics[0].message,"The variable 'e' is declared but never used");assert.equal(built.metrics.errors,0);
  const run=new VirtualMachine(built.image).run();assert.equal(run.state,'terminated',run.fault?.stack);assert.equal(run.output,'caught\ndone\n');
  const il=compileToIL(source);assert.equal(il.success,true);assert(il.assembly.length>0);assert.deepEqual(il.diagnostics.map(summary),['CS0168:warning']);assert.equal(new CilVirtualMachine(il.assembly).run().output,'caught\ndone\n');
});
test('A02-T34 workspace, language service and LSP surface the warning without failing the build',()=>{
  const workspace=new Workspace();workspace.update('Program.cs',source,1);const result=workspace.compile();
  assert.equal(result.success,true);assert(result.image);assert.deepEqual(result.diagnostics.map(summary),['CS0168:warning']);assert.deepEqual(new LanguageService(workspace).diagnostics('Program.cs').map(summary),['CS0168:warning']);
  const events=[],server=new LanguageServer({send:m=>events.push(m)});
  return server.handle({method:'textDocument/didOpen',params:{textDocument:{uri:'Program.cs',text:source,version:1}}}).then(()=>{
    const published=events.at(-1).params.diagnostics;assert.equal(published.length,1);assert.equal(published[0].code,'CS0168');assert.equal(published[0].severity,2,'published with LSP warning severity');
  });
});
test('A02-T34 candidate-compiled edits are judged by errors, not by warnings',()=>{
  const workspace=new Workspace();workspace.update('Program.cs',source,1);
  // An edit that keeps the warning (and adds another) is accepted; one that introduces an error is rejected.
  const edit=newText=>[{uri:'Program.cs',start:0,end:0,newText,version:workspace.documents.get('Program.cs').source.version}];
  assert.doesNotThrow(()=>applyWorkspaceEdits(workspace,edit('int unused = 1;\n')));assert.deepEqual(workspace.compile().diagnostics.map(summary).sort(),['CS0168:warning','CS0219:warning']);assert.equal(workspace.compile().success,true);
  assert.throws(()=>applyWorkspaceEdits(workspace,edit('int broken = "text";\n')),/would introduce compilation errors: Cannot implicitly convert type 'string' to 'int'/);
});
