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
 * A state maps a variable to 'notNull' or 'maybeNull'; a variable without an entry has the state its declared
 * annotation gives it. Branches join to 'maybeNull' when either side is; `x == null`, `x is null`, `x is T`,
 * `x?.M()`, `x ?? y` and the analysis attributes (nullable/attributes.js) split or refine states. Loops are walked
 * once: a variable assigned null later in a loop body is not seen as nullable at the loop head (Roslyn iterates to a
 * fixed point; this walker under-reports there rather than over-reporting).
 */
import { NullableAnnotation, RefKind, SymbolKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { allowsNull, argumentStateAfterCall, doesNotReturn, membersNotNullAfterCall, resultState } from './attributes.js';
import { boundChildren } from '../flow/semantic-assignment.js';

const NOT_NULL = 'notNull';
const MAYBE_NULL = 'maybeNull';
const nullTestMethods = new Set(['IsNullOrEmpty', 'IsNullOrWhiteSpace']);

const isReferenceLike = type => !!type && type.isReferenceType === true;
const isAnnotated = typeWithAnnotations => typeWithAnnotations?.nullableAnnotation === NullableAnnotation.Annotated;
const isNotAnnotated = typeWithAnnotations => typeWithAnnotations?.nullableAnnotation === NullableAnnotation.NotAnnotated;
const joinStates = (a, b) => (a === MAYBE_NULL || b === MAYBE_NULL ? MAYBE_NULL : NOT_NULL);

/** The set of variable states on one control-flow path; `null` stands for unreachable code. */
class FlowState {
  constructor(entries = new Map()) {
    this.entries = entries;
  }
  clone() {
    return new FlowState(new Map(this.entries));
  }
  get(variable) {
    return this.entries.get(variable);
  }
  set(variable, state) {
    this.entries.set(variable, state);
  }
}

function joinFlow(a, b) {
  if (!a) return b ? b.clone() : null;
  if (!b) return a.clone();
  const result = new FlowState();
  for (const variable of new Set([...a.entries.keys(), ...b.entries.keys()])) {
    const left = a.get(variable);
    const right = b.get(variable);
    // A variable known on one path only keeps its declared state on the other, which we cannot improve on.
    if (left !== undefined && right !== undefined) result.set(variable, joinStates(left, right));
    else if ((left ?? right) === MAYBE_NULL) result.set(variable, MAYBE_NULL);
  }
  return result;
}

export class NullableWalker {
  /**
   * @param host `{ nullableAt(uri, position) }` - the nullable context lookup of the compilation
   * @param {string} uri the file the body belongs to
   */
  constructor(host, uri) {
    this.host = host;
    this.uri = uri;
    this.diagnostics = [];
    this.method = null;
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
    if (this.diagnostics.some(d => d.node === node && d.code === code)) return;
    this.diagnostics.push({ node, code, args });
  }

  // ---- variables ----

  /** The tracked variable an expression denotes: a local, a parameter or a field/auto-property of `this`. */
  variableOf(expression) {
    if (!expression) return null;
    if (expression.kind === 'Local') return expression.local;
    if (expression.kind === 'Parameter') return expression.parameter;
    const viaThis = !expression.receiver || expression.receiver.kind === 'This';
    if (expression.kind === 'FieldAccess' && viaThis && !expression.field.isStatic)
      return expression.field.originalDefinition ?? expression.field;
    if (expression.kind === 'PropertyAccess' && viaThis && expression.property.isAutoProperty) return expression.property;
    return null;
  }

  declaredAnnotation(expression) {
    switch (expression.kind) {
      case 'Local':
        return expression.local.declaredAnnotation ?? null;
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
      case 'ConditionalAccess': {
        this.expression(node.receiver, flow);
        const inner = flow.clone();
        const receiver = this.variableOf(node.receiver);
        if (receiver) inner.set(receiver, NOT_NULL);
        this.expression(node.whenNotNull, inner);
        return MAYBE_NULL;
      }
      case 'Lambda':
        if (node.body) this.lambdaBody(node.body, flow.clone());
        return NOT_NULL;
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

  lambdaBody(body, flow) {
    const saved = this.method;
    this.method = null;
    if ('completes' in body) this.statement(body, flow);
    else this.expression(body, flow);
    this.method = saved;
  }

  /** Reports a dereference of a possibly null receiver and marks the variable not-null afterwards. */
  dereference(receiver, flow) {
    if (!receiver || receiver.kind === 'This' || receiver.kind === 'Base' || receiver.kind === 'ConditionalReceiver') return;
    const state = this.expression(receiver, flow);
    if (state !== MAYBE_NULL || !isReferenceLike(receiver.type)) return;
    this.warn(receiver.syntax, 'CS8602');
    const variable = this.variableOf(receiver);
    if (variable) flow.set(variable, NOT_NULL);
  }

  memberAccess(node, flow) {
    const member = node.field ?? node.property;
    if (node.receiver && !member.isStatic) this.dereference(node.receiver, flow);
    const variable = this.variableOf(node);
    const tracked = variable ? flow.get(variable) : undefined;
    if (tracked !== undefined) return tracked;
    return resultState(member) ?? this.declaredState(node);
  }

  call(node, flow) {
    const method = node.method ?? node.constructor;
    if (node.receiver && method && !method.isStatic && !node.isExtension) this.dereference(node.receiver, flow);
    for (const argument of node.args ?? []) this.argument(argument, method, flow);
    for (const initializer of node.initializers ?? []) this.expression(initializer.value, flow);
    if (!method || node.kind === 'ObjectCreation') return NOT_NULL;
    for (const argument of node.args ?? []) this.applyPostcondition(argument, null, flow);
    this.applyMemberPostconditions(method, null, flow);
    if (doesNotReturn(method)) this.replace(flow, new FlowState(new Map([['<unreachable>', NOT_NULL]])));
    return resultState(method, { returnValue: true }) ?? (isAnnotated(method.returnTypeWithAnnotations) ? MAYBE_NULL : NOT_NULL);
  }

  argument(argument, method, flow) {
    const value = argument.expression ?? argument;
    const parameter = argument.parameter;
    if (argument.refKind === RefKind.Out) {
      const variable = this.variableOf(value);
      if (variable && parameter) flow.set(variable, isAnnotated(parameter.typeWithAnnotations) ? MAYBE_NULL : NOT_NULL);
      return;
    }
    const state = this.expression(value, flow);
    if (state !== MAYBE_NULL || !parameter || value.suppressed) return;
    const acceptsNull = !isNotAnnotated(parameter.typeWithAnnotations) || !isReferenceLike(parameter.type) || allowsNull(parameter);
    if (acceptsNull) return;
    if (this.isNullLiteral(value)) this.warn(value.syntax, 'CS8625');
    else this.warn(value.syntax, 'CS8604', [parameter.name, (method.originalDefinition ?? method).toDisplayString()]);
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

  applyMemberPostconditions(method, returned, flow) {
    const type = method.containingType;
    for (const name of membersNotNullAfterCall(method, returned)) {
      const member = type?.getMembers(name)[0];
      if (member) flow.set(member.kind === SymbolKind.Field ? (member.originalDefinition ?? member) : member, NOT_NULL);
    }
  }

  assignment(node, flow) {
    const target = node.left;
    if (target.receiver && target.kind !== 'Local' && target.kind !== 'Parameter') this.dereference(target.receiver, flow);
    const state = this.expression(node.right, flow);
    this.checkAssignment(target, node.right, state);
    const variable = this.variableOf(target);
    if (variable) flow.set(variable, state);
    return state;
  }

  /** Warns when a possibly null value is stored into a non-nullable reference location. */
  checkAssignment(target, value, state) {
    if (state !== MAYBE_NULL || value.suppressed || !isReferenceLike(target.type)) return;
    if (this.declaredAnnotation(target) !== NullableAnnotation.NotAnnotated) return;
    const member = target.field ?? target.property ?? target.parameter;
    if (member && allowsNull(member)) return;
    if (this.isNullLiteral(value)) this.warn(value.syntax, target.kind === 'Local' ? 'CS8600' : 'CS8625');
    else this.warn(value.syntax, target.kind === 'Local' ? 'CS8600' : 'CS8601');
  }

  conversion(node, flow) {
    const state = this.expression(node.operand, flow);
    const isUnboxing = node.conversion?.kind === 'Unboxing' && node.type?.isValueType === true && !node.type.isNullableValueType;
    if (isUnboxing && state === MAYBE_NULL) this.warn(node.syntax, 'CS8605');
    if (node.type?.isValueType === true && !node.type.isNullableValueType) return NOT_NULL;
    return state;
  }

  // ---- conditions ----

  /** Walks a boolean expression and returns the flow when it is true and when it is false. */
  condition(node, flow) {
    if (!flow) return { whenTrue: null, whenFalse: null };
    const both = () => {
      this.expression(node, flow);
      return { whenTrue: flow, whenFalse: flow.clone() };
    };
    switch (node.kind) {
      case 'Binary':
        return this.binaryCondition(node, flow) ?? both();
      case 'Unary':
        if (node.operator === '!' && !node.method) {
          const inner = this.condition(node.operand, flow);
          return { whenTrue: inner.whenFalse, whenFalse: inner.whenTrue };
        }
        return both();
      case 'Is':
      case 'IsPattern':
        return this.typeTestCondition(node, flow);
      case 'Call':
        return this.callCondition(node, flow);
      case 'Conversion':
        return node.conversion?.kind === 'Identity' ? this.condition(node.operand, flow) : both();
      default:
        return both();
    }
  }

  binaryCondition(node, flow) {
    if (node.operator === '&&') {
      const left = this.condition(node.left, flow);
      const right = this.condition(node.right, left.whenTrue);
      return { whenTrue: right.whenTrue, whenFalse: joinFlow(left.whenFalse, right.whenFalse) };
    }
    if (node.operator === '||') {
      const left = this.condition(node.left, flow);
      const right = this.condition(node.right, left.whenFalse);
      return { whenTrue: joinFlow(left.whenTrue, right.whenTrue), whenFalse: right.whenFalse };
    }
    if (node.operator !== '==' && node.operator !== '!=') return null;
    const unwrap = operand => (operand.kind === 'Conversion' && operand.operand ? operand.operand : operand);
    const left = unwrap(node.left);
    const right = unwrap(node.right);
    const tested = this.isNullLiteral(right) ? left : this.isNullLiteral(left) ? right : null;
    if (!tested) return null;
    this.expression(tested, flow);
    const variable = this.variableOf(tested);
    const isNull = flow.clone();
    const isNotNull = flow.clone();
    if (variable) {
      isNull.set(variable, MAYBE_NULL);
      isNotNull.set(variable, NOT_NULL);
    }
    return node.operator === '==' ? { whenTrue: isNull, whenFalse: isNotNull } : { whenTrue: isNotNull, whenFalse: isNull };
  }

  typeTestCondition(node, flow) {
    this.expression(node.operand, flow);
    const variable = this.variableOf(node.operand);
    const matched = flow.clone();
    const unmatched = flow.clone();
    const pattern = node.pattern;
    const negated = pattern?.kind === 'NotPattern';
    const inner = negated ? pattern.pattern : pattern;
    const testsForNull = inner?.kind === 'ConstantPattern' && this.isNullLiteral(inner.value ?? {});
    if (variable) {
      if (testsForNull) {
        matched.set(variable, MAYBE_NULL);
        unmatched.set(variable, NOT_NULL);
      } else {
        // A successful type or declaration pattern proves the operand is not null.
        matched.set(variable, NOT_NULL);
      }
    }
    if (inner?.local) matched.set(inner.local, NOT_NULL);
    return negated ? { whenTrue: unmatched, whenFalse: matched } : { whenTrue: matched, whenFalse: unmatched };
  }

  callCondition(node, flow) {
    this.call(node, flow);
    const whenTrue = flow;
    const whenFalse = flow.clone();
    const method = node.method;
    if (!method) return { whenTrue, whenFalse };
    for (const argument of node.args ?? []) {
      this.applyPostcondition(argument, true, whenTrue);
      this.applyPostcondition(argument, false, whenFalse);
    }
    this.applyMemberPostconditions(method, true, whenTrue);
    this.applyMemberPostconditions(method, false, whenFalse);
    // string.IsNullOrEmpty / IsNullOrWhiteSpace carry [NotNullWhen(false)] in the BCL.
    const isStringNullTest = nullTestMethods.has(method.name) && method.containingType?.specialType === 'System_String';
    const variable = isStringNullTest ? this.variableOf(node.args[0]?.expression ?? {}) : null;
    if (variable) whenFalse.set(variable, NOT_NULL);
    return { whenTrue, whenFalse };
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
      case 'While': {
        const branches = this.condition(node.condition, flow);
        this.statement(node.body, branches.whenTrue);
        return branches.whenFalse ?? flow;
      }
      case 'Do': {
        const afterBody = this.statement(node.body, flow.clone());
        return afterBody ? this.condition(node.condition, afterBody).whenFalse : flow;
      }
      case 'For': {
        const current = this.declarations(node.declaration ?? [], flow);
        for (const initializer of node.initializers) this.expression(initializer, current);
        const branches = node.condition ? this.condition(node.condition, current) : { whenTrue: current, whenFalse: null };
        const afterBody = this.statement(node.body, branches.whenTrue?.clone() ?? null);
        if (afterBody) for (const incrementor of node.incrementors) this.expression(incrementor, afterBody);
        return branches.whenFalse ?? current;
      }
      case 'ForEach': {
        this.dereference(node.collection, flow);
        this.statement(node.body, flow.clone());
        return flow;
      }
      case 'Switch': {
        this.expression(node.governing, flow);
        let result = flow.clone();
        for (const section of node.sections) result = joinFlow(result, this.statement(section.body, flow.clone()));
        return result;
      }
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
      case 'Continue':
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
      flow.set(local, state);
    }
    return flow;
  }

  checkReturn(value, state) {
    const method = this.method;
    if (!method || state !== MAYBE_NULL || value.suppressed) return;
    const returnType = method.returnTypeWithAnnotations;
    if (!isNotAnnotated(returnType) || !isReferenceLike(method.returnType)) return;
    if (resultState(method, { returnValue: true }) === MAYBE_NULL) return;
    this.warn(value.syntax, 'CS8603');
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
      this.warn(method.locations[0], 'CS8618', [isField ? 'field' : 'property', member.name]);
    }
  }
}
