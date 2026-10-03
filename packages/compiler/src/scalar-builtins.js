import {compileLegacyScalarExpression, inferScalarExpression, scalarConditionalType} from './scalar-expressions.js';
import {bindArrayBuiltin, emitArrayBuiltin} from './array-builtins.js';
import {inferMemoryExpression, compileMemoryExpression, compileMemoryConversion} from './memory-expressions.js';
import {ScalarQueries, scalarType, scalarBuiltinFor, scalarStringBuiltin} from './scalar-queries.js';
import {Op, NumericType, numericMode, decimalParse} from '@sharpforge/bytecode';
import {numeric} from './numeric.js';

/** Scalar operations in the legacy compiler, composed explicitly alongside its other compiler layers. */
export const ScalarCompiler = Base => class extends ScalarQueries(Base) {
  scalarString(type) {
    this.emit(Op.BUILTIN, scalarStringBuiltin(type).id, 1);
    return 'string';
  }

  emitScalarCall(node, binding) {
    if (binding.error) { this.emitConstant(null); return 'error'; }
    if (binding.receiver) this.expr(binding.receiver);
    const assigned = [], args = node.args ?? [];
    args.forEach((argument, index) => {
      const target = scalarType(binding.descriptor.parameters[index]);
      if (target.endsWith('&')) {
        this.synchronizationAddress(argument.expression, {out: true});
        if (argument.expression.kind === 'Name') {
          const local = this.lookup(argument.expression.name);
          if (local) assigned.push(local.slot);
        }
      } else this.checkAssign(target, this.typedExpr(argument, target), argument);
    });
    this.emit(Op.BUILTIN, scalarBuiltinFor(binding.descriptor).id, args.length + Number(!!binding.receiver));
    for (const slot of assigned) this.assigned.add(slot);
    return binding.result;
  }

  scalarConditionalType(node) { return scalarConditionalType(this, node); }

  scalarConditional(node, type) {
    this.bool(node.condition);
    const before = new Set(this.assigned), no = this.emit(Op.JFALSE);
    this.checkAssign(type, this.typedExpr(node.whenTrue, type), node.whenTrue);
    const yesAssigned = new Set(this.assigned), done = this.emit(Op.JUMP);
    this.patch(no);
    this.assigned = new Set(before);
    this.checkAssign(type, this.typedExpr(node.whenFalse, type), node.whenFalse);
    this.assigned = new Set([...yesAssigned].filter(slot => this.assigned.has(slot)));
    this.patch(done);
    return type;
  }

  typedExpr(node, type) {
    const memory = compileMemoryConversion(this, node, type);
    if (memory !== undefined) return memory;
    type = scalarType(type);
    if (node?.kind === 'Conditional' && numeric(type)) return this.scalarConditional(node, type);
    const actual = super.typedExpr(node, type);
    if (numeric(type) && numeric(actual) && actual !== type && this.scalarAccepts(node, type, actual)) {
      this.emit(Op.CONVERT, NumericType[type], numericMode(actual, false));
      return type;
    }
    return actual;
  }

  infer(node) {
    const array = bindArrayBuiltin(this, node);
    if (array) return array.result;
    const memory = inferMemoryExpression(this, node);
    if (memory !== undefined) return memory;
    const scalar = inferScalarExpression(this, node);
    if (scalar !== undefined) return scalar;
    const constant = this.scalarConstant(node);
    if (constant) return constant.type;
    if (node?.kind === 'New' && scalarType(node.type) === 'decimal' && node.args.length === 0) return 'decimal';
    const binding = this.scalarBinding(node);
    if (binding) return binding.error ? 'error' : binding.result;
    if (node?.kind === 'Conditional') {
      const type = this.scalarConditionalType(node);
      if (type) return type;
    }
    return super.infer(node);
  }

  expr(node) {
    if (node) {
      const array = bindArrayBuiltin(this, node, true);
      if (array) return emitArrayBuiltin(this, array);
      const memory = compileMemoryExpression(this, node);
      if (memory !== undefined) return memory;
      const scalar = compileLegacyScalarExpression(this, node);
      if (scalar !== undefined) return scalar;
    }
    if (node?.kind === 'Call' && node.args.length === 0 && node.target?.kind === 'Member' && node.target.name === 'ToString') {
      const type = scalarType(this.infer(node.target.target));
      if (numeric(type) && type !== 'decimal') { this.expr(node.target.target); return this.scalarString(type); }
    }
    const constant = this.scalarConstant(node);
    if (constant) { this.emitConstant(constant.value, constant.type); return constant.type; }
    if (node?.kind === 'New' && scalarType(node.type) === 'decimal' && node.args.length === 0) {
      this.emitConstant(decimalParse('0'), 'decimal');
      return 'decimal';
    }
    const binding = this.scalarBinding(node, true);
    if (binding) return this.emitScalarCall(node, binding);
    if (node?.kind === 'Conditional') {
      const type = this.scalarConditionalType(node);
      if (type) return this.scalarConditional(node, type);
    }
    return super.expr(node);
  }
};
