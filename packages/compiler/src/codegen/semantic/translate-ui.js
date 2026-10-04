/** Checked UI polymorphism is lowered through the shared UI runtime, with static base calls preserved. */
import {n} from './node-factory.js';
import {uiNullableArguments} from './ui-nullable-arguments.js';
import {uiAccessorForwarder} from './ui-dispatch-forwarders.js';
import {uiNullableType, uiNullableRead, uiNullableProperty, uiNullableCall, uiNullableConversion,
  uiNullableBinary, uiNullableCoalesce, uiNullableCreation} from './ui-nullable-values.js';

const boxedScalars = new Set(['int', 'uint', 'float', 'double', 'bool']);

export const UITranslation = Base => class extends Base {
  arguments(node, method) {
    const previous = this.uiArgumentDepth ?? 0;
    if (method?.contract && this.g.ui.allowsDelegate(method)) this.uiArgumentDepth = previous + 1;
    try { return super.arguments(uiNullableArguments(this, node, method), method); }
    finally { this.uiArgumentDepth = previous; }
  }

  box(operand, node) {
    const owner = this.frame.method.owner;
    if (!this.uiArgumentDepth && !owner?.uiFrameworkBase && !owner?.interfaces?.length) {
      return super.box(operand, node);
    }
    const type = this.g.bridge.registryName(operand.type) ?? this.imageType(operand.type, operand.syntax);
    if (!boxedScalars.has(type) && !['value', 'enum'].includes(this.g.bridge.types.get(type)?.kind)) {
      return super.box(operand, node);
    }
    return this.g.ui.intrinsic('Box', [this.expression(operand), n.literal(type, 'string')], 'object');
  }

  contractArguments(contract, args) {
    if (!contract || !/^(Microsoft\.UI\.|Windows\.Foundation\.|SharpForge\.UI\.)/.test(contract.owner)) {
      return super.contractArguments(contract, args);
    }
    return args.map((value, index) => contract.parameters[index] === 'object' &&
      (boxedScalars.has(value.legacyType) || ['value', 'enum'].includes(this.g.bridge.types.get(value.legacyType)?.kind))
      ? this.g.ui.intrinsic('Box', [value, n.literal(value.legacyType, 'string')], 'object') : value);
  }

  objectArgument(value, target) {
    return target === 'object' && ['float', 'uint'].includes(value.legacyType)
      ? this.g.ui.intrinsic('Box', [value, n.literal(value.legacyType, 'string')], 'object') : super.objectArgument(value, target);
  }

  exprTypeOf(node) {
    const type = node.operandType ?? node.referencedType;
    if (!type || type.isUnboundGenericType || type.typeKind === 'typeParameter') {
      return this.unsupported('typeof for an open type', node.syntax);
    }
    const name = this.g.bridge.registryName(type) ?? this.imageType(type, node.syntax);
    return this.g.ui.intrinsic('TypeOf', [n.literal(name, 'string')], 'System.Type');
  }

  exprBase(node) {
    if (!this.g.ui.accepts(node.type)) return this.unsupported('base member access outside the UI subclass profile', node.syntax);
    return this.frame.thisExpr();
  }

  receiver(node) {
    return node.receiver?.kind === 'Base' ? this.exprBase(node.receiver) : super.receiver(node);
  }

  memberReceiver(node) {
    return node.receiver?.kind === 'Base' ? this.exprBase(node.receiver) : super.memberReceiver(node);
  }

  exprCall(node) {
    const nullable = uiNullableCall(this, node);
    if (nullable) return nullable;
    if (!this.g.ui.dispatches(node.method, node.receiver)) {
      const value = super.exprCall(node), type = uiNullableType(this.g, node.type);
      return type && node.method.contract ? uiNullableRead(this, value, type) : value;
    }
    const value = this.g.ui.invoke(node.method, this.receiver(node), this.arguments(node, node.method));
    return this.uiResult(value, this.imageType(node.type, node.syntax));
  }

  exprPropertyAccess(node) {
    const member = uiNullableProperty(this, node);
    if (member) return member;
    const value = super.exprPropertyAccess(node);
    const type = uiNullableType(this.g, node.type);
    return type && node.property.getMethod?.contract ? uiNullableRead(this, value, type) : value;
  }

  exprBinary(node) { return uiNullableBinary(this, node) ?? super.exprBinary(node); }
  exprCoalesce(node) { return uiNullableCoalesce(this, node) ?? super.exprCoalesce(node); }
  exprObjectCreation(node) { return uiNullableCreation(this, node) ?? super.exprObjectCreation(node); }

  propertyReference(node) {
    const property = node.property;
    if (!this.g.ui.dispatches(property?.getMethod, node.receiver) && !this.g.ui.dispatches(property?.setMethod, node.receiver)) {
      return super.propertyReference(node);
    }
    return {kind: 'PropertyAccess', isExpression: true, legacyType: this.imageType(node.type, node.syntax),
      receiver: this.memberReceiver(node), property: {legacy: {isStatic: false, owner: {name: this.imageType(node.receiver.type)},
        get: uiAccessorForwarder(this.g.ui, property.getMethod), set: uiAccessorForwarder(this.g.ui, property.setMethod)}}};
  }

  methodGroupDelegate(node) {
    const group = node.operand;
    const method = node.conversion.method ?? node.method ?? group.selected ?? (group.methods?.length === 1 ? group.methods[0] : null);
    if (!method || !this.g.isSource(method) || !this.g.ui.dispatches(method, group.receiver)) return super.methodGroupDelegate(node);
    const receiver = group.receiver ? this.expression(group.receiver) : this.frame.thisExpr();
    const info = this.g.delegates.classOf(node.type, node.syntax);
    return this.g.delegates.create(info, this.g.methodOf(method, node.syntax), receiver, {virtualSymbol: method});
  }

  checkFrameworkParameters(method, syntax) {
    if (!this.g.ui.allowsDelegate(method)) super.checkFrameworkParameters(method, syntax);
  }

  exprEventAssignment(node) {
    if (this.g.isSource(node.event)) return super.exprEventAssignment(node);
    const method = node.operator === '+=' ? node.event.addMethod : node.event.removeMethod;
    if (!method?.contract || !this.g.ui.allowsDelegate(method)) return super.exprEventAssignment(node);
    if (this.g.ui.dispatches(method, node.receiver)) return this.g.ui.invoke(method, this.expression(node.receiver), [this.expression(node.handler)]);
    return n.frameworkCall(method, method.isStatic ? null : this.expression(node.receiver), [this.expression(node.handler)], 'void');
  }

  retyped(value, node) {
    if (node.conversion?.kind === 'ImplicitReference' &&
      (this.g.ui.accepts(node.operand?.type) || this.g.ui.canTest(node.type))) return value;
    return super.retyped(value, node);
  }

  exprConversion(node) {
    const converted = uiNullableConversion(this, node);
    if (converted) return converted;
    const kind = node.conversion?.kind;
    const unbox = kind === 'Unboxing' && this.g.ui.canUnbox(node, this.frame.method.owner);
    if (!unbox && (kind !== 'ExplicitReference' || !this.g.ui.canTest(node.type))) return super.exprConversion(node);
    return this.uiResult(this.g.ui.cast(this.expression(node.operand), node.type), this.imageType(node.type, node.syntax));
  }

  exprAs(node) {
    if (!this.g.ui.canTest(node.type)) return this.unsupported('as conversions outside the UI subclass profile', node.syntax);
    const value = this.once(this.expression(node.operand), 'as'), type = this.imageType(node.type, node.syntax);
    const result = n.conditional(this.g.ui.test(value.read(), node.type),
      this.uiResult(this.g.ui.cast(value.read(), node.type), type), n.nullLiteral(type), type);
    return n.sequence(value.locals, value.effects, result);
  }

  exprIs(node) {
    return this.g.ui.canTest(node.testedType)
      ? this.g.ui.test(this.expression(node.operand), node.testedType) : super.exprIs(node);
  }

  typeTest(pattern, input) {
    return this.g.ui.canTest(pattern.testedType)
      ? this.g.ui.test(input.read(), pattern.testedType) : super.typeTest(pattern, input);
  }

  bindPatternLocal(pattern, input, test) {
    if (!pattern.local || !this.g.ui.canTest(pattern.local.type)) return super.bindPatternLocal(pattern, input, test);
    this.declarePending(pattern.local);
    const value = this.uiResult(this.g.ui.cast(input.read(), pattern.local.type), this.imageType(pattern.local.type, pattern.syntax));
    return n.logicalAnd(test, n.sequence([], [n.assign(this.variable(pattern.local, pattern.syntax), value)], n.literal(true, 'bool')));
  }

  /** The store carries the checked result's static type to both image and CIL back ends. */
  uiResult(value, type) {
    if (type === 'object' || type === 'void') return value;
    const result = this.temp(type, 'ui');
    return n.sequence([result], [n.assign(n.local(result), value)], n.local(result));
  }
};
