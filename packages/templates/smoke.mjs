import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'templates:solution-plan', order: 1680, async run(context) {
    const {createProjectPlan}=await import('@sharpforge/templates');
    const {exportWorkspaceZip,importWorkspaceZip}=await import('@sharpforge/project-system');
    const {readZip}=await import('@sharpforge/archive');
    const plan=createProjectPlan('console-library-solution',{projectName:'Packed'});
    Object.assign(context, {exportWorkspaceZip, importWorkspaceZip, readZip, plan});
  }},
];
