import {SIMD_BASE64} from './wasm.js';
import {createKernel} from './kernel.js';
export {ComputePool} from './pool.js';
export {createKernel};
export function createSimdEngine(options={}){return createKernel(SIMD_BASE64,options);}
