import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'symbols:source-checksum', order: 1430, async run(context) {
    const {result} = context;
    const {readPortablePdb,loadSymbols,bindSources}=await import('@sharpforge/symbols');
    assert.equal(bindSources(loadSymbols(result.assembly,result.pdb)).documents[0].verified,true);
  }},
];
