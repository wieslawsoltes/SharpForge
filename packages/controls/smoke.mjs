import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'controls:tree-commands', order: 1040, async run(context) {
    const {TreeModel,CommandRegistry}=await import('@sharpforge/controls');
    const tree=new TreeModel([{id:'root',defaultExpanded:true,children:[{id:'a',label:'A.cs'}]}]);
    assert.equal(tree.rows().length,2);
    tree.select('a');
    assert(tree.selected.has('a'));
    const commands=new CommandRegistry();
    commands.register({id:'answer',label:'Answer',execute:()=>42});
    assert.equal(await commands.execute('answer'),42);
  }},
  {id: 'controls:stylesheet', order: 1160, async run(context) {
    const {readFileSync} = context;
    assert(readFileSync(new URL(import.meta.resolve('@sharpforge/controls/controls.css')),'utf8').includes('.sf-tree'));
  }},
];
