import loadStore from './load-store.js';
import branch from './branch.js';
import arith from './arith.js';
import objectModel from './object-model.js';
import array from './array.js';
import indirect from './indirect.js';
import call from './call.js';

/** Each group registers its exact opcode names. Instruction dispatch performs one lookup. */
export const cilHandlers=new Map();
for(const group of [loadStore,branch,arith,objectModel,array,indirect,call]) {
  for(const [opcode,handler] of group) {
    if(cilHandlers.has(opcode))throw new Error(`Duplicate CIL handler '${opcode}'`);
    cilHandlers.set(opcode,handler);
  }
}
