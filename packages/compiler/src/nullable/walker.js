/**
 * The nullable flow walker (SF-A02-T05.4): tracks the null-state of locals, parameters and `this` fields through a
 * method body and reports the nullable-reference warnings, only where the nullable *warning* context is enabled.
 *
 *   CS8600  possible null converted to a non-nullable local      CS8601  possible null assigned to a member
 *   CS8602  dereference of a possibly null reference             CS8603  possible null returned
 *   CS8604  possible null argument                               CS8605  unboxing a possibly null value
 *   CS8618  non-nullable field or property not initialised when a constructor exits
 *   CS8625  null literal converted to a non-nullable reference type
 *
 * A variable is a local, a parameter, a field or property of `this`, a static member, or a member of another variable
 * (`x.Next.Name`). A state maps a variable to 'notNull' or 'maybeNull'; a variable without an entry has the state its declared
 * annotation gives it. Branches join to 'maybeNull' when either side is; `x == null`, `x is null`, `x is T`,
 * `x?.M()`, `x ?? y` and the analysis attributes (nullable/attributes.js) split or refine states. Loops iterate to a
 * fixed point of the state at the loop head, as Roslyn does (nullable/walker-loops.js).
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { NullableConditions } from './walker-conditions.js';
import { NullableConditionalAccess } from './walker-conditional-access.js';
import { NullableMemberSlots } from './walker-member-slots.js';
import { NullableAttributeRules } from './walker-attributes.js';
import { NullableTypeArgumentChecks } from './walker-type-arguments.js';
import { NullableLambdas } from './walker-lambdas.js';
import { NullableLoops } from './walker-loops.js';
import { NullableRules } from './walker-rules.js';
import { NullableUnionFlow } from './union-flow.js';
import { NOT_NULL, MAYBE_NULL, joinStates, FlowState, joinFlow } from './flow-state.js';
import { NullableAnnotation, RefKind, SymbolKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { allowsNull, disallowsNull, argumentStateAfterCall, doesNotReturn, membersNotNullAfterCall, resultState } from './attributes.js';
import { frameworkResultState } from './framework-annotations.js';
import { boundChildren } from '../flow/semantic-assignment.js';

const isReferenceLike = type => !!type && type.isReferenceType === true;

const isAnnotated = typeWithAnnotations => typeWithAnnotations?.nullableAnnotation === NullableAnnotation.Annotated;

const isNotAnnotated = typeWithAnnotations => typeWithAnnotations?.nullableAnnotation === NullableAnnotation.NotAnnotated;

class NullableWalkerCore {
  /**
   * @param host `{ nullableAt(uri, position) }` - the nullable context lookup of the compilation
   * @param {string} uri the file the body belongs to
   */
  constructor(host, uri) {
    this.host = host;
    this.uri = uri;
    this.diagnostics = [];
    this.method = null;
    this.jumpTargets = [];
  }

  /** @returns {{ node: object, code: string, args: any[] }[]} */
  analyze(method, body) {
    this.method = method;
    const end = this.statement(body, new FlowState());
    if (end) this.leaveConstructor(end);
    return this.diagnostics;
  }

  warn(node, code, args = []) {
    const position = node?.span?.start ?? node?.start ?? 0;
    if (!this.host.nullableAt(this.uri, position).warnings) return;
    // One warning per place and subject: a constructor may leave several members uninitialised (CS8618 each).
    if (this.diagnostics.some(d => d.node === node && d.code === code && String(d.args) === String(args))) return;
    this.diagnostics.push({ node, code, args });
  }

  // ---- variables ----

  /** The tracked variable an expression denotes: a local or a parameter (members: nullable/walker-member-slots.js). */
  variableOf(expression) {
    if (!expression) return null;
    if (expression.kind === 'Local') return expression.local;
    if (expression.kind === 'Parameter') return expression.parameter;
    if (expression.kind === 'DeclarationExpression') return expression.local ?? null;
    return null;
  }

  declaredAnnotation(expression) {
    switch (expression.kind) {
      case 'Local':
      case 'DeclarationExpression':
        return expression.local?.declaredAnnotation ?? null;
      case 'Parameter':
        return expression.parameter.typeWithAnnotations?.nullableAnnotation ?? null;
      case 'FieldAccess':
        return expression.field.typeWithAnnotations?.nullableAnnotation ?? null;
      case 'PropertyAccess':
      case 'IndexerAccess':
        return expression.property.typeWithAnnotations?.nullableAnnotation ?? null;
      default:
        return null;
    }
  }

  declaredState(expression) {
    return this.declaredAnnotation(expression) === NullableAnnotation.Annotated ? MAYBE_NULL : NOT_NULL;
  }

  // ---- expressions ----

  /** Walks an expression and returns its null-state. */
  expression(node, flow) {
    if (!node || typeof node !== 'object' || !flow) return NOT_NULL;
    if (node.suppressed) {
      this.expression({ ...node, suppressed: false }, flow);
      return NOT_NULL;
    }
    switch (node.kind) {
      case 'Literal':
        return node.literal === 'null' || (node.literal === 'default' && !node.type) ? MAYBE_NULL : NOT_NULL;
      case 'Default':
        return isReferenceLike(node.type) ? MAYBE_NULL : NOT_NULL;
      case 'Local':
      case 'Parameter':
        return flow.get(this.variableOf(node)) ?? this.declaredState(node);
      case 'FieldAccess':
      case 'PropertyAccess':
        return this.memberAccess(node, flow);
      case 'Call':
      case 'ObjectCreation':
        return this.call(node, flow);
      case 'Assignment':
        return this.assignment(node, flow);
      case 'Conversion':
        return this.conversion(node, flow);
      case 'As':
        this.expression(node.operand, flow);
        return MAYBE_NULL;
      case 'Coalesce': {
        this.expression(node.left, flow);
        return this.expression(node.right, flow.clone());
      }
      case 'Conditional': {
        const branches = this.condition(node.condition, flow);
        const whenTrue = branches.whenTrue ? this.expression(node.whenTrue, branches.whenTrue) : NOT_NULL;
        const whenFalse = branches.whenFalse ? this.expression(node.whenFalse, branches.whenFalse) : NOT_NULL;
        this.replace(flow, joinFlow(branches.whenTrue, branches.whenFalse));
        return joinStates(whenTrue, whenFalse);
      }
      case 'Binary':
        if (node.operator === '&&' || node.operator === '||') {
          const branches = this.condition(node, flow);
          this.replace(flow, joinFlow(branches.whenTrue, branches.whenFalse));
          return NOT_NULL;
        }
        break;
    }
    for (const child of boundChildren(node)) this.expression(child, flow);
    return NOT_NULL;
  }

  replace(flow, other) {
    if (!other) return;
    flow.entries = other.entries;
  }

  /** Reports a dereference of a possibly null receiver and marks the variable not-null afterwards. */
  dereference(receiver, flow) {
    if (!receiver || receiver.kind === 'This' || receiver.kind === 'Base' || receiver.kind === 'ConditionalReceiver') return;
    const state = this.expression(receiver, flow);
    if (state !== MAYBE_NULL || !isReferenceLike(receiver.type)) return;
    this.warn(receiver.syntax, DiagnosticId.CS8602);
    const variable = this.variableOf(receiver);
    if (variable) flow.set(variable, NOT_NULL);
  }

  memberAccess(node, flow) {
    const member = node.field ?? node.property;
    if (node.receiver && !member.isStatic) this.dereference(node.receiver, flow);
    const variable = this.variableOf(node);
    const tracked = variable ? flow.get(variable) : undefined;
    if (tracked !== undefined) return tracked;
    return resultState(member) ?? frameworkResultState(member) ?? this.declaredState(node);
  }

  call(node, flow) {
    const method = node.method ?? node.constructor;
    if (node.receiver && method && !method.isStatic && !node.isExtension) this.dereference(node.receiver, flow);
    const states = (node.args ?? []).map(argument => this.argument(argument, method, flow));
    for (const initializer of node.initializers ?? []) this.expression(initializer.value, flow);
    if (!method || node.kind === 'ObjectCreation') return NOT_NULL;
    for (const argument of node.args ?? []) {
      this.applyPostcondition(argument, null, flow);
      this.checkStoredArgument(argument, flow);
    }
    this.applyMemberPostconditions(method, null, flow, node.receiver);
    if (doesNotReturn(method)) this.markUnreachable(flow);
    return this.callResult(node, method, states);
  }

  /** The null-state of the value a call returns; `argumentStates` are the states of `node.args`, in order. */
  callResult(node, method) {
    const declared = resultState(method, { returnValue: true }) ?? frameworkResultState(method, node.receiver?.type);
    return declared ?? (isAnnotated(method.returnTypeWithAnnotations) ? MAYBE_NULL : NOT_NULL);
  }

  markUnreachable(flow) {
    this.replace(flow, new FlowState(new Map([['<unreachable>', NOT_NULL]])));
  }

  /** An `out` or `ref` argument whose variable is not nullable must not be left possibly null by the callee. */
  checkStoredArgument(argument, flow) {
    const value = argument.expression ?? argument;
    if ((argument.refKind !== RefKind.Out && argument.refKind !== RefKind.Ref) || value.suppressed) return;
    const variable = this.variableOf(value);
    if (!variable || flow.get(variable) !== MAYBE_NULL || !isReferenceLike(value.type)) return;
    if (this.declaredAnnotation(value) !== NullableAnnotation.NotAnnotated) return;
    const isMember = value.kind === 'FieldAccess' || value.kind === 'PropertyAccess';
    this.warn(value.syntax, isMember ? DiagnosticId.CS8601 : DiagnosticId.CS8600);
  }

  argument(argument, method, flow) {
    const value = argument.expression ?? argument;
    const parameter = argument.parameter;
    if (argument.refKind === RefKind.Out || argument.refKind === RefKind.Ref) {
      // The callee stores into the variable: afterwards it has the state the parameter type gives it.
      if (value.receiver) this.dereference(value.receiver, flow);
      const variable = this.variableOf(value);
      if (variable && parameter) this.assignVariable(flow, variable, isAnnotated(parameter.typeWithAnnotations) ? MAYBE_NULL : NOT_NULL);
      return NOT_NULL;
    }
    const state = this.expression(value, flow);
    if (state !== MAYBE_NULL || !parameter || value.suppressed) return state;
    if (!isReferenceLike(parameter.type) || !this.rejectsNull(parameter)) return state;
    if (this.isNullLiteral(value)) this.warn(value.syntax, DiagnosticId.CS8625);
    else this.warn(value.syntax, DiagnosticId.CS8604, [parameter.name, (method.originalDefinition ?? method).toDisplayString()]);
    return state;
  }

  /** True when null may not be passed for the parameter: a non-nullable type without [AllowNull], or [DisallowNull]. */
  rejectsNull(parameter) {
    if (disallowsNull(parameter)) return true;
    return isNotAnnotated(parameter.typeWithAnnotations) && !allowsNull(parameter);
  }

  isNullLiteral(node) {
    if (node.literal === 'null') return true;
    return node.kind === 'Conversion' && node.operand?.literal === 'null';
  }

  applyPostcondition(argument, returned, flow) {
    const variable = this.variableOf(argument.expression ?? argument);
    if (!variable || !argument.parameter) return;
    const state = argumentStateAfterCall(argument.parameter, returned);
    if (state) flow.set(variable, state);
  }

  /** [MemberNotNull] / [MemberNotNullWhen]: the named members of the receiver (or of `this`) are not null afterwards. */
  applyMemberPostconditions(method, returned, flow, receiver = null) {
    const type = method.containingType;
    for (const name of membersNotNullAfterCall(method, returned)) {
      const member = type?.getMembers(name)[0];
      const variable = member ? this.memberOf(receiver, member) : null;
      if (variable) flow.set(variable, NOT_NULL);
    }
  }

  /** The variable of `member` of `this` (members of other receivers: nullable/walker-member-slots.js). */
  memberOf(receiver, member) {
    if (receiver && receiver.kind !== 'This' && receiver.kind !== 'Base') return null;
    return member.kind === SymbolKind.Field ? (member.originalDefinition ?? member) : member;
  }

  assignment(node, flow) {
    const target = node.left;
    if (target.receiver && target.kind !== 'Local' && target.kind !== 'Parameter') this.dereference(target.receiver, flow);
    const state = this.expression(node.right, flow);
    this.checkAssignment(target, node.right, state);
    const variable = this.variableOf(target);
    if (variable) this.assignVariable(flow, variable, state, node.right);
    return state;
  }

  /** Stores a new value in a variable (members: nullable/walker-member-slots.js). */
  assignVariable(flow, variable, state) {
    flow.assign(variable, state);
  }

  /** Warns when a possibly null value is stored into a non-nullable reference location. */
  checkAssignment(target, value, state) {
    if (state !== MAYBE_NULL || value.suppressed || !isReferenceLike(target.type)) return;
    // [AllowNull] and [DisallowNull] are about what a setter or a caller may store: inside the method a parameter has
    // its declared type.
    const member = target.field ?? target.property;
    const isNonNullable = this.declaredAnnotation(target) === NullableAnnotation.NotAnnotated && !(member && allowsNull(member));
    if (!isNonNullable && !(member && disallowsNull(member))) return;
    const isLocalOrParameter = target.kind === 'Local' || target.kind === 'Parameter';
    if (isLocalOrParameter) this.warn(value.syntax, DiagnosticId.CS8600);
    else this.warn(value.syntax, this.isNullLiteral(value) ? DiagnosticId.CS8625 : DiagnosticId.CS8601);
  }

  conversion(node, flow) {
    const state = this.expression(node.operand, flow);
    const isUnboxing = node.conversion?.kind === 'Unboxing' && node.type?.isValueType === true && !node.type.isNullableValueType;
    if (isUnboxing && state === MAYBE_NULL) this.warn(node.syntax, DiagnosticId.CS8605);
    if (node.type?.isValueType === true && !node.type.isNullableValueType) return NOT_NULL;
    return state;
  }

  // ---- statements ----

  statement(node, flow) {
    if (!node || !flow) return flow && node ? flow : null;
    switch (node.kind) {
      case 'Block': {
        let current = flow;
        for (const child of node.statements) current = current ? this.statement(child, current) : null;
        return current;
      }
      case 'ExpressionStatement':
      case 'ExpressionBody': {
        const state = this.expression(node.expression, flow);
        if (node.isReturn) {
          this.checkReturn(node.expression, state);
          return null;
        }
        return flow.get('<unreachable>') || node.completes === false ? null : flow;
      }
      case 'LocalDeclaration':
        return this.declarations(node.declarations, flow);
      case 'If': {
        const branches = this.condition(node.condition, flow);
        const afterThen = this.statement(node.then, branches.whenTrue);
        const afterElse = node.otherwise ? this.statement(node.otherwise, branches.whenFalse) : branches.whenFalse;
        return joinFlow(afterThen, afterElse);
      }
      case 'While':
        return this.whileLoop(node, flow);
      case 'Do':
        return this.doLoop(node, flow);
      case 'For':
        return this.forLoop(node, flow);
      case 'ForEach':
        return this.forEachLoop(node, flow);
      case 'Switch':
        return this.switchStatement(node, flow);
      case 'Return': {
        const state = node.expression ? this.expression(node.expression, flow) : NOT_NULL;
        if (node.expression) this.checkReturn(node.expression, state);
        this.leaveConstructor(flow);
        return null;
      }
      case 'Throw':
        if (node.expression) this.dereference(node.expression, flow);
        return null;
      case 'Break':
        return this.breakStatement(flow);
      case 'Continue':
        return this.continueStatement(flow);
      case 'Goto':
      case 'YieldBreak':
        return null;
      case 'Try': {
        let result = this.statement(node.body, flow.clone());
        for (const clause of node.catches) result = joinFlow(result, this.statement(clause.block, flow.clone()));
        if (node.finallyBlock) this.statement(node.finallyBlock, flow.clone());
        return result;
      }
      case 'Using': {
        const current = Array.isArray(node.resources) ? this.declarations(node.resources, flow) : flow;
        if (!Array.isArray(node.resources)) this.expression(node.resources, flow);
        return this.statement(node.body, current);
      }
      case 'Lock':
        this.dereference(node.expression, flow);
        return this.statement(node.body, flow);
      case 'Labeled':
        return this.statement(node.statement, flow);
      case 'Checked':
      case 'Unsafe':
        return this.statement(node.block, flow);
      case 'YieldReturn':
        this.expression(node.expression, flow);
        return flow;
      default:
        return flow;
    }
  }

  declarations(list, flow) {
    for (const declaration of list) {
      if (!declaration.value) continue;
      const state = this.expression(declaration.value, flow);
      const local = declaration.local;
      const target = { kind: 'Local', local, type: local.type };
      this.checkAssignment(target, declaration.value, state);
      this.assignVariable(flow, local, state, declaration.value);
    }
    return flow;
  }

  checkReturn(value, state) {
    const method = this.method;
    if (!method || state !== MAYBE_NULL || value.suppressed) return;
    const returnType = method.returnTypeWithAnnotations;
    if (!isNotAnnotated(returnType) || !isReferenceLike(method.returnType)) return;
    if (resultState(method, { returnValue: true }) === MAYBE_NULL) return;
    this.warn(value.syntax, DiagnosticId.CS8603);
  }

  /** When a constructor exits, every non-nullable reference field and auto-property must hold a non-null value. */
  leaveConstructor(flow) {
    const method = this.method;
    if (!method || method.methodKind !== MethodKind.Constructor || method.isStatic || !flow) return;
    if (method.initializerSyntax?.kind === 'ThisConstructorInitializer') return;
    const type = method.containingType;
    for (const member of type.getMembers()) {
      const isField = member.kind === SymbolKind.Field && !member.isImplicitlyDeclared;
      const isAutoProperty = member.kind === SymbolKind.Property && member.isAutoProperty;
      if ((!isField && !isAutoProperty) || member.isStatic || member.initializerSyntax || member.isRequired) continue;
      if (!isNotAnnotated(member.typeWithAnnotations) || !isReferenceLike(member.type)) continue;
      const key = isField ? (member.originalDefinition ?? member) : member;
      if (flow.get(key) === NOT_NULL) continue;
      this.warn(method.locations[0], DiagnosticId.CS8618, [isField ? 'field' : 'property', member.name]);
    }
  }
}

/** The nullable flow walker: statements and expressions (above) composed with the condition and loop rules. */
const NullableConditionRules = Base => NullableConditionalAccess(NullableAttributeRules(NullableConditions(NullableTypeArgumentChecks(Base))));
const NullableBase = NullableRules(NullableLoops(NullableConditionRules(NullableMemberSlots(NullableLambdas(NullableWalkerCore)))));
export class NullableWalker extends NullableUnionFlow(NullableBase) {}
