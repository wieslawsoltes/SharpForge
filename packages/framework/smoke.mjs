import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'framework:manifest-contracts', order: 1450, async run(context) {
    const {frameworkManifest,findContracts}=await import('@sharpforge/framework');
    assert(frameworkManifest.types.length>40);
    assert(findContracts('Microsoft.UI.Xaml.Controls.Button','.ctor').length);
  }},
];
