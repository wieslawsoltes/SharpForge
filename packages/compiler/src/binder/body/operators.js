/**
 * Casts, unary and binary operators (with constant folding), assignment in all its forms, increment,
 * the conditional operator and null-coalescing.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { RefKind, TypeKind, ErrorTypeSymbol, TypeParameterSymbol } from '../../symbols/types.js';
import { ConstantValue, isFoldError } from '../../constants/constant-value.js';
import { foldUnary, foldBinary } from '../../constants/fold.js';
import { Conversion, ConversionKind } from '../../conversions/classify.js';
import { isNullableType, stripNullable, acceptsNullLiteral } from '../../conversions/nullable.js';
import { isAccessible } from '../accessibility.js';
import { checkWritable } from '../ref-kinds.js';

const unknown = ErrorTypeSymbol.unknown;

/** Class mixin: Casts, unary and binary operators (with constant folding), assignment in all its forms, increment, */
export const OperatorBinding = Base =>
  class extends Base {
    cast(syntax) {
      const type = this.bindType(syntax.type).type,
        e = this.value(syntax.expression);
      if (type.isErrorType() || e.hasErrors) return this.bad(syntax);
      if (e.form === 'lambda' || e.kind === 'MethodGroup' || e.form === 'implicitNew') {
        const c = this.convert(e, type, syntax);
        if (e.form === 'lambda' && !c.hasErrors) this.finishLambda(e, type);
        return c;
      }
      if (type.isStatic && type.typeKind === TypeKind.Class) {
        this.report(syntax, DiagnosticId.CS0716, [this.display(type)]);
        return this.bad(syntax);
      }
      const c = this.conversions.classifyCastFromExpression(e, type);
      if (!c.exists) {
        if (e.literal === 'null') this.report(syntax, DiagnosticId.CS0037, [this.display(type)]);
        else if (e.constantValue && !e.constantValue.isNull && e.type && this.conversions.kindOf(e.type) && this.conversions.kindOf(type))
          this.report(syntax, DiagnosticId.CS0030, [this.display(e.type), this.display(type)]);
        else this.report(syntax, DiagnosticId.CS0030, [e.type ? this.display(e.type) : (e.literal ?? '?'), this.display(type)]);
        return this.bad(syntax);
      }
      if (c.isAmbiguous) {
        this.report(syntax, DiagnosticId.CS0457, [
          c.candidates[0].toDisplayString(),
          c.candidates[1]?.toDisplayString() ?? '',
          this.display(e.type),
          this.display(type),
        ]);
        return this.bad(syntax);
      }
      return this.applyConversion(e, type, this.checkedConversion(c), syntax, true);
    }
    unary(syntax, operator) {
      // `-2147483648` and `-9223372036854775808` are literals in their own right.
      if (operator === '-' && syntax.operand.kind === 'NumericLiteralExpression') {
        const v = syntax.operand.token.value;
        if (
          v &&
          ((v.type === 'uint' && BigInt(v.value) === 2147483648n && !/[uUlL]/.test(syntax.operand.token.text)) ||
            (v.type === 'ulong' && BigInt(v.value) === 9223372036854775808n && !/[uU]/.test(syntax.operand.token.text)))
        ) {
          const isInt = v.type === 'uint',
            n = this.node('Literal', syntax, isInt ? this.core.int : this.core.long);
          n.constantValue = isInt ? ConstantValue.int(-2147483648) : ConstantValue.long(-9223372036854775808n);
          return n;
        }
      }
      const operand = this.value(syntax.operand);
      if (operand.hasErrors) return this.bad(syntax, { operand });
      const r = this.resolveUnaryOperator(operator, operand);
      if (r.kind === 'error') {
        if (!r.suppressed) this.report(r.atOperator ? syntax.operatorToken : syntax, r.code, r.args);
        return this.bad(syntax);
      }
      if (r.kind === 'user') return this.node('Unary', syntax, r.resultType, { operator, operand, method: r.method, isLifted: r.isLifted });
      const converted = operand.type && r.leftType && !operand.type.equals(r.leftType) ? this.convert(operand, r.leftType) : operand,
        n = this.node('Unary', syntax, r.resultType, { operator, operand: converted, isLifted: r.isLifted, isChecked: this.checked });
      if (converted.constantValue && !r.isLifted) {
        const folded = foldUnary(operator, converted.constantValue, { checked: !this.uncheckedContext });
        if (isFoldError(folded)) {
          this.report(syntax, folded.error.code, folded.error.args);
          n.hasErrors = true;
        } else if (folded) n.constantValue = folded;
      }
      return n;
    }
    /** Operator resolution for bound operands; binder/extension-members.js adds the extension operators in scope. */
    resolveUnaryOperator(operator, operand) {
      return this.d.operators.unary(operator, operand, { isChecked: this.checked });
    }
    resolveBinaryOperator(operator, left, right) {
      return this.d.operators.binary(operator, left, right, { isChecked: this.checked });
    }
    binary(syntax, operator) {
      const left = this.value(syntax.left),
        right = this.value(syntax.right);
      if (left.hasErrors || right.hasErrors) return this.bad(syntax, { left, right });
      return this.binaryOperation(syntax, operator, left, right);
    }
    /**
     * Delegate combination and removal (`d + handler`, `d - handler`): the other operand converts to the delegate
     * type, so a method group or a lambda is accepted (SF-A02-T07.1).
     */
    delegateOperation(syntax, operator, left, right) {
      if (operator !== '+' && operator !== '-') return null;
      const type = [left, right].map(e => e.type).find(t => t?.typeKind === TypeKind.Delegate);
      if (!type) return null;
      // A typed operand that is not a delegate of that type leaves the operator to overload resolution: `text + handler`
      // is string concatenation.
      const fits = e => !e.type || e.type.equals(type) || this.conversions.classifyFromExpression(e, type).isImplicit;
      if (!fits(left) || !fits(right)) return null;
      const operands = [left, right].map(e => {
        const converted = this.convert(e, type, e.syntax);
        if (e.form === 'lambda' && !converted.hasErrors) this.finishLambda(e, type);
        return converted;
      });
      if (operands.some(e => e.hasErrors)) return this.bad(syntax);
      return this.node('Binary', syntax, type, { operator, left: operands[0], right: operands[1], family: 'delegate' });
    }
    /**
     * `handler == Method` and `Method != handler`: a method group compared with a delegate converts to the delegate
     * type, and the two delegates are compared. @returns {[object, object]} the operands, converted where that applies
     */
    delegateComparisonOperands(operator, left, right) {
      if (operator !== '==' && operator !== '!=') return [left, right];
      const group = [left, right].find(e => e.kind === 'MethodGroup'),
        other = group === left ? right : left;
      if (!group || other.type?.typeKind !== TypeKind.Delegate) return [left, right];
      if (!this.conversions.classifyFromExpression(group, other.type).isImplicit) return [left, right];
      const converted = this.convert(group, other.type, group.syntax);
      return group === left ? [converted, right] : [left, converted];
    }
    binaryOperation(syntax, operator, left, right) {
      const delegate = this.delegateOperation(syntax, operator, left, right);
      if (delegate) return delegate;
      [left, right] = this.delegateComparisonOperands(operator, left, right);
      if (left.hasErrors || right.hasErrors) return this.bad(syntax);
      const tuple = this.tupleEquality(syntax, operator, left, right);
      if (tuple) return tuple;
      for (const e of [left, right])
        if (e.kind === 'MethodGroup' || e.form === 'lambda' || e.type?.specialType === 'System_Void') {
          this.report(syntax, DiagnosticId.CS0019, [operator, this.operandDisplay(left), this.operandDisplay(right)]);
          return this.bad(syntax);
        }
      const r = this.resolveBinaryOperator(operator, left, right);
      if (r.kind === 'error') {
        if (!r.suppressed) this.report(r.atOperator ? syntax.operatorToken : syntax, r.code, r.args);
        return this.bad(syntax);
      }
      if (r.kind === 'user') {
        const args = r.conversions
          ? [left, right].map((e, i) => (e.type ? this.applyConversion(e, r.method.parameters[i].type, r.conversions[i]) : e))
          : [left, right];
        return this.node('Binary', syntax, r.isLogical ? r.method.returnType : r.resultType, {
          operator,
          left: args[0],
          right: args[1],
          method: r.method,
          isLifted: r.isLifted,
          isLogical: !!r.isLogical,
          shortCircuit: r.shortCircuitOperator ?? null,
        });
      }
      const l = this.operand(left, r.leftType),
        rt = this.operand(right, r.rightType),
        n = this.node('Binary', syntax, r.resultType, {
          operator,
          left: l,
          right: rt,
          family: r.family,
          isLifted: r.isLifted,
          isChecked: this.checked,
          operandKind: r.operandKind ?? null,
        });
      if (r.family === 'tuple') this.d.gate(this.c.uri, syntax, 'tupleEquality', { name: 'tuple equality', version: 7.3 });
      if (l.constantValue && rt.constantValue && !r.isLifted && !l.hasErrors && !rt.hasErrors) {
        const folded = foldBinary(operator, l.constantValue, rt.constantValue, { checked: !this.uncheckedContext });
        if (isFoldError(folded)) {
          this.report(syntax, folded.error.code, folded.error.args);
          n.hasErrors = true;
        } else if (folded) n.constantValue = folded;
      }
      return n;
    }
    assignment(syntax) {
      if (syntax.operatorToken.text === '=' && this.isDeconstructionTarget(syntax.left)) return this.deconstruction(syntax);
      return this.assignmentTo(syntax, this.expression(syntax.left, { allowDiscard: true }));
    }
    /** Binds the assignment `syntax` to an already bound target: the target of `a?.b = c` is bound on the receiver of the access. */
    assignmentTo(syntax, left) {
      const operator = syntax.operatorToken.text;
      if (left.kind === 'Discard') {
        const v = this.value(syntax.right);
        return this.node('Assignment', syntax, v.type, { left, right: v });
      }
      if (left.kind === 'TypeExpression' || left.kind === 'NamespaceExpression') {
        this.asValue(left);
        this.value(syntax.right);
        return this.bad(syntax);
      }
      if (left.hasErrors) {
        this.value(syntax.right);
        return this.bad(syntax);
      }
      if (left.kind === 'MethodGroup') {
        this.report(syntax.left, DiagnosticId.CS1656, [left.name, 'method group']);
        this.value(syntax.right);
        return this.bad(syntax);
      }
      const isRefAssign = syntax.right.kind === 'RefExpression';
      if (left.kind === 'EventAccess' && (operator === '+=' || operator === '-=')) {
        const handler = this.value(syntax.right),
          converted = this.convert(handler, left.type, syntax.right);
        if (handler.form === 'lambda' && !converted.hasErrors) this.finishLambda(handler, left.type);
        return this.node('EventAssignment', syntax, this.core.void, {
          event: left.event,
          receiver: left.receiver,
          operator,
          handler: converted,
        });
      }
      if (left.kind === 'EventAccess' && !this.inDeclaringType(left.event)) {
        this.report(syntax.left.kind === 'SimpleMemberAccessExpression' ? syntax.left.name : syntax.left, DiagnosticId.CS0070, [
          left.event.toDisplayString(),
          this.display(left.event.containingType),
        ]);
        this.value(syntax.right);
        return this.bad(syntax);
      }
      if (this.hasInaccessibleSetter(left)) {
        this.reportInaccessibleSetter(left, syntax.left);
        this.value(syntax.right);
        return this.bad(syntax);
      }
      const writable = checkWritable(left, operator === '=' ? 'assignment' : 'compound', this.variableContext);
      // A ref iteration variable of a foreach denotes the current element for the whole iteration (CS1656).
      if (isRefAssign && left.kind === 'Local' && left.local.isForEach) {
        this.report(syntax.left, DiagnosticId.CS1656, [left.local.name, left.local.readOnlyReason]);
        this.value(syntax.right);
        return this.bad(syntax);
      }
      if (writable && !(isRefAssign && left.kind === 'Local' && left.local.refKind !== RefKind.None)) {
        // CS1612 points at the struct-valued expression whose member cannot be modified.
        const target = writable.code === DiagnosticId.CS1612 && left.receiver?.syntax ? left.receiver.syntax : syntax.left;
        this.report(target, writable.code, writable.args);
        this.markRead(left);
        this.value(syntax.right);
        return this.bad(syntax);
      }
      if (operator === '=') {
        let right = this.value(syntax.right);
        if (isRefAssign) {
          this.d.gate(this.c.uri, syntax, 'refReassignment', { name: 'ref reassignment', version: 7.3 });
          this.markWrite(left, right);
          return this.node('RefAssignment', syntax, left.type, { left, right: right.operand ?? right });
        }
        if (right.form === 'implicitNew' && left.type) right = this.materializeNew(right, left.type);
        const converted = left.type ? this.convert(right, left.type, syntax.right) : right;
        if (right.form === 'lambda' && !converted.hasErrors && left.type) this.finishLambda(right, left.type);
        this.markWrite(left, right);
        if (this.sameVariable(left, right)) this.report(syntax, DiagnosticId.CS1717);
        return this.node('Assignment', syntax, left.type, { left, right: converted, hasErrors: converted.hasErrors });
      }
      if (operator === '??=') {
        const right = this.value(syntax.right);
        this.markRead(left);
        this.markWrite(left, right);
        if (right.hasErrors) return this.bad(syntax);
        if (left.type && !acceptsNullLiteral(left.type) && !(left.type instanceof TypeParameterSymbol && left.type.isValueType !== true)) {
          this.report(syntax, DiagnosticId.CS0019, ['??=', this.display(left.type), this.operandDisplay(right)]);
          return this.bad(syntax);
        }
        const underlying = isNullableType(left.type) ? stripNullable(left.type) : null,
          asUnderlying = underlying ? this.conversions.classifyFromExpression(right, underlying) : null;
        if (asUnderlying?.exists && asUnderlying.isImplicit)
          return this.node('CoalesceAssignment', syntax, underlying, {
            left,
            right: this.applyConversion(right, underlying, asUnderlying),
          });
        const toLeft = this.conversions.classifyFromExpression(right, left.type);
        if (left.type && !left.type.isErrorType() && !(toLeft.exists && toLeft.isImplicit)) {
          // Like `??`, the operator as a whole does not apply: the right operand is not reported on its own.
          this.report(syntax, DiagnosticId.CS0019, ['??=', this.display(left.type), this.operandDisplay(right)]);
          return this.bad(syntax);
        }
        return this.node('CoalesceAssignment', syntax, left.type, { left, right: this.convert(right, left.type, syntax.right) });
      }
      // Compound assignment: x op= y is x = (T)(x op y) with x evaluated once.
      const op = operator.slice(0, -1),
        right = this.value(syntax.right);
      this.markRead(left);
      this.markWrite(left, null);
      if (left.kind === 'Local') left.local.nonConstantWrite = true;
      if (right.hasErrors) return this.bad(syntax);
      const result = this.binaryOperation(syntax, op, left, right);
      if (result.hasErrors) return this.bad(syntax);
      if (left.type && result.type && !result.type.equals(left.type)) {
        const implicit = this.conversions.classifyImplicit(result.type, left.type);
        if (!implicit.exists) {
          // Predefined operators allow the implicit narrowing back (`byte b += 1`) when the right operand converts to the left type.
          const explicit = this.conversions.classifyExplicit(result.type, left.type),
            rightOk = this.conversions.classifyFromExpression(right, left.type);
          if (!(
            result.method === undefined &&
            explicit.exists &&
            ((rightOk.exists && rightOk.isImplicit) || ['<<', '>>', '>>>'].includes(op))
          )) {
            this.report(syntax, explicit.exists ? DiagnosticId.CS0266 : DiagnosticId.CS0029, [this.display(result.type), this.display(left.type)]);
            return this.bad(syntax);
          }
        }
      }
      return this.node('CompoundAssignment', syntax, left.type, {
        left,
        right: result.right,
        operator: op,
        method: result.method ?? null,
        isChecked: this.checked,
        operation: result,
      });
    }
    inDeclaringType(member) {
      for (let t = this.c.containingType; t; t = t.containingType)
        if (t.originalDefinition === member.containingType?.originalDefinition) return true;
      return false;
    }
    sameVariable(a, b) {
      if (a.kind !== b.kind) return false;
      if (a.kind === 'Local') return a.local === b.local;
      if (a.kind === 'Parameter') return a.parameter === b.parameter;
      if (a.kind === 'FieldAccess')
        return a.field === b.field && ((!a.receiver && !b.receiver) || (a.receiver?.kind === 'This' && b.receiver?.kind === 'This'));
      return false;
    }
    /** True for a property or indexer whose set accessor is less accessible than the property and not accessible here. */
    hasInaccessibleSetter(target) {
      if (target.kind !== 'PropertyAccess' && target.kind !== 'IndexerAccess') return false;
      const setter = target.property.setMethod;
      if (!setter || setter.declaredAccessibility === target.property.declaredAccessibility) return false;
      const within = this.c.containingType?.originalDefinition ?? null,
        // A protected set accessor is only accessible through a receiver of the accessing class (`base.P` always is).
        throughType = target.receiver && target.receiver.kind !== 'Base' ? target.receiver.type : null;
      return !isAccessible(setter.originalDefinition ?? setter, within, { withinModule: this.d.assembly.module, throughType });
    }
    increment(syntax) {
      const operator = syntax.operatorToken.text,
        operand = this.expression(syntax.operand);
      if (operand.hasErrors) return this.bad(syntax);
      if (this.hasInaccessibleSetter(operand)) {
        this.report(syntax.operand, DiagnosticId.CS0272, [operand.property.toDisplayString()]);
        return this.bad(syntax);
      }
      if (operand.kind === 'TypeExpression' || operand.kind === 'NamespaceExpression') {
        this.asValue(operand);
        return this.bad(syntax);
      }
      const w = checkWritable(operand, 'increment', this.variableContext);
      if (w) {
        this.report(syntax.operand, w.code === DiagnosticId.CS0131 ? DiagnosticId.CS1059 : w.code, w.args);
        return this.bad(syntax);
      }
      this.markRead(operand);
      this.markWrite(operand, null);
      if (operand.kind === 'Local') operand.local.nonConstantWrite = true;
      const r = this.resolveUnaryOperator(operator, operand);
      if (r.kind === 'error') {
        if (!r.suppressed) this.report(r.atOperator ? syntax.operatorToken : syntax, r.code, r.args);
        return this.bad(syntax);
      }
      return this.node('Increment', syntax, operand.type, {
        operator,
        operand,
        isPostfix: syntax.kind.startsWith('Post'),
        method: r.method ?? null,
        isChecked: this.checked,
      });
    }
    conditional(syntax) {
      const condition = this.condition(syntax.condition),
        refTrue = syntax.whenTrue.kind === 'RefExpression',
        refFalse = syntax.whenFalse.kind === 'RefExpression';
      let a = this.value(refTrue ? syntax.whenTrue.expression : syntax.whenTrue),
        b = this.value(refFalse ? syntax.whenFalse.expression : syntax.whenFalse);
      if (a.hasErrors || b.hasErrors || condition.hasErrors) return this.bad(syntax);
      if (refTrue || refFalse) return this.node('RefConditional', syntax, a.type, { condition, whenTrue: a, whenFalse: b, isRef: true });
      let type = null;
      if (a.type && b.type && a.type.equals(b.type)) type = a.type;
      else {
        const toB = b.type ? this.conversions.classifyFromExpression(a, b.type) : null,
          toA = a.type ? this.conversions.classifyFromExpression(b, a.type) : null,
          x = toB?.exists && toB.isImplicit,
          y = toA?.exists && toA.isImplicit;
        if (x && !y) type = b.type;
        else if (y && !x) type = a.type;
        else if (x && y) type = b.type.typeKind === TypeKind.Dynamic || (a.constantValue && !b.constantValue) ? b.type : a.type;
      }
      if (!type) return this.targetTypedConditional(syntax, condition, a, b);
      const n = this.node('Conditional', syntax, type, { condition, whenTrue: this.convert(a, type), whenFalse: this.convert(b, type) });
      if (condition.constantValue && n.whenTrue.constantValue && n.whenFalse.constantValue)
        n.constantValue = condition.constantValue.value ? n.whenTrue.constantValue : n.whenFalse.constantValue;
      return n;
    }
    coalesce(syntax) {
      const left = this.requireNaturalType(this.value(syntax.left)),
        right = this.value(syntax.right);
      if (left.hasErrors || right.hasErrors) return this.bad(syntax);
      const fail = () => {
        this.report(syntax, DiagnosticId.CS0019, ['??', this.operandDisplay(left), this.operandDisplay(right)]);
        return this.bad(syntax);
      };
      if (left.literal === 'null') return right.type ? this.node('Coalesce', syntax, right.type, { left, right }) : fail();
      const a = left.type;
      if (!a || left.kind === 'MethodGroup' || left.form === 'lambda') return fail();
      if (a.isValueType === true && !isNullableType(a)) return fail();
      if (right.form === 'throw') return this.node('Coalesce', syntax, isNullableType(a) ? stripNullable(a) : a, { left, right });
      if (isNullableType(a)) {
        const a0 = stripNullable(a),
          c = this.conversions.classifyFromExpression(right, a0);
        if (c.exists && c.isImplicit) return this.node('Coalesce', syntax, a0, { left, right: this.applyConversion(right, a0, c) });
      }
      const toA = this.conversions.classifyFromExpression(right, a);
      if (toA.exists && toA.isImplicit) return this.node('Coalesce', syntax, a, { left, right: this.applyConversion(right, a, toA) });
      if (right.type) {
        const a0 = isNullableType(a) ? stripNullable(a) : a,
          toB = this.conversions.classifyImplicit(a0, right.type);
        if (toB.exists) return this.node('Coalesce', syntax, right.type, { left, right, leftConversion: toB });
      }
      return fail();
    }
  };
