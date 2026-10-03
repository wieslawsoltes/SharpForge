import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'compute:simd-workers', order: 2110, async run(context) {
    const {createSimdEngine,ComputePool}=await import('@sharpforge/compute');
    const simd14=createSimdEngine({backend:'wasm'});
    assert.equal(simd14.backend,'wasm-simd128');
    assert.equal(simd14.execute('sum',new Float64Array([20,22])),42);
    const pool14=new ComputePool({workers:2});
    try{await pool14.init();const values=await Promise.all([pool14.execute('sum',new Float64Array([10,11])),pool14.execute('sum',new Float64Array([20,22]))]);assert.deepEqual(values,[21,42]);assert.equal((await pool14.capabilities()).slots.length,2);}finally{pool14.dispose();}
  }},
];
