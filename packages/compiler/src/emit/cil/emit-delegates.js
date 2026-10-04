/**
 * Delegates (SF-A02-T30): delegate creation from lambdas, local functions and method groups, combination and
 * removal, and events.
 *
 * A delegate is `newobj D::.ctor(object target, native int method)` over `ldftn` (or `dup; ldvirtftn` for a virtual
 * method, so that the override of the target's class is bound); invocation is a `callvirt` of `D::Invoke`.
 */
import { TypeKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { isReference } from './type-facts.js';

const isVirtualSlot = method => !!(method.isVirtual || method.isAbstract || method.isOverride) || method.containingType?.typeKind === TypeKind.Interface;

/** Class mixin: delegates and events. */
export const DelegateEmission = Base =>
  class extends Base {
    /** `newobj` of a delegate whose target and function pointer are on the stack. */
    newDelegate(type) {
      return this.il.emit('newobj', this.tokens.delegateConstructor(type), { pops: 2, pushes: 1 });
    }
    anonymousFunctionConversion(node) {
      if (node.type.typeKind !== TypeKind.Delegate) return this.unsupported('a lambda converted to an expression tree', node.syntax);
      return this.functionDelegate(this.functionPlan(node.operand, node.syntax), node.type);
    }
    /** A lambda passed where a delegate is expected is bound to that delegate type without a conversion node. */
    exprLambda(node) {
      if (node.boundAs?.typeKind !== TypeKind.Delegate) return this.unsupported('a lambda that is not converted to a delegate type', node.syntax);
      return this.functionDelegate(this.functionPlan(node, node.syntax), node.boundAs);
    }
    functionDelegate(plan, type, method = null) {
      this.pushFunctionTarget(plan, true);
      this.il.emit('ldftn', this.functionToken(plan, method));
      return this.newDelegate(type);
    }
    methodGroupConversion(node) {
      const group = node.operand,
        method = node.conversion.method ?? group.methods?.[0],
        il = this.il;
      if (!method) return this.unsupported('this method group conversion', node.syntax);
      if (node.type.typeKind !== TypeKind.Delegate) return this.unsupported('a method group converted to a function pointer', node.syntax);
      if (method.methodKind === MethodKind.LocalFunction) {
        return this.functionDelegate(this.functionPlan(method.originalDefinition ?? method, node.syntax), node.type, method);
      }
      if (method.isExtensionMethod && group.receiver && method.isStatic) return this.extensionDelegate(node, method);
      if (method.isStatic) {
        il.emit('ldnull').emit('ldftn', this.tokens.method(method));
        return this.newDelegate(node.type);
      }
      const receiver = group.receiver;
      if (receiver) {
        this.expression(receiver);
        if (!isReference(receiver.type)) il.emit('box', this.tokens.type(receiver.type));
      } else this.exprThis(node);
      if (isVirtualSlot(method)) il.emit('dup').emit('ldvirtftn', this.tokens.method(method));
      else il.emit('ldftn', this.tokens.method(method));
      return this.newDelegate(node.type);
    }
    /**
     * `receiver.Extension` as a delegate: the receiver is evaluated once and becomes the delegate's target, which
     * the runtime passes as the first argument of the static method (a delegate closed over its first argument).
     * The receiver is a reference (CS1113 otherwise); a type parameter known to be a reference is boxed.
     */
    extensionDelegate(node, method) {
      const receiver = node.operand.receiver;
      this.expression(receiver);
      if (receiver.type?.typeKind === TypeKind.TypeParameter) this.il.emit('box', this.tokens.type(receiver.type));
      // The conversion selected the method in its reduced form (without the receiver parameter).
      this.il.emit('ldftn', this.tokens.method(method.reducedFrom ?? method));
      return this.newDelegate(node.type);
    }
    /**
     * `new D(expression)`: a lambda or method group is converted to `D`; a delegate value becomes the target of a
     * new delegate over its `Invoke` method.
     */
    exprDelegateCreation(node) {
      const operand = node.operand,
        invoke = operand?.type?.delegateInvokeMethod;
      if (!operand) return this.unsupported('this delegate creation form', node.syntax);
      if (operand.kind === 'Conversion' || operand.kind === 'Lambda') return this.expression(operand);
      if (!invoke) return this.unsupported('a delegate created from a value that is not a delegate', node.syntax);
      this.expression(operand);
      this.il.emit('ldftn', this.tokens.method(invoke));
      return this.newDelegate(node.type);
    }
    /**
     * `a == b` and `a != b` over two values of delegate types compare invocation lists (`Delegate.op_Equality`: the
     * same methods on the same targets), not references. A comparison with the `null` literal stays a reference
     * comparison, and so does one with a value typed `System.Delegate` (Roslyn 5.0 prints False for two equal
     * delegates compared that way).
     */
    binaryInstruction(node) {
      const isEquality = node.operator === '==' || node.operator === '!=',
        isNull = operand => !!operand.constantValue && (operand.constantValue.isNull || operand.constantValue.value === null),
        // The binder compares the operands as objects: the delegate is under the reference conversion.
        written = operand => (operand.kind === 'Conversion' && !operand.isExplicit && operand.operand?.type ? written(operand.operand) : operand),
        isDelegate = operand => written(operand).type?.typeKind === TypeKind.Delegate;
      if (!isEquality || node.method || isNull(written(node.left)) || isNull(written(node.right))) return super.binaryInstruction(node);
      if (!isDelegate(node.left) || !isDelegate(node.right)) return super.binaryInstruction(node);
      const delegate = this.core.delegate,
        shape = { isStatic: true, returnType: this.core.bool, parameters: [{ type: delegate }, { type: delegate }] },
        name = node.operator === '==' ? 'op_Equality' : 'op_Inequality';
      return this.il.emit('call', this.tokens.external(delegate, name, shape), { pops: 2, pushes: 1 });
    }
    /** `a + b` and `a - b` over delegates: `Delegate.Combine` / `Delegate.Remove`, cast back to the delegate type. */
    delegateOperator(node) {
      this.expression(node.left);
      this.expression(node.right);
      return this.combineDelegates(node.operator === '+', node.type);
    }
    combineDelegates(isAdd, type) {
      const delegate = this.core.delegate,
        shape = { isStatic: true, returnType: delegate, parameters: [{ type: delegate }, { type: delegate }] };
      this.il.emit('call', this.tokens.external(delegate, isAdd ? 'Combine' : 'Remove', shape), { pops: 2, pushes: 1 });
      return this.il.emit('castclass', this.tokens.type(type));
    }
    /** `e += handler` and `e -= handler` call the event's accessor. */
    exprEventAssignment(node) {
      const event = node.event,
        isAdd = node.operator === '+=',
        token = this.tokens.eventAccessor(event, isAdd);
      if (!token) return this.unsupported(`the event '${event.toDisplayString()}'`, node.syntax);
      if (!event.isStatic) this.receiver(node.receiver);
      this.expression(node.handler);
      const isDirect = event.isStatic || !isReference(node.receiver.type) || node.receiver.kind === 'This' || node.receiver.kind === 'Base';
      this.il.emit(isDirect ? 'call' : 'callvirt', token, { pops: event.isStatic ? 1 : 2, pushes: 0 });
      return false;
    }
    /** A field-like event used as a value inside its class is its delegate field. */
    exprEventAccess(node) {
      this.eventLocation(node).load();
    }
    eventLocation(node) {
      const token = this.tokens.eventField(node.event);
      if (!token) return this.unsupported(`the event '${node.event.toDisplayString()}' as a value`, node.syntax);
      return this.tokenFieldLocation({ token, isStatic: !!node.event.isStatic }, node.receiver, node.type);
    }
    location(node) {
      return node.kind === 'EventAccess' ? this.eventLocation(node) : super.location(node);
    }
  };
