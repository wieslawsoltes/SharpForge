import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'cil:ordinary-roundtrip', order: 160, async run(context) {
    const {compileToIL, source} = context;
    const {CilVirtualMachine}=await import('@sharpforge/runtime');
    const {AssemblyInspector,formatILDocument,assembleILDocument}=await import('@sharpforge/cil');
    const ordinary=compileToIL(source,{includeDebug:false}).assembly;
    assert.equal(new AssemblyInspector(ordinary).metadata.streams.has('#SF'),false);
    assert.equal(new CilVirtualMachine(ordinary).run().output,'42\n');
    assert.equal(new CilVirtualMachine(assembleILDocument(formatILDocument(ordinary)).bytes).run().output,'42\n');
    Object.assign(context, {CilVirtualMachine, formatILDocument, assembleILDocument, ordinary});
  }},
];
