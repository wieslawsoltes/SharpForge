import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareGolden, filesUnder, checkSeamLock, syntaxSnapshot } from '../../../scripts/planning/golden-output.js';
import { git } from '../../../scripts/planning/lib/io.js';

test('golden comparison reports precise assembly bytecode syntax and distribution drift including removals',()=>{
  const before={schemaVersion:1,algorithm:'sha256',mode:'fixture',examples:[{input:'examples/A.cs',source:'s',syntax:'t',assembly:'a',bytecode:'b',diagnostics:'d',status:'emitted'}],bundles:[{path:'dist/studio.js',sha256:'x'}]};
  assert.deepEqual(compareGolden(before,structuredClone(before)).changes,[]);
  for(const key of ['source','syntax','assembly','bytecode','diagnostics']){
    const after=structuredClone(before);after.examples[0][key]='changed';assert.equal(compareGolden(before,after).changes[0].path,'examples/A.cs');
  }
  const removed=structuredClone(before);removed.examples=[];assert.equal(compareGolden(before,removed).changes[0].kind,'removed');
  const bundle=structuredClone(before);bundle.bundles[0].sha256='changed';assert.equal(compareGolden(before,bundle).changes[0].group,'bundles');
  const duplicate=structuredClone(before);duplicate.examples.push(duplicate.examples[0]);assert.throws(()=>compareGolden(before,duplicate),/Duplicate/);
});
test('seam label rejects rewritten lock even when a newly generated lock matches the new output',()=>{
  const root=mkdtempSync(join(tmpdir(),'sf-golden-')),g=args=>git(args,root);
  try{
    g(['init','-b','main']);g(['config','user.name','Fixture']);g(['config','user.email','fixture@example.test']);mkdirSync(join(root,'planning/contracts'),{recursive:true});
    const path=join(root,'planning/contracts/golden-output.lock.json');writeFileSync(path,'{"old":true}\n');g(['add','.']);g(['commit','-m','baseline']);const base=g(['rev-parse','HEAD']).trim();
    assert.deepEqual(checkSeamLock({root,base,labels:['seam']}).errors,[]);writeFileSync(path,'{"new":true}\n');g(['commit','-am','intentional output change']);
    assert.equal(checkSeamLock({root,base,labels:['seam']}).errors.length,1);assert.deepEqual(checkSeamLock({root,base,labels:[]}).errors,[]);
    assert.deepEqual(filesUnder(root,'planning'),['planning/contracts/golden-output.lock.json']);
  }finally{rmSync(root,{recursive:true,force:true});}
});


test('lossless syntax golden retains tree structure without red parent cycles or allocation IDs', async () => {
  const {parse} = await import('@sharpforge/syntax');
  const source = '// trivia\nConsole.WriteLine(42);';
  const first = parse(source), snapshot = syntaxSnapshot(first);
  first.syntax.childNodes();
  assert.equal(syntaxSnapshot(first), snapshot);
  parse('class Unrelated { }');
  const repeated = parse(source);
  assert.notEqual(first.green.id, repeated.green.id);
  assert.equal(syntaxSnapshot(repeated), snapshot);
  for (const changed of ['// changed\nConsole.WriteLine(42);', '// trivia\nConsole.WriteLine(43);']) {
    assert.notEqual(syntaxSnapshot(parse(changed)), snapshot);
  }
  const tree = JSON.parse(snapshot);
  assert.equal(tree.green.kind, 'CompilationUnit');
  assert.ok(tree.green.children.length);
  assert.ok(tree.root.statements.length);
});
