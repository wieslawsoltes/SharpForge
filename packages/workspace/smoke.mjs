import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'workspace:workspace-apis', order: 220, async run(context) {
    const {Workspace}=await import('@sharpforge/workspace');
    const {ExtensionDriver,BuildInfoGenerator}=await import('@sharpforge/extensions');
    const {RefactoringEngine}=await import('@sharpforge/refactoring');
    Object.assign(context, {Workspace, ExtensionDriver, BuildInfoGenerator, RefactoringEngine});
  }},
];
