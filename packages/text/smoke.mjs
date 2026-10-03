import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'text:unicode-search', order: 500, async run(context) {
    const {findTextMatches}=await import('@sharpforge/text');
    assert.equal(findTextMatches([{uri:'a.cs',text:'İ x X'}],'x').matches[0].start,2);
  }},
];
