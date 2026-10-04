/** Union Value null-state, including creation, copying, type/null patterns and explicit non-boxing access. */
import { DiagnosticId } from '../diagnostics/codes.js';
import { previewStampText } from '@sharpforge/syntax';
import { NullableAnnotation, RefKind } from '../symbols/types.js';
import { unionShapeOf } from '../symbols/union-shape.js';
import { unionPatternOutputType } from '../binder/unions/pattern-binding.js';
import { NOT_NULL, MAYBE_NULL, joinFlow, joinStates } from './flow-state.js';

function nullContentsMatch(pattern, outerNull = false) {
  if (pattern.unionAccess) return !!pattern.unionAccess.isNull;
  if (pattern.kind === 'VarPattern' || pattern.kind === 'DiscardPattern') return true;
  if (pattern.kind === 'NotPattern') {
    const inner = nullContentsMatch(pattern.pattern, outerNull);
    return inner === undefined ? undefined : !inner;
  }
  if (pattern.kind === 'AndPattern' || pattern.kind === 'OrPattern') {
    const left = nullContentsMatch(pattern.left, outerNull);
    const right = nullContentsMatch(pattern.right, outerNull);
    if (pattern.kind === 'AndPattern') return left === false || right === false ? false : left === true && right === true ? true : undefined;
    return left === true || right === true ? true : left === false && right === false ? false : undefined;
  }
  if (pattern.kind === 'RecursivePattern' && !pattern.testedType && !pattern.properties?.length && !pattern.hasPositional) return !outerNull;
  if (outerNull && ['RecursivePattern', 'ListPattern', 'TypePattern', 'DeclarationPattern'].includes(pattern.kind)) return false;
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
    return this.host.versionOf?.(this.uri)?.preview ? unionShapeOf(type, this.host.core) : null;
  }
  unionValueSlot(receiver, shape) {
    return shape?.valueProperty ? this.memberOf(receiver, shape.valueProperty) : null;
  }
  unionValueState(value, flow, shape = this.unionShape(value?.type)) {
    if (!value || !shape?.valid) return MAYBE_NULL;
    if (this.unionCreationStates.has(value)) return this.unionCreationStates.get(value);
    if (value.literal === 'null') return MAYBE_NULL;
    if ((value.kind === 'Default' || value.literal === 'default') &&
      (shape.type.originalDefinition.isUnionDeclaration || value.type?.isNullableValueType || value.type?.isReferenceType)) return MAYBE_NULL;
    if (value.kind === 'Conversion' && !value.conversion?.isUserDefined) return this.unionValueState(value.operand, flow, shape);
    const slot = this.unionValueSlot(value, shape);
    return flow.get(slot) ?? (shape.valueProperty.typeWithAnnotations.nullableAnnotation === NullableAnnotation.Annotated ? MAYBE_NULL : NOT_NULL);
  }
  unionInstanceState(value, flow, fallback = NOT_NULL) {
    if (!value?.type?.isNullableValueType) return fallback;
    if (value.kind === 'Default' || value.literal === 'default' || value.literal === 'null') return MAYBE_NULL;
    if (value.kind === 'Conversion' && value.conversion?.steps?.includes('wrap')) return NOT_NULL;
    const variable = this.variableOf(value);
    return variable ? flow.get(variable) ?? MAYBE_NULL : MAYBE_NULL;
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
    const shape = this.unionShape(variable?.type ?? variable?.member?.type);
    const contents = value && shape?.valid ? this.unionValueState(value, flow, shape) : null;
    super.assignVariable(flow, variable, shape && value ? this.unionInstanceState(value, flow, state) : state, value);
    if (contents) flow.set(this.slotOf(variable, shape.valueProperty), contents);
  }
  memberAccess(node, flow) {
    const result = super.memberAccess(node, flow);
    const shape = node.receiver ? this.unionShape(node.receiver.type) : null;
    return shape?.valid && shape.valueProperty.equals(node.property) ? this.unionValueState(node.receiver, flow, shape) : result;
  }
  condition(node, flow) {
    if (!flow) return super.condition(node, flow);
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
    } else if (shape && node.method?.name === 'TryGetValue' && node.method.returnType.specialType === 'System_Boolean' &&
      node.method.parameters.length === 1 && node.method.parameters[0].refKind === RefKind.Out &&
      !shape.caseTypes.some(type => type.equals(node.method.parameters[0].type))) {
      // Open question "TryGetValue and nullable analysis", pinned lines 1019-1030: only the case APIs are specified.
      this.warn(node.syntax, DiagnosticId.SF2202, ['nullable flow for TryGetValue with a non-case out type', previewStampText('Unions')]);
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
    const variable = this.variableOf(receiver);
    if (access) {
      const slot = this.unionValueSlot(receiver, access.shape);
      if (slot) {
        whenTrue.set(slot, access.isNull ? MAYBE_NULL : NOT_NULL);
        if (access.isNull) whenFalse.set(slot, NOT_NULL);
      }
      if (variable) (access.isNull ? whenFalse : whenTrue).set(variable, NOT_NULL);
    } else if (['TypePattern', 'DeclarationPattern', 'RecursivePattern', 'ListPattern'].includes(pattern.kind) && variable) {
      whenTrue.set(variable, NOT_NULL);
    }
    this.learnFromSubpatterns(pattern, variable, whenTrue);
    if (pattern.local) {
      const source = this.unionPatternReceiver(pattern, receiver);
      const state = pattern.kind === 'VarPattern'
        ? this.unionInstanceState(receiver, flow, flow.get(variable) ?? this.declaredState(receiver)) : NOT_NULL;
      this.assignVariable(whenTrue, pattern.local, state, source);
    }
    return { whenTrue, whenFalse };
  }
  expression(node, flow) {
    if (node?.kind !== 'SwitchExpression' || !flow || !this.unionShape(node.governing?.type)) return super.expression(node, flow);
    const outerState = this.unionInstanceState(node.governing, flow, this.expression(node.governing, flow));
    const maybeNull = this.unionValueState(node.governing, flow) === MAYBE_NULL;
    const unguarded = node.arms.filter(arm => !arm.when || arm.when.constantValue?.value === true);
    const handlesNull = unguarded.some(arm => nullContentsMatch(arm.pattern) === true);
    const handlesOuterNull = unguarded.some(arm => nullContentsMatch(arm.pattern, true) === true);
    if (maybeNull && !handlesNull || outerState === MAYBE_NULL && !handlesOuterNull)
      this.warn(node.syntax.switchKeyword ?? node.syntax, DiagnosticId.CS8655, ['null']);
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
