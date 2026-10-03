/**
 * Target-typed expressions (SF-A02-T71): `new()` (C# 9), the conditional operator without a natural type (C# 9) and
 * the switch expression without a best common type (C# 8). Each is bound to a typeless node that carries
 * `convert(to)` (does an implicit conversion to `to` exist?) and `materialize(to)` (the typed node); the conversion
 * binder (./body/conversions.js) calls them once a target type is known.
 *
 * A conditional or switch expression that has a natural type never takes this path, so code that compiled before
 * C# 9 keeps its meaning: `short s = b ? 1 : 2;` is still CS0266 although both arms convert to `short`.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { TypeKind, ArrayTypeSymbol } from '../symbols/types.js';
import { Conversion, ConversionKind } from '../conversions/classify.js';
import { stripNullable } from '../conversions/nullable.js';

/** The types `new()` can never create (Roslyn ERR_ImplicitObjectCreationIllegalTargetType). */
const isIllegalNewTarget = type =>
  type instanceof ArrayTypeSymbol ||
  type.typeKind === TypeKind.Pointer ||
  type.typeKind === TypeKind.FunctionPointer ||
  type.typeKind === TypeKind.Dynamic;

const versionText = version => (Number.isInteger(version.number) && version.number >= 7 ? version.number + '.0' : String(version.number));

/** Class mixin: target-typed `new()`, conditional and switch expressions. */
export const TargetTypedBinding = Base =>
  class extends Base {
    /** `new(args) { initializer }`: every type is a candidate target; what cannot be created is reported when it is. */
    implicitCreation(syntax) {
      const args = this.arguments(syntax.argumentList);
      return this.node('ImplicitNew', syntax, null, {
        form: 'implicitNew',
        args,
        convert: () => new Conversion(ConversionKind.ObjectCreation),
        materialize: to => this.createFromTarget(stripNullable(to), args, syntax),
      });
    }
    createFromTarget(type, args, syntax) {
      if (isIllegalNewTarget(type)) {
        this.report(syntax, DiagnosticId.CS8752, [this.display(type)]);
        if (syntax.initializer) this.initializerSilently(syntax.initializer);
        return this.bad(syntax);
      }
      return this.create(type, args, syntax, syntax, syntax.initializer);
    }
    materializeNew(e, type) {
      return e.materialize(type);
    }
    /** `c ? a : b` whose arms have no common type: converts to any type both arms convert to. */
    targetTypedConditional(syntax, condition, a, b) {
      const arms = [a, b];
      const n = this.node('Conditional', syntax, null, { condition, whenTrue: a, whenFalse: b, form: 'implicitNew' });
      n.convert = to => (arms.every(arm => this.convertsImplicitly(arm, to)) ? new Conversion(ConversionKind.Identity) : null);
      n.noNaturalType = { left: a, right: b };
      n.isTargetTypedConditional = true;
      n.targetArms = arms;
      n.materialize = to => {
        if (this.version.number < 9)
          this.report(syntax, DiagnosticId.CS8957, [versionText(this.version), this.operandDisplay(a), this.operandDisplay(b), '9.0']);
        const [whenTrue, whenFalse] = arms.map(arm => this.convertArm(arm, to));
        return this.node('Conditional', syntax, to, { condition, whenTrue, whenFalse });
      };
      return n;
    }
    /** A switch expression whose arms have no best common type: converts to any type every arm converts to. */
    targetTypedSwitch(syntax, governing, arms) {
      const values = arms.map(arm => arm.value);
      const n = this.node('SwitchExpression', syntax, null, { governing, arms, form: 'implicitNew' });
      n.convert = to => (values.every(v => this.convertsImplicitly(v, to)) ? new Conversion(ConversionKind.Identity) : null);
      n.isTargetTypedSwitch = true;
      n.targetArms = values;
      n.materialize = to =>
        this.node('SwitchExpression', syntax, to, { governing, arms: arms.map(arm => ({ ...arm, value: this.convertArm(arm.value, to) })) });
      return n;
    }
    convertsImplicitly(e, to) {
      const c = this.conversions.classifyFromExpression(e, to);
      return c.exists && c.isImplicit;
    }
    /** Converts one arm to the target type; a lambda arm is bound for the delegate type it was converted to. */
    convertArm(arm, to) {
      const converted = this.convert(arm, to);
      if (arm.form === 'lambda' && !converted.hasErrors) this.finishLambda(arm, to);
      return converted;
    }
    /**
     * Reports why a target-typed expression does not convert to `type`: each arm that has no conversion gets its own
     * diagnostic, as in Roslyn. Returns false when `e` is not a target-typed conditional or switch expression.
     */
    reportTargetTypedFailure(e, type) {
      if (!e.targetArms) return false;
      for (const arm of e.targetArms) if (!this.convertsImplicitly(arm, type)) this.convert(arm, type);
      return true;
    }
    /**
     * An expression used where no target type exists (a receiver, an operand) must have a type of its own:
     * reports CS8754, CS0173 or CS8506 for a typeless target-typed expression and returns a Bad node, else returns `e`.
     */
    requireNaturalType(e) {
      if (e.hasErrors || e.type) return e;
      if (e.kind === 'ImplicitNew') this.report(e.syntax, DiagnosticId.CS8754, ['new()']);
      else if (e.isTargetTypedConditional)
        this.report(e.syntax, DiagnosticId.CS0173, [this.operandDisplay(e.noNaturalType.left), this.operandDisplay(e.noNaturalType.right)]);
      else if (e.isTargetTypedSwitch) this.report(e.syntax.switchKeyword ?? e.syntax, DiagnosticId.CS8506);
      else if (e.form === 'collection') this.report(e.syntax, DiagnosticId.CS9176);
      else return e;
      return this.bad(e.syntax);
    }
  };
