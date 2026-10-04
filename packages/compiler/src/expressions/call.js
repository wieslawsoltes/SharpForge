import {DiagnosticId} from '../diagnostics/codes.js';
import { Op, BuiltinMap } from '@sharpforge/bytecode';
import { numeric, pathOf, typeText } from '../type-utils.js';

export function emitCall(node) {
  if (this.isNameof(node)) {
    this.emitConstant(this.nameof(node));
    return 'string';
  }
  const builtin = this.findBuiltin(node);
  if (builtin) {
    let count = 0;
    let types = [];
    const staticPath = pathOf(node.target)?.replace(/^System\./, '');
    if (staticPath !== builtin.name && node.target.kind === 'Member') {
      types.push(this.expr(node.target.target));
      count++;
    }
    for (const a of node.args) {
      types.push(this.expr(a));
      count++;
    }
    if (count < builtin.min || count > builtin.max)
      this.c.report(node, DiagnosticId.CS1501, [builtin.name, count]);
    types.forEach((type, i) => {
      const target = builtin.params[i];
      if (target === 'number') {
        if (!numeric(type))
          this.c.report(node, DiagnosticId.CS1503, [i + 1, typeText(type), 'double']);
      }
      else if (target === 'array') {
        if (!type.endsWith('[]'))
          this.c.report(node, DiagnosticId.CS1503, [i + 1, typeText(type), 'System.Array']);
      }
      else if (target && target !== 'any' && target !== 'exception')
        this.checkAssign(target, type, node.args[Math.max(0, i - (count - node.args.length))] ?? node);
    });
    this.emit(Op.BUILTIN,
      builtin.name === 'object.GetType' && ['int', 'double', 'bool', 'long'].includes(types[0])
        ? BuiltinMap.get('$type.' + types[0] + '.GetType').id
        : builtin.name === 'Math.Abs' && types[0] === 'int' ? BuiltinMap.get('$Math.Abs.Int32').id : builtin.id,
      count);
    return builtin.result === 'numeric' ? (types.includes('double') ? 'double' : 'int') : builtin.result;
  }
  const method = this.findMethod(node);
  let count = node.args.length;
  if (method && !method.isStatic) {
    if (node.target.kind === 'Member')
      this.expr(node.target.target);
    else
      this.emit(Op.LDLOC, this.lookup('this')?.slot ?? 0);
    count++;
  }
  node.args.forEach((arg, i) => {
    const type = this.typedExpr(arg, method?.parameters[i]?.type);
    if (method)
      this.checkAssign(method.parameters[i]?.type ?? 'error', type, arg);
  });
  if (method) {
    if (method.symbol) {
      this.c.reference(node.target, method.symbol);
      const reference = this.c.references.at(-1);
      reference.call = true;
      reference.callerId = this.m.symbol?.id ?? null;
    }
    this.emit(Op.CALL, method.id, count);
    return method.returnType;
  }
  for (let i = 0; i < count; i++)
    this.emit(Op.POP);
  this.emitConstant(null);
  return 'error';
}
