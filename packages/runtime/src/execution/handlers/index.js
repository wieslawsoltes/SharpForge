import {handlers as virtualPointer} from './virtual-pointer.js';
import {handlers as calli} from './calli.js';
import {handlers as loadStore} from './load-store.js';
import {handlers as branch} from './branch.js';
import {handlers as arith} from './arith.js';
import {handlers as objectModel} from './object-model.js';
import {handlers as array} from './array.js';
import {handlers as indirect} from './indirect.js';
import {handlers as call} from './call.js';
import {handlers as tokens} from './tokens.js';
import {handlers as constrained} from './constrained.js';

/** Each group registers its exact opcode names. Instruction dispatch performs one lookup. */
export const cilHandlers=new Map();
for(const group of [loadStore,branch,arith,objectModel,array,indirect,call,tokens,constrained,calli,virtualPointer]) {
  for(const [opcode,handler] of group) {
    if(cilHandlers.has(opcode))throw new Error(`Duplicate CIL handler '${opcode}'`);
    cilHandlers.set(opcode,handler);
  }
}
