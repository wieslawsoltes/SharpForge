/**
 * Lowering of member uses that become calls: method invocation (source, framework, delegate, local function),
 * object creation with initializers, properties, indexers and events.
 */
import { BuiltinMap } from '@sharpforge/bytecode';
import { TypeKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { defaultSourceOf } from '../../overload/override-parameters.js';
import { n } from './node-factory.js';
import {objectSlotSymbol} from './object-slots.js';

const primitiveToString = new Set(['int', 'double', 'bool', 'string']);


/** Class mixin: calls, creation, properties, indexers, events. */
export const CallTranslation = Base =>
  class extends Base {
    /**
     * Lowered arguments in parameter order: named arguments placed, defaults filled in and a `params` tail packed
     * into an array. Arguments are evaluated in source order, so out-of-order named arguments go through temporaries.
     */
    arguments(node, method) {
      const parameters = method?.parameters ?? [],
        args = node.args ?? [],
        mapping = node.mapping;
      for (const a of args) if (a.refKind && a.refKind !== 'none') this.unsupported('ref, out and in arguments', a.expression?.syntax ?? node.syntax);
      let values = args.map(a => this.expression(a.expression));
      if (!mapping?.parameterOf || !parameters.length) return values;
      const positions = mapping.parameterOf,
        inOrder = positions.every((p, i) => i === 0 || p >= positions[i - 1]);
      let prefix = null;
      if (!inOrder) {
        const temps = values.map(value => this.temp(value.legacyType, 'arg'));
        prefix = { locals: temps, effects: values.map((value, i) => n.assign(n.local(temps[i]), value)) };
        values = temps.map(temp => n.local(temp));
      }
      const last = parameters.length - 1,
        fixed = mapping.expanded ? last : parameters.length,
        slots = new Array(fixed).fill(null),
        rest = [];
      const elementType = mapping.expanded ? this.imageType(parameters[last].type.elementType, node.syntax) : null;
      values.forEach((value, i) => {
        if (mapping.expanded && positions[i] === last) rest.push(this.objectArgument(value, elementType));
        else slots[positions[i]] = value;
      });
      const lowered = slots.map((value, i) => value ?? this.defaultArgument(defaultSourceOf(node, parameters[i], i), node, i));
      if (mapping.expanded) {
        lowered.push(n.newArray(elementType, n.literal(rest.length, 'int'), rest));
      }
      if (prefix && lowered.length) lowered[0] = n.sequence(prefix.locals, prefix.effects, lowered[0]);
      return lowered;
    }
    defaultArgument(parameter, node, index) {
      const type = this.imageType(parameter.type, node.syntax),
        value = parameter.explicitDefaultValue ?? parameter.defaultValue;
      // Caller info replaces the declared default (binder/caller-info.js).
      const callerInfo = node.callerInfo?.get(parameter.ordinal);
      if (callerInfo !== undefined) {
        const supplied = typeof callerInfo === 'number' ? 'int' : 'string';
        // The line number converts like any `int` constant: to `double` at compile time.
        if (supplied === 'int' && type === 'double') return n.literal(callerInfo, 'double');
        if (type !== supplied && type !== 'object') return this.unsupported(`caller info for a parameter of type '${type}'`, node.syntax);
        return n.literal(callerInfo, supplied);
      }
      // A default that was never bound must not silently become zero.
      if (parameter.defaultSyntax && !parameter.defaultBound) return this.unsupported('this optional parameter default', node.syntax);
      if (value === undefined || value === null || value.isNull) return this.defaultValue(type);
      const raw = value.value ?? value;
      if (raw !== null && typeof raw === 'object') return this.unsupported('this optional parameter default', node.syntax);
      return n.literal(typeof raw === 'bigint' ? Number(raw) : raw, type);
    }
    exprCall(node) {
      // An omitted call to a [Conditional] method evaluates nothing, not even its arguments.
      if (node.isOmitted) return n.nullLiteral('object');
      const method = node.method,
        definition = method.originalDefinition ?? method;
      if (method.methodKind === MethodKind.FunctionPointerSignature) {
        return this.unsupported('function pointers (the image has no indirect-call instruction)', node.syntax);
      }
      if (method.methodKind === MethodKind.DelegateInvoke || node.isDelegateInvoke) {
        const info = this.g.delegates.classOf(node.receiver.type, node.syntax);
        return this.g.delegates.invoke(info, this.expression(node.receiver), this.arguments(node, method));
      }
      if (method.methodKind === MethodKind.LocalFunction) return this.localFunctionCall(definition, this.arguments(node, method), node.syntax);
      if (this.g.isSource(definition)) {
        // The method as written at the call: its containing construction and type arguments select the image method.
        const record = this.g.methodOf(method, node.syntax),
          args = this.arguments(node, method);
        if (record.isStatic) return n.call(record, null, args);
        return n.call(record, this.receiver(node), args);
      }
      if (method.typeArguments?.length || definition.typeParameters?.length) return this.unsupported('generic framework methods', node.syntax);
      return this.frameworkInvocation(node, method);
    }
    receiver(node) {
      if (!node.receiver) return this.unsupported('an instance call without a receiver', node.syntax);
      if (node.receiver.kind === 'Base') return this.unsupported('base member access', node.syntax);
      return this.expression(node.receiver);
    }
    frameworkInvocation(node, method) {
      const type = this.imageType(node.type, node.syntax);
      const objectSlot = method.containingType.specialType === 'System_Object' && objectSlotSymbol(method);
      if (objectSlot && node.receiver) {
        if (node.receiver.kind === 'Base') return this.unsupported('base member access', node.syntax);
        let receiver = this.expression(node.receiver);
        if (!this.types.isReference(receiver.legacyType)) receiver = {
          kind: 'BoxValue', legacyType: 'object', isExpression: true, operand: receiver, valueType: receiver.legacyType
        };
        return n.frameworkCall({builtin: BuiltinMap.get('object.' + objectSlot)}, null,
          [receiver, ...this.arguments(node, method)], type);
      }
      if (method.contract || method.builtin) {
        const receiver = method.isStatic || !node.receiver ? null : this.expression(node.receiver);
        this.checkFrameworkParameters(method, node.syntax);
        return n.frameworkCall(method, receiver, this.contractArguments(method.contract, this.arguments(node, method)), type);
      }
      const iterator = node.receiver && !method.isStatic ? this.g.iterators.infoOf(this.imageType(node.receiver.type, node.syntax)) : null;
      if (iterator) return this.iteratorCall(iterator, method, this.expression(node.receiver), node.syntax);
      if (method.name === 'ToString' && !method.parameters.length && node.receiver) {
        const receiver = this.expression(node.receiver);
        if (primitiveToString.has(receiver.legacyType))
          return n.frameworkCall({ builtin: BuiltinMap.get('object.ToString') }, null, [receiver], 'string');
      }
      return this.unsupported(`'${method.toDisplayString()}' (not in the framework registry)`, node.syntax);
    }
    /** Members of IEnumerable<T> and IEnumerator<T> on an iterator object are calls of the shared class's dispatchers. */
    iteratorCall(info, method, receiver, syntax) {
      switch (method.name) {
        case 'GetEnumerator':
        case 'GetAsyncEnumerator':
          return n.call(info.getEnumerator, null, [receiver]);
        case 'MoveNextAsync':
        case 'DisposeAsync':
          return this.iteratorTask(info, method.name, receiver);
        case 'MoveNext':
          return n.call(info.moveNext, null, [receiver]);
        case 'Dispose':
          return n.call(info.dispose, null, [receiver]);
        default:
          return this.unsupported(`'${method.toDisplayString()}' on an iterator`, syntax);
      }
    }
    /** Lowered delegates are image classes; the framework expects its own delegate objects. */
    checkFrameworkParameters(method, syntax) {
      if (method.parameters.some(p => p.type?.typeKind === TypeKind.Delegate)) this.unsupported('passing a delegate to a framework method', syntax);
    }
    exprObjectCreation(node) {
      const type = node.type;
      if (type.typeKind === TypeKind.Delegate) return this.unsupported('this delegate creation form', node.syntax);
      let creation;
      if (this.g.isSource(type)) {
        const record = this.g.classOf(type, node.syntax),
          ctor = node.constructor && typeof node.constructor === 'object' && node.constructor.kind ? node.constructor : null;
        const implicit = this.g.implicitConstructors.get(type) ?? null;
        const method = ctor && !ctor.isImplicitlyDeclared ? this.g.methodOf(ctor, node.syntax) : implicit;
        creation = n.construct(record, method, method && method !== implicit ? this.arguments(node, ctor) : []);
      } else creation = this.frameworkCreation(node);
      const initializers = node.initializers ?? [];
      if (!initializers.length && !node.collectionInitializers?.length) return creation;
      return this.withInitializers(node, creation);
    }
    frameworkCreation(node) {
      const ctor = node.constructor;
      const name = this.imageType(node.type, node.syntax);
      if (!ctor || typeof ctor !== 'object' || !(ctor.contract || ctor.builtin))
        return this.unsupported(`creating '${node.type.toDisplayString()}' (constructor not in the framework registry)`, node.syntax);
      this.checkFrameworkParameters(ctor, node.syntax);
      return {
        kind: 'ObjectCreationExpression',
        legacyType: name,
        isExpression: true,
        type: {},
        constructorMethod: ctor.builtin ? { builtin: ctor.builtin } : { contract: ctor.contract },
        args: this.contractArguments(ctor.contract, this.arguments(node, ctor)),
        initializers: [],
        collectionInitializers: [],
      };
    }
    memberReceiver(node) {
      const receiver = node.receiver;
      if (!receiver) return null;
      // The receiver of an initializer target stands for the object being created, which is already in a temporary.
      if (node.isInitializerTarget && this.initializerReceiver) return this.initializerReceiver.read();
      if (receiver.kind === 'Base') return this.unsupported('base member access', node.syntax);
      return this.expression(receiver);
    }
    exprPropertyAccess(node) {
      return this.propertyReference(node);
    }
    /** A property as a readable and assignable node: source accessors are image methods, framework ones contracts. */
    propertyReference(node) {
      const property = node.property,
        type = this.imageType(node.type, node.syntax);
      if (this.g.isSource(property)) {
        const legacy = this.g.propertyOf(property, node.syntax);
        const receiver = legacy.isStatic ? null : this.memberReceiver(node);
        return { kind: 'PropertyAccess', legacyType: type, isExpression: true, property: { legacy }, receiver };
      }
      const get = property.getMethod,
        set = property.setMethod;
      const iterator = property.name === 'Current' && node.receiver ? this.g.iterators.infoOf(this.imageType(node.receiver.type, node.syntax)) : null;
      if (iterator) return n.field(this.memberReceiver(node), iterator.currentField);
      if (!(get?.contract || get?.builtin || set?.contract))
        return this.unsupported(`'${property.toDisplayString()}' (not in the framework registry)`, node.syntax);
      const receiver = property.isStatic ? null : this.memberReceiver(node);
      if (get?.builtin) return { kind: 'PropertyAccess', legacyType: type, isExpression: true, property: { builtin: get.builtin }, receiver };
      return { kind: 'PropertyAccess', legacyType: type, isExpression: true, property: { getMethod: get, setMethod: set }, receiver };
    }
    exprIndexerAccess(node) {
      if (this.g.isSource(node.property)) {
        const getter = node.property.getMethod;
        if (!getter) return this.unsupported('reading a write-only indexer', node.syntax);
        return n.call(this.g.methodOf(getter, node.syntax), this.expression(node.receiver), this.arguments(node, node.property));
      }
      return this.indexerReference(node);
    }
    indexerReference(node) {
      const property = node.property,
        get = property.getMethod,
        set = property.setMethod;
      if (!(get?.contract || set?.contract)) return this.unsupported(`'${property.toDisplayString()}' (not in the framework registry)`, node.syntax);
      if (node.args.length !== 1) return this.unsupported('indexers with several arguments', node.syntax);
      return {
        kind: 'IndexerAccess',
        legacyType: this.imageType(node.type, node.syntax),
        isExpression: true,
        receiver: this.expression(node.receiver),
        indexer: { getMethod: get?.contract ? get : null, setMethod: set?.contract ? set : null },
        args: node.args.map(a => this.expression(a.expression)),
      };
    }
    /** `receiver[args] = value` on a user-defined indexer: a call of the set accessor that yields the stored value. */
    sourceIndexerStore(node, value) {
      const setter = node.property.setMethod;
      if (!setter) return this.unsupported('assignment to a read-only indexer', node.syntax);
      const stored = this.temp(value.legacyType, 'value'),
        args = this.arguments(node, node.property);
      const store = n.call(this.g.methodOf(setter, node.syntax), this.expression(node.receiver), [...args, n.local(stored)]);
      return n.sequence([stored], [n.assign(n.local(stored), value), store], n.local(stored));
    }
    exprEventAccess(node) {
      const record = this.g.eventFieldOf(node.event, node.syntax);
      return record.isStatic ? n.staticField(record) : n.field(this.memberReceiver(node), record);
    }
    /** `e += handler` and `e -= handler`: a field-like event combines into its field, otherwise the accessor is called. */
    exprEventAssignment(node) {
      // The event as written (its containing construction selects the image field); `hasBody` is known to the definition.
      const event = node.event,
        definition = event.originalDefinition ?? event,
        handler = this.expression(node.handler),
        adding = node.operator === '+=';
      if (!this.g.isSource(event)) return this.unsupported('framework events with lowered delegates', node.syntax);
      const accessor = adding ? definition.addMethod : definition.removeMethod;
      if (accessor?.hasBody) {
        const record = this.g.methodOf(adding ? event.addMethod : event.removeMethod, node.syntax);
        return n.call(record, record.isStatic ? null : this.expression(node.receiver), [handler]);
      }
      const record = this.g.eventFieldOf(event, node.syntax),
        info = this.g.delegates.classOf(event.type, node.syntax),
        combine = (current, value) => (adding ? this.g.delegates.combine(info, current, value) : this.g.delegates.remove(info, current, value));
      if (record.isStatic) return n.assign(n.staticField(record), combine(n.staticField(record), handler));
      const receiver = this.once(this.expression(node.receiver), 'target');
      const store = n.assign(n.field(receiver.read(), record), combine(n.field(receiver.read(), record), handler));
      return n.sequence(receiver.locals, receiver.effects, store);
    }
  };
