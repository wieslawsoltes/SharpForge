import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'archive:zip-roundtrip', order: 1720, async run(context) {
    const {exportWorkspaceZip, readZip, plan} = context;
    const zip=exportWorkspaceZip({records:plan.records,folders:plan.folders,settings:{entry:plan.entry,startup:plan.startup}});
    assert(readZip(zip).length>5);
    Object.assign(context, {zip});
  }},
];
