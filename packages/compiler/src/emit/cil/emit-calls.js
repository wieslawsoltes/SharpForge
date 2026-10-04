/**
 * Calls (SF-A02-T30): static and instance method invocation with arguments in parameter order (named arguments,
 * optional parameters, `params` arrays, by-reference arguments), properties and indexers.
 *
 * The call instruction follows the receiver (ECMA-335 III.3.19, III.4.2): `call` for a static method, a `base`
 * access and a method of a value type called on its address; `callvirt` for a reference receiver, which also checks
 * it for null; `constrained.` + `callvirt` when the receiver's type is a type parameter.
 */
import { RefKind, SymbolKind, TypeKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { baseImplementationOf } from '../../symbols/base-implementation.js';
import { defaultSourceOf } from '../../overload/override-parameters.js';
import { PropertyLocation } from './locations.js';
import { isReference, isVoid, primitiveOf } from './type-facts.js';

const isByReference = refKind => !!refKind && refKind !== RefKind.None;
/** Members every value inherits from `object`; on a value type they are called on a boxed copy. */
const objectMembers = new Set(['ToString', 'GetHashCode', 'Equals', 'GetType']);

/** True for a static abstract or virtual member of an interface (C# 11). */
function isStaticVirtual(method) {
  if (!method.isStatic || method.containingType?.typeKind !== TypeKind.Interface) return false;
  const declared = method.associatedSymbol ?? method;
  return !!(method.isAbstract || method.isVirtual || declared.isAbstract || declared.isVirtual);
}
const occupiesVirtualSlot = method =>
  !!(method.isVirtual || method.isAbstract || method.isOverride) || method.containingType?.typeKind === TypeKind.Interface;

/** Class mixin: calls, properties, indexers. */
export const CallEmission = Base =>
  class extends Base {
    exprCall(node) {
      // An omitted call to a [Conditional] method evaluates nothing, not even its arguments.
      // So does a call of a partial method that no part implements (C# 3): the method does not exist.
      const method = node.method;
      if (node.isOmitted || (method.originalDefinition ?? method).isUnimplementedPartial) return false;
      if (method.methodKind === MethodKind.LocalFunction) return this.localFunctionCall(node);
      if (method.isStatic) {
        this.arguments(node, method);
        return this.callMethod(method, { syntax: node.syntax, constrainedTo: node.constrainedTo ?? null });
      }
      const receiver = node.receiver;
      if (!receiver) return this.unsupported('an instance call without a receiver', node.syntax);
      // A struct is sealed: a virtual method it overrides is called on the value itself, without a box.
      const structOverride = receiver.type?.typeKind === TypeKind.Struct ? this.sourceOverride(method, receiver.type) : null;
      if (structOverride) {
        this.receiver(receiver);
        this.arguments(node, method);
        return this.callMethod(structOverride, { receiver, syntax: node.syntax });
      }
      const boxedTarget = this.boxedCallTarget(method, receiver.type);
      if (boxedTarget && receiver.type.isRefLikeType) {
        // A ref struct cannot be boxed: the virtual method is called on its address (`constrained.`), which
        // reaches the override the struct declares.
        this.address(receiver);
        this.arguments(node, method);
        this.il.emit('constrained.', this.tokens.type(receiver.type));
        const effect = { pops: method.parameters.length + 1, pushes: isVoid(method.returnType) ? 0 : 1 };
        return this.il.emit('callvirt', this.tokens.method(boxedTarget), effect);
      }
      if (boxedTarget) {
        this.expression(receiver);
        this.il.emit('box', this.tokens.type(receiver.type));
        this.arguments(node, method);
        return this.callMethod(boxedTarget, { receiver: { type: this.core.object }, syntax: node.syntax });
      }
      this.receiver(receiver);
      this.arguments(node, method);
      return this.callMethod(this.nearestOverride(method, receiver.type), { receiver, syntax: node.syntax });
    }
    /**
     * A virtual method of a framework class (`object.ToString`) called on a source class is named by the override
     * nearest to the receiver's static type. `callvirt` dispatches the same way from either slot; naming the source
     * method keeps the call inside the assembly.
     */
    nearestOverride(method, receiverType) {
      if (receiverType?.typeKind !== TypeKind.Class) return method;
      return this.sourceOverride(method, receiverType) ?? method;
    }
    /** The override of a framework virtual method that the source type `receiverType` (or a source base of it) declares, or null. */
    sourceOverride(method, receiverType) {
      if (!method.isVirtual && !method.isAbstract && !method.isOverride) return null;
      if (method.containingType?.isSource) return null;
      const sameSignature = candidate =>
        candidate.kind === SymbolKind.Method &&
        candidate.isOverride &&
        candidate.parameters.length === method.parameters.length &&
        candidate.parameters.every((parameter, index) => parameter.type.equals(method.parameters[index].type));
      for (let type = receiverType; type?.isSource; type = type.baseType) {
        const override = type.getMembers(method.name).find(sameSignature);
        if (override) return override;
      }
      return null;
    }
    /**
     * The method to call on a boxed copy of a value receiver, or null when the method is called on the value's
     * address. A value is boxed for a method it inherits from a class (`Enum.HasFlag`, `ValueType.Equals`, a struct
     * that does not override `ToString`), and for a member of `object` on a primitive (`5.ToString()`), whose own
     * override the boxed call reaches.
     */
    boxedCallTarget(method, receiverType) {
      if (!receiverType || (isReference(receiverType) && !primitiveOf(receiverType))) return null;
      if (receiverType.typeKind === TypeKind.TypeParameter) return null;
      const owner = method.containingType?.originalDefinition ?? method.containingType,
        declaredOnReceiver = owner === (receiverType.originalDefinition ?? receiverType),
        objectSlot = objectMembers.has(method.name) ? this.objectSlotOf(method) : null;
      if (!declaredOnReceiver) return objectSlot ?? (owner?.typeKind === TypeKind.Class ? method : null);
      return primitiveOf(receiverType) ? objectSlot : null;
    }
    /** The method of `System.Object` with the name and parameter types of `method`, or null. */
    objectSlotOf(method) {
      const candidates = this.core.object.getMembers(method.name);
      return (
        candidates.find(
          candidate =>
            candidate.parameters?.length === method.parameters.length &&
            !candidate.isStatic &&
            candidate.parameters.every((parameter, index) => parameter.type.equals(method.parameters[index].type)),
        ) ?? null
      );
    }
    /**
     * Emits the call instruction for a method whose receiver and arguments are on the stack.
     * @param {{receiver?: object, syntax?: object}} options `receiver` is the bound receiver (its kind and type decide
     *   the instruction); absent for a static method
     */
    callMethod(method, { receiver = null, syntax = null, constrainedTo = null } = {}) {
      if (!method?.parameters || !method.containingType) return this.unsupported(`'${method?.name ?? 'a member'}' (no metadata signature)`, syntax);
      const il = this.il,
        effect = { pops: method.parameters.length + (method.isStatic ? 0 : 1), pushes: isVoid(method.returnType) ? 0 : 1 },
        // `base.M()` is not a virtual call: it names the implementation the base class has (its nearest override).
        token = this.tokens.method(receiver?.kind === 'Base' ? baseImplementationOf(method, receiver.type) : method);
      if (method.isStatic) {
        // C# 11: a static abstract or virtual interface member is called on the type argument (`constrained. T call`).
        if (isStaticVirtual(method)) il.emit('constrained.', this.tokens.type(constrainedTo ?? this.typeParameterOf(method, syntax)));
        return il.emit('call', token, effect);
      }
      const type = receiver?.type;
      if (type?.typeKind === TypeKind.TypeParameter) {
        il.emit('constrained.', this.tokens.type(type));
        return il.emit('callvirt', token, effect);
      }
      const isValueReceiver = type && (!isReference(type) || !!primitiveOf(type)),
        isDirect = receiver?.kind === 'Base' || isValueReceiver || (receiver?.kind === 'This' && !occupiesVirtualSlot(method));
      return il.emit(isDirect ? 'call' : 'callvirt', token, effect);
    }
    /**
     * The type parameter a static virtual interface member is called on when the call does not say: the one its
     * signature mentions (the operand of an operator declared as `static abstract T operator +(T, T)`).
     */
    typeParameterOf(method, syntax) {
      const types = [...method.parameters.map(parameter => parameter.type), method.returnType],
        found = types.find(type => type?.typeKind === TypeKind.TypeParameter);
      return found ?? this.unsupported(`the static interface member '${method.name}' called without a type parameter`, syntax);
    }
    /** Calls a property accessor whose receiver (and arguments, and value) are on the stack. */
    callAccessor(accessor, receiverNode, constrainedTo = null) {
      this.callMethod(accessor, { receiver: receiverNode, constrainedTo });
    }
    /**
     * Pushes the arguments of a call in parameter order. Arguments are evaluated in the order they are written, so
     * named arguments out of position go through temporaries.
     */
    arguments(node, method) {
      const positions = node.mapping?.parameterOf,
        inOrder = !positions || positions.every((position, index) => index === 0 || position >= positions[index - 1]),
        push = inOrder ? undefined : this.spillArguments(node.args ?? [], positions, method.parameters ?? []);
      for (const entry of this.argumentList(node, method, push)) entry.emit();
    }
    /**
     * The arguments of a call, one per parameter in parameter order: `{type, emit()}`. A parameter without an argument
     * gets its default, and a `params` parameter the array of its expanded arguments.
     * @param {(argument, parameter) => void} [push] emits one written argument
     */
    argumentList(node, method, push = (argument, parameter) => this.argument(argument, parameter)) {
      const parameters = method.parameters ?? [],
        args = node.args ?? [],
        positions = node.mapping?.parameterOf;
      if (!positions || !parameters.length) {
        return args.map((argument, index) => ({ type: argument.expression.type, emit: () => push(argument, parameters[index]) }));
      }
      const isExpanded = !!node.mapping.expanded,
        last = parameters.length - 1;
      return parameters.map((parameter, index) => {
        const supplied = args.filter((_, argumentIndex) => positions[argumentIndex] === index);
        let emit = () => this.defaultArgument(defaultSourceOf(node, parameter, index), node, index);
        if (isExpanded && index === last) emit = () => this.paramsArray(parameter.type, supplied, push);
        else if (supplied.length) emit = () => push(supplied[0], parameter);
        return { type: parameter.type, emit };
      });
    }
    /** Evaluates every argument now, in source order; the returned function pushes a saved argument. */
    spillArguments(args, positions, parameters) {
      const saved = new Map();
      args.forEach((argument, index) => {
        const parameter = parameters[positions[index]],
          byReference = isByReference(parameter?.refKind);
        this.argument(argument, parameter);
        const slot = this.temp(argument.expression.type ?? parameter.type, { isByReference: byReference });
        this.il.emit('stloc', slot);
        saved.set(argument, slot);
      });
      return argument => this.il.emit('ldloc', saved.get(argument));
    }
    /** One argument: its value, or the address of the variable for a `ref`, `out` or `in` parameter. */
    argument(argument, parameter) {
      const refKind = parameter?.refKind ?? argument.refKind;
      if (!isByReference(refKind)) return this.expression(argument.expression);
      return this.address(argument.expression);
    }
    /** The array a `params` parameter receives in the expanded form of a call. */
    paramsArray(arrayType, supplied, push) {
      const il = this.il,
        elementType = arrayType.elementType;
      if (!elementType) return this.unsupported('params collections other than arrays');
      il.emit('ldc.i4', supplied.length);
      this.newArray(elementType);
      supplied.forEach((argument, index) => {
        il.emit('dup').emit('ldc.i4', index);
        push(argument, null);
        this.storeElement(elementType);
      });
      return undefined;
    }
    /** The value of an omitted optional parameter: caller info, the declared default, or the type's default. */
    defaultArgument(parameter, node, index) {
      const callerInfo = node.callerInfo?.get(parameter.ordinal ?? index);
      if (callerInfo !== undefined) {
        if (typeof callerInfo === 'number') {
          this.il.emit('ldc.i4', callerInfo);
          // [CallerLineNumber] on a parameter of another type that an `int` converts to (`long`, `double`, `object`).
          return this.implicitStandardConversion(this.core.int, parameter.type, node.syntax);
        }
        return this.il.emit('ldstr', this.tokens.string(callerInfo));
      }
      if (parameter.defaultSyntax && !parameter.defaultBound) return this.unsupported('this optional parameter default', node.syntax);
      const value = parameter.explicitDefaultValue ?? parameter.defaultValue;
      if (value === undefined || value === null || value.isNull || typeof value !== 'object') return this.defaultValue(parameter.type);
      this.constantValue(value, node.syntax);
      // A constant kept in another representation than the parameter's (an int default of a long parameter).
      const constantType = this.core.byKeyword.get(value.type);
      if (constantType && primitiveOf(parameter.type) && primitiveOf(constantType) !== primitiveOf(parameter.type)) {
        this.numericConversion(constantType, parameter.type, { syntax: node.syntax });
      }
      return undefined;
    }
    exprPropertyAccess(node) {
      this.propertyLocation(node).load();
    }
    exprIndexerAccess(node) {
      if (node.receiver?.type?.specialType === 'System_String') return this.stringElement(node);
      this.propertyLocation(node).load();
      return undefined;
    }
    /** `text[index]` is `String.get_Chars(int)`. */
    stringElement(node) {
      const shape = { isStatic: false, returnType: this.core.char, parameters: [{ type: this.core.int }] };
      this.expression(node.receiver);
      this.expression(node.args[0].expression);
      return this.il.emit('callvirt', this.tokens.external(this.core.string, 'get_Chars', shape), { pops: 2, pushes: 1 });
    }
    /** The location of a property or indexer access; a get-only auto-property is written through its backing field. */
    propertyLocation(node) {
      const property = node.property,
        definition = property.originalDefinition ?? property;
      if (node.kind === 'PropertyAccess' && !property.setMethod && definition.backingField && this.isBeingAssigned(node)) {
        return this.fieldLocation(definition.backingField, node.receiver, node.type);
      }
      const list = this.argumentList(node, property),
        access = {
          property,
          receiver: node.receiver,
          args: list.map(entry => entry.emit),
          argumentTypes: list.map(entry => entry.type),
          constrainedTo: node.constrainedTo ?? null,
        };
      // A property of a C# 14 extension block: its accessors are static methods that take the receiver first.
      // (A block with type parameters is constructed for the receiver: the block is known to the definition.)
      const accessor = property.getMethod ?? property.setMethod,
        declared = accessor?.originalDefinition ?? accessor,
        receiverParameter = declared?.extensionBlock && declared.extensionReceiver && node.receiver ? accessor.parameters[0] : null;
      if (receiverParameter) {
        access.receiver = null;
        access.args = [() => this.argument({ expression: node.receiver }, receiverParameter), ...access.args];
        access.argumentTypes = [receiverParameter.type, ...access.argumentTypes];
      }
      return new PropertyLocation(this, access, node.type);
    }
    /** True while `node` is the target of the assignment being emitted. */
    isBeingAssigned(node) {
      return this.assignmentTarget === node;
    }
    localFunctionCall(node) {
      return this.unsupported('local functions', node.syntax);
    }
  };
