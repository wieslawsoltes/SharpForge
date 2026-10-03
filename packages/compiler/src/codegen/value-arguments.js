import {frameworkType} from '@sharpforge/framework';
import {needsPrimitiveBox, primitiveBoxContract} from '../primitive-boxing.js';

/** Emit one legacy-pipeline argument with the same object-boundary policy as bound lowering. */
export function emitValueArgument(compiler, syntax, target, boxPrimitives = false) {
  if (frameworkType(target)?.kind === 'delegate' && compiler.delegateMethod(syntax, target)) {
    compiler.emitDelegate(syntax, target);
    return;
  }
  const type = compiler.typedExpr(syntax, target);
  compiler.checkAssign(target, type, syntax);
  if (boxPrimitives) emitPrimitiveBox(compiler, target, type);
}

/** Preserve the type of an already-emitted primitive at an object boundary. */
export function emitPrimitiveBox(compiler, target, type) {
  if (needsPrimitiveBox(target, type)) {
    compiler.emitConstant(type);
    compiler.emitContract(primitiveBoxContract());
  }
}
