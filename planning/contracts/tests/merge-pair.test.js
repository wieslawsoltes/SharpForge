import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../../../scripts/planning/lib/io.js';
import { contractGate } from '../../../scripts/planning/contract-gate.js';

test('two actual Git branches each append a distinct contract at the same ID; combined tree fails',()=>{
  const root=mkdtempSync(join(tmpdir(),'sf-merge-pair-')), g=args=>git(args,root);
  try {
    g(['init','-b','main']);g(['config','user.name','Fixture']);g(['config','user.email','fixture@example.test']);
    mkdirSync(join(root,'planning/contracts'),{recursive:true});
    const path=join(root,'planning/contracts/framework-ids.lock.json'), base=[{id:0,name:'existing'}], write=value=>writeFileSync(path,JSON.stringify(value));
    write(base);g(['add','.']);g(['commit','-m','baseline']);
    g(['checkout','-b','left']);write([...base,{id:1,name:'Left'}]);g(['commit','-am','left extension']);assert.equal(contractGate({root,commands:[]}).passed,true);
    g(['checkout','-b','right','main']);write([...base,{id:1,name:'Right'}]);g(['commit','-am','right extension']);assert.equal(contractGate({root,commands:[]}).passed,true);
    // The merge conflict is resolved by retaining both contributions, a common
    // textual resolution that cannot preserve the numeric contract invariant.
    try {g(['merge','--no-commit','left']);} catch {}
    write([...base,{id:1,name:'Left'},{id:1,name:'Right'}]);g(['add','.']);g(['commit','-m','combine contributions']);
    assert.match(contractGate({root,commands:[]}).errors.join('\n'),/duplicate contract id 1/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
