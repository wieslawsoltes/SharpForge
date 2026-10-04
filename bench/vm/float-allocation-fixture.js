import {qualificationAssembly} from './qualification-assembly.js';

/** Exact dyadic arithmetic avoids a tolerance oracle; induction may also use the verifier's Int32 path. */
export function floatAllocationAssembly(iterations, integerCounter = false) {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10000000) throw new RangeError('Invalid float iteration count');
  return qualificationAssembly({result: 'double', locals: ['double', integerCounter ? 'int' : 'double'], maxStack: 2,
    body(writer) {
      writer.op('ldc.r8', 0).op('stloc.0');
      if (integerCounter) writer.integer(0);
      else writer.op('ldc.r8', 0);
      writer.op('stloc.1').mark('loop');
      writer.op('ldloc.0').op('ldc.r8', 0.25).op('add').op('stloc.0');
      writer.op('ldloc.1');
      if (integerCounter) writer.integer(1);
      else writer.op('ldc.r8', 1);
      writer.op('add').op('stloc.1').op('ldloc.1');
      if (integerCounter) writer.integer(iterations);
      else writer.op('ldc.r8', iterations);
      writer.op('blt', 'loop').op('ldloc.0').op('ret');
    }});
}

export const floatLoopInstructions = 11;
export const floatLoopSetupInstructions = 4;
