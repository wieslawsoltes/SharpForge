import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'refactoring:explicit-type', order: 300, async run(context) {
    const {source, Workspace, RefactoringEngine} = context;
    const edits=new Workspace();
    edits.update('Program.cs','var count=42; Console.WriteLine(count);',1);
    const engine=new RefactoringEngine(edits);
    const actions=engine.actions('Program.cs',5);
    assert(actions.length);
    engine.apply(actions[0]);
    assert.match(edits.documents.get('Program.cs').source.text,/int count/);
  }},
];
