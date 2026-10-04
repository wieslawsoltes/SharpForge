import {DiagnosticId} from '../diagnostics/codes.js';
import {Op} from '@sharpforge/bytecode';
import {emitPrimitiveBox} from './value-arguments.js';

/** Emit a legacy-pipeline array, boxing primitive values only for object elements. */
export function emitArrayCreation(compiler, syntax) {
  let type = syntax.type;
  if (type === 'var[]') {
    if (!syntax.values?.length) compiler.c.report(syntax, DiagnosticId.CS0826);
    type = (syntax.values?.length ? compiler.infer(syntax.values[0]) : 'error') + '[]';
  }
  type = compiler.c.resolveType(type, syntax, false, compiler.m);
  const element = type.slice(0, -2);
  if (syntax.length) compiler.checkAssign('int', compiler.expr(syntax.length), syntax.length);
  else compiler.emitConstant(syntax.values?.length ?? 0);
  compiler.emit(Op.NEWARR, compiler.c.constant(element));
  for (let index = 0; index < (syntax.values?.length ?? 0); index++) {
    compiler.emit(Op.DUP);
    compiler.emitConstant(index);
    const value = syntax.values[index];
    const valueType = compiler.typedExpr(value, element);
    compiler.checkAssign(element, valueType, value);
    emitPrimitiveBox(compiler, element, valueType);
    compiler.emit(Op.STELEM);
    compiler.emit(Op.POP);
  }
  return type;
}
