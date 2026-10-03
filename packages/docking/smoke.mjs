import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'docking:layout-undo', order: 420, async run(context) {
    const {DockLayout}=await import('@sharpforge/docking');
    const dock=new DockLayout([{id:'editor',kind:'document'},{id:'output',kind:'tool'}]);
    dock.open('editor');
    dock.dockRoot('output','bottom');
    dock.float('output');
    dock.undo();
    assert.equal(dock.state.floating.length,0);
    dock.validate(dock.snapshot());
  }},
];
