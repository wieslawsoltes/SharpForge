/** Union Value null-state, including creation, copying, type/null patterns and explicit non-boxing access. */
import { DiagnosticId } from '../diagnostics/codes.js';
import { NullableAnnotation } from '../symbols/types.js';
import { unionShapeOf } from '../symbols/union-shape.js';
import { unionPatternOutputType } from '../binder/unions/pattern-binding.js';
import { NOT_NULL, MAYBE_NULL, joinFlow, joinStates } from './flow-state.js';

function nullContentsMatch(pattern) {
  if (pattern.unionAccess) return !!pattern.unionAccess.isNull;
  if (pattern.kind === 'VarPattern' || pattern.kind === 'DiscardPattern') return true;
  if (pattern.kind === 'NotPattern') {
    const inner = nullContentsMatch(pattern.pattern);
    return inner === undefined ? undefined : !inner;
  }
  if (pattern.kind === 'AndPattern' || pattern.kind === 'OrPattern') {
    const left = nullContentsMatch(pattern.left);
    const right = nullContentsMatch(pattern.right);
    if (pattern.kind === 'AndPattern') return left === false || right === false ? false : left === true && right === true ? true : undefined;
    return left === true || right === true ? true : left === false && right === false ? false : undefined;
  }
  if (pattern.kind === 'RecursivePattern' && !pattern.testedType && !pattern.properties?.length && !pattern.hasPositional) return true;
  return undefined;
}

/** Nullable-walker registration; state is owned by one body walk and never shared between compilations. */
export const NullableUnionFlow = Base => class extends Base {
  constructor(...args) {
    super(...args);
    this.unionCreationStates = new WeakMap();
    this.unionArgumentCapture = null;
  }
  unionShape(type) {
    return this.host.versionOf(this.uri).preview ? unionShapeOf(type, this.host.core) : null;
  }
  unionValueSlot(receiver, shape) {
    return shape?.valueProperty ? this.memberOf(receiver, shape.valueProperty) : null;
  }
  unionValueState(value, flow, shape = this.unionShape(value?.type)) {
    if (!value || !shape?.valid) return MAYBE_NULL;
    if (this.unionCreationStates.has(value)) return this.unionCreationStates.get(value);
    if (value.kind === 'Default' || value.literal === 'default' || value.literal === 'null') return MAYBE_NULL;
    if (value.kind === 'Conversion' && !value.conversion?.isUserDefined) return this.unionValueState(value.operand, flow, shape);
    const slot = this.unionValueSlot(value, shape);
    return flow.get(slot) ?? (shape.valueProperty.typeWithAnnotations.nullableAnnotation === NullableAnnotation.Annotated ? MAYBE_NULL : NOT_NULL);
  }
  call(node, flow) {
    const shape = this.unionShape(node.type);
    const method = node.method ?? node.constructor;
    const creation = shape?.valid && method && shape.creationMembers.some(member => member.equals(method));
    if (!creation) return super.call(node, flow);
    const saved = this.unionArgumentCapture;
    const capture = { method, state: MAYBE_NULL };
    this.unionArgumentCapture = capture;
    try {
      const state = super.call(node, flow);
      this.unionCreationStates.set(node, capture.state);
      return state;
    } finally { this.unionArgumentCapture = saved; }
  }
  argument(argument, method, flow) {
    const state = super.argument(argument, method, flow);
    if (this.unionArgumentCapture?.method === method) this.unionArgumentCapture.state = state;
    return state;
  }
  assignVariable(flow, variable, state, value = null) {
    const shape = this.unionShape(variable?.type);
    const contents = value && shape?.valid ? this.unionValueState(value, flow, shape) : null;
    super.assignVariable(flow, variable, state, value);
    if (contents) flow.set(this.slotOf(variable, shape.valueProperty), contents);
  }
  memberAccess(node, flow) {
    const result = super.memberAccess(node, flow);
    const shape = node.receiver ? this.unionShape(node.receiver.type) : null;
    return shape?.valid && shape.valueProperty.equals(node.property) ? this.unionValueState(node.receiver, flow, shape) : result;
  }
  condition(node, flow) {
    const shape = node?.kind === 'PropertyAccess' && node.receiver ? this.unionShape(node.receiver.type) : null;
    if (!shape?.hasValue?.equals(node.property)) return super.condition(node, flow);
    this.expression(node, flow);
    const whenTrue = flow.clone();
    const slot = this.unionValueSlot(node.receiver, shape);
    if (slot) whenTrue.set(slot, NOT_NULL);
    return { whenTrue, whenFalse: flow };
  }
  callCondition(node, flow) {
    const branches = super.callCondition(node, flow);
    const shape = node.receiver ? this.unionShape(node.receiver.type) : null;
    if (shape?.tryGetValues.some(member => member.equals(node.method))) {
      const slot = this.unionValueSlot(node.receiver, shape);
      if (slot) branches.whenTrue?.set(slot, NOT_NULL);
    }
    return branches;
  }
  typeTestCondition(node, flow) {
    if (!node.pattern || !this.unionShape(node.operand.type)) return super.typeTestCondition(node, flow);
    this.expression(node.operand, flow);
    return this.unionPatternCondition(node.pattern, node.operand, flow);
  }
  unionPatternReceiver(pattern, receiver) {
    if (pattern.kind === 'AndPattern') return this.unionPatternReceiver(pattern.right, this.unionPatternReceiver(pattern.left, receiver));
    if (!pattern.unionAccess || pattern.unionAccess.isNull) return receiver;
    return { kind: 'PropertyAccess', property: pattern.unionAccess.shape.valueProperty, receiver,
      type: unionPatternOutputType(pattern, receiver.type), syntax: pattern.syntax };
  }
  unionPatternCondition(pattern, receiver, flow) {
    if (!flow) return { whenTrue: null, whenFalse: null };
    if (pattern.kind === 'NotPattern') {
      const inner = this.unionPatternCondition(pattern.pattern, receiver, flow);
      return { whenTrue: inner.whenFalse, whenFalse: inner.whenTrue };
    }
    if (pattern.kind === 'AndPattern' || pattern.kind === 'OrPattern') {
      const left = this.unionPatternCondition(pattern.left, receiver, flow);
      const isAnd = pattern.kind === 'AndPattern';
      const source = isAnd ? this.unionPatternReceiver(pattern.left, receiver) : receiver;
      const right = this.unionPatternCondition(pattern.right, source, isAnd ? left.whenTrue : left.whenFalse);
      return isAnd ? { whenTrue: right.whenTrue, whenFalse: joinFlow(left.whenFalse, right.whenFalse) }
        : { whenTrue: joinFlow(left.whenTrue, right.whenTrue), whenFalse: right.whenFalse };
    }
    const whenTrue = flow.clone();
    const whenFalse = flow.clone();
    const access = pattern.unionAccess;
    if (access) {
      const slot = this.unionValueSlot(receiver, access.shape);
      if (slot) {
        whenTrue.set(slot, access.isNull ? MAYBE_NULL : NOT_NULL);
        if (access.isNull) whenFalse.set(slot, NOT_NULL);
      }
      const variable = this.variableOf(receiver);
      if (variable) (access.isNull ? whenFalse : whenTrue).set(variable, NOT_NULL);
    }
    if (pattern.local) {
      const source = this.unionPatternReceiver(pattern, receiver);
      this.assignVariable(whenTrue, pattern.local, NOT_NULL, source);
    }
    return { whenTrue, whenFalse };
  }
  expression(node, flow) {
    if (node?.kind !== 'SwitchExpression' || !flow || !this.unionShape(node.governing?.type)) return super.expression(node, flow);
    this.expression(node.governing, flow);
    const maybeNull = this.unionValueState(node.governing, flow) === MAYBE_NULL;
    const handlesNull = node.arms.some(arm => (!arm.when || arm.when.constantValue?.value === true) && nullContentsMatch(arm.pattern) === true);
    if (maybeNull && !handlesNull) this.warn(node.syntax.switchKeyword ?? node.syntax, DiagnosticId.CS8655, ['null']);
    let result = null;
    let state = NOT_NULL;
    for (const arm of node.arms) {
      const branches = this.unionPatternCondition(arm.pattern, node.governing, flow);
      const branch = arm.when ? this.condition(arm.when, branches.whenTrue).whenTrue : branches.whenTrue;
      if (!branch) continue;
      state = joinStates(state, this.expression(arm.value, branch));
      result = joinFlow(result, branch);
    }
    if (result) this.replace(flow, result);
    return state;
  }
};
