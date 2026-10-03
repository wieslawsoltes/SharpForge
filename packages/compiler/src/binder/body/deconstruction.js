/**
 * Deconstructing assignments and declarations (SF-A02-T08.5): `(a, b) = e`, `var (a, b) = e`, `(int a, var b) = e`,
 * nested and mixed forms (C# 10) and discards.
 *
 * The bound node is `DeconstructionAssignment {left, right, plan}`. `left` is a `Tuple` of targets - assignable
 * expressions, `DeclarationExpression`s for declared variables, `Discard`s and nested `Tuple`s. `plan` mirrors it:
 *   `{kind: 'literal', parts}`                      the right side is a tuple literal, split element by element
 *   `{kind: 'tuple', type, parts}`                  a tuple value, split into its elements
 *   `{kind: 'method', type, method, isExtension, parts}`  split by a `Deconstruct` method
 *   `{kind: 'leaf', target, type, sourceType, conversion}`  one part stored into one target; `conversion` is null
 *                                                   when the part is stored as it is (a discard, an inferred variable)
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { ErrorTypeSymbol } from '../../symbols/types.js';
import { LocalDeclarationKind } from '../../symbols/members.js';
import { checkWritable } from '../ref-kinds.js';
import { deconstructionOf } from '../deconstruction.js';
import { tupleElements, tupleTypeOf } from '../tuples.js';

const unknown = ErrorTypeSymbol.unknown;

/** Class mixin: deconstruction. */
export const DeconstructionBinding = Base =>
  class extends Base {
    /** True for the left side of an assignment that deconstructs: a tuple, or `var (a, b)`. */
    isDeconstructionTarget(syntax) {
      return syntax.kind === 'TupleExpression' || (syntax.kind === 'DeclarationExpression' && syntax.designation.kind === 'ParenthesizedVariableDesignation');
    }
    deconstruction(syntax) {
      const left = this.deconstructionTarget(syntax.left),
        right = this.value(syntax.right);
      if (right.hasErrors || left.hasErrors) return this.bad(syntax, { left, right });
      const failure = { isArity: false },
        plan = this.deconstructionPlan(left, { type: right.type, value: right, syntax: syntax.right, whole: syntax, failure });
      if (!plan) {
        // Nothing is inferred from a value that does not split (Roslyn reports every `var` variable, except for a wrong count).
        if (!failure.isArity) this.reportUninferredVariables(left);
        return this.bad(syntax, { left, right });
      }
      return this.node('DeconstructionAssignment', syntax, this.targetsType(left), { left, right, plan });
    }
    /**
     * `foreach ((targets) in collection) body`: a foreach over a hidden iteration variable whose body first
     * deconstructs that variable into the targets. `enumeration` carries what binder/body/flow-statements.js found
     * out about the collection.
     */
    forEachDeconstruction(syntax, enumeration) {
      const elementType = enumeration.elementType,
        item = this.newLocal('<item>', elementType, syntax.variable, LocalDeclarationKind.Foreach);
      item.reads++;
      item.writes++;
      item.nonConstantWrite = true;
      const left = this.deconstructionTarget(syntax.variable),
        value = this.node('Local', syntax.variable, elementType, { local: item }),
        failure = { isArity: false };
      const declaresAll = target =>
        target.kind === 'Tuple' ? target.elements.every(declaresAll) : target.kind === 'DeclarationExpression' || target.kind === 'Discard';
      if (!left.hasErrors && !declaresAll(left)) this.report(syntax.variable, DiagnosticId.CS8186);
      let split = this.bad(syntax.variable, { left });
      if (!left.hasErrors && !elementType.isErrorType()) {
        const plan = this.deconstructionPlan(left, { type: elementType, value, syntax: syntax.expression, whole: syntax.variable, failure });
        if (plan) split = this.node('DeconstructionAssignment', syntax.variable, null, { left, right: value, plan });
        else if (!failure.isArity) this.reportUninferredVariables(left);
      }
      const loop = this.enterLoop(),
        body = this.embedded(syntax.statement);
      this.exitLoop();
      const assign = { kind: 'ExpressionStatement', syntax: syntax.variable, completes: true, expression: split },
        block = { kind: 'Block', syntax: syntax.statement, completes: body.completes, statements: [assign, body] };
      return { kind: 'ForEach', syntax, completes: true, ...enumeration, local: item, body: block, loop, isAwait: !!syntax.awaitKeyword };
    }
    /** The targets of a deconstruction as a `Tuple` node of targets. */
    deconstructionTarget(syntax) {
      if (syntax.kind === 'TupleExpression') {
        const elements = syntax.arguments.map(argument => this.deconstructionTarget(argument.expression));
        return this.node('Tuple', syntax, null, { elements, isDeconstructionTarget: true, hasErrors: elements.some(e => e.hasErrors) });
      }
      if (syntax.kind === 'DeclarationExpression') {
        const bound = this.bindType(syntax.type, { allowVar: true });
        if (syntax.designation.kind === 'ParenthesizedVariableDesignation' && !bound.isVar) this.report(syntax.type, DiagnosticId.CS8136);
        return this.designatedTarget(syntax.designation, bound.isVar ? null : bound.type, syntax);
      }
      const target = this.expression(syntax, { allowDiscard: true });
      if (target.kind === 'Discard' || target.hasErrors) return target;
      const problem = checkWritable(target, 'assignment', this.variableContext);
      if (problem) {
        this.report(syntax, problem.code, problem.args);
        return this.bad(syntax);
      }
      this.markWrite(target, null);
      return target;
    }
    /** `x`, `_` or `(x, (y, _))` after `var` or a type: declared variables (`type` null means inferred). */
    designatedTarget(designation, type, syntax) {
      switch (designation.kind) {
        case 'DiscardDesignation':
          return this.node('Discard', designation, type, { isOutVarOrDiscard: true });
        case 'SingleVariableDesignation': {
          const name = designation.identifier.valueText,
            local = this.newLocal(name, type ?? unknown, designation.identifier, LocalDeclarationKind.Out);
          local.writes++;
          local.nonConstantWrite = true;
          local.isDeconstructionVariable = true;
          this.declare(name, local, designation.identifier);
          return this.node('DeclarationExpression', syntax ?? designation, type, { local, isOutVarOrDiscard: true, isInferred: !type });
        }
        default: {
          const elements = designation.variables.map(variable => this.designatedTarget(variable, null, null));
          return this.node('Tuple', designation, null, { elements, isDeconstructionTarget: true });
        }
      }
    }
    /** With too few parts, the variables beyond the last part have nothing to be inferred from. */
    reportSurplusVariables(target, partCount) {
      for (const element of target.elements.slice(partCount)) this.reportUninferredVariables(element);
    }
    reportUninferredVariables(target) {
      if (target.kind === 'DeclarationExpression' && target.isInferred) this.report(target.local.syntax, DiagnosticId.CS8130, [target.local.name]);
      for (const element of target.elements ?? []) this.reportUninferredVariables(element);
    }
    /**
     * The plan that splits a value into the targets, or null after reporting why it cannot be split.
     * @param target a target node
     * @param source `{type, value, syntax, whole, failure}`: the type of the value, its bound expression when it has
     *   one, where to report, the whole deconstruction and the record of what failed
     */
    deconstructionPlan(target, source) {
      if (target.kind !== 'Tuple') return this.deconstructionLeaf(target, source);
      const { type, value, syntax, failure } = source,
        count = target.elements.length,
        part = (index, partType, element) =>
          this.deconstructionPlan(target.elements[index], { ...source, type: partType, value: element, syntax: element?.syntax ?? syntax });
      if (value?.kind === 'Tuple') {
        if (value.elements.length !== count) {
          failure.isArity = true;
          this.report(source.whole, DiagnosticId.CS8132, [value.elements.length, count]);
          this.reportSurplusVariables(target, value.elements.length);
          return null;
        }
        const parts = value.elements.map((element, index) => part(index, element.type, element));
        return parts.includes(null) ? null : { kind: 'literal', parts };
      }
      if (!type || type.isErrorType()) {
        if (!type) this.report(syntax, DiagnosticId.CS8131);
        return null;
      }
      const receiver = value ?? this.node('DeconstructionValue', syntax, type, {});
      const split = deconstructionOf(this, type, count, receiver);
      if (split.error) {
        failure.isArity = !!split.isArity;
        for (const problem of split.error) this.report(split.isArity ? source.whole : syntax, problem.code, problem.args);
        if (split.isArity) this.reportSurplusVariables(target, tupleElements(type).length);
        return null;
      }
      const parts = split.partTypes.map((partType, index) => part(index, partType, null));
      if (parts.includes(null)) return null;
      return { kind: split.kind, type, method: split.method ?? null, isExtension: !!split.isExtension, parts };
    }
    deconstructionLeaf(target, { type, value, syntax }) {
      if (target.kind === 'DeclarationExpression' && target.isInferred) {
        if (!type || type.specialType === 'System_Void') return null;
        target.local.setType(type);
        target.type = type;
        return { kind: 'leaf', target, type, conversion: null };
      }
      const targetType = target.type;
      if (!targetType) return { kind: 'leaf', target, type, conversion: null };
      const part = value ?? this.node('DeconstructionValue', syntax, type, {});
      const conversion = this.conversions.classifyFromExpression(part, targetType);
      if (!conversion.exists || !conversion.isImplicit) {
        // A part of a literal is reported at its element, any other part at the target it does not fit.
        this.reportConversionFailure(part, targetType, value ? syntax : target.syntax, conversion);
        return null;
      }
      return { kind: 'leaf', target, type: targetType, sourceType: type, conversion };
    }
    /** The type of the deconstruction as an expression: the tuple of the target types, when it has one. */
    targetsType(target) {
      if (target.kind !== 'Tuple') return target.type ?? null;
      const types = target.elements.map(element => this.targetsType(element));
      if (types.includes(null)) return null;
      return tupleTypeOf(this.core.bridge, types, []);
    }
  };
