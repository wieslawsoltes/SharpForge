import {frameworkType, canonicalType} from '@sharpforge/framework';
import {UnsetValue, ValueSource, readPathStep, writePathStep, observePathStep, convertBindingValue} from '@sharpforge/winui-properties';
import {ManagedFault, isReference} from '../heap.js';
import {ManagedMemberAccess} from './member-access.js';
import {ManagedBindingEvents} from './binding-events.js';
import {createManagedCompiledBindingCompiler} from './compiled-xaml.js';
import {createManagedCollectionProjector} from './binding-collections.js';

const memberName = member => member.name.replace(/^(get_|set_|add_|remove_)/, '');

/** Source and CIL binding access use the same property engine and explicit managed invocation seam. */
export function createManagedBindingServices(context) {
  const members = new ManagedMemberAccess(context);
  const events = new ManagedBindingEvents(context, members);
  const collection = createManagedCollectionProjector(context, members, events);
  const heap = context.platform.heap;
  const registry = context.propertyRegistry;
  const nativeModel = receiver => isReference(receiver)
    ? context.modelState.owners.get(context.id(receiver))?.states.get('nativeModel')?.value ?? receiver
    : receiver;
  const nameScope = owner => {
    const reference = context.read(owner, '$nameScope');
    return reference ? context.unwrapModel(reference) : context.services.namescopeFor?.(owner);
  };
  const vectorSource = (receiver, step) => {
    if (step.kind !== 'index' && !['Item', 'Count', 'Length', 'Size'].includes(step.name)) return null;
    return frameworkType(context.typeOf(receiver))?.kind === 'collection' ? context.vectorFor?.(receiver) : collection(receiver);
  };

  function dependencyProperty(receiver, step) {
    if (!isReference(receiver) || step.kind === 'index') return null;
    if (!context.properties.assignable('Microsoft.UI.Xaml.DependencyObject', context.typeOf(receiver))) return null;
    return registry.lookup(step.owner ?? context.typeOf(receiver), step.name);
  }

  function arrayAccess(receiver, step, value, writing = false) {
    const record = heap.get(receiver);
    if (record.kind !== 'array') return {handled: false};
    if (step.kind !== 'index') {
      if (writing) throw new ManagedFault('MissingMemberException', 'Managed array properties are read-only');
      return {handled: true, value: ['Count', 'Length'].includes(step.name) ? record.data.length : UnsetValue};
    }
    const index = step.key;
    if (!Number.isSafeInteger(index) || index < 0 || index >= record.data.length) {
      if (!writing) return {handled: true, value: UnsetValue};
      throw new ManagedFault('IndexOutOfRangeException', 'Binding array index is outside the source');
    }
    const element = canonicalType(record.type.slice(0, -2));
    if (!writing) return {handled: true, value: members.native(record.data[index], element)};
    const managed = members.managed(value, element);
    const oldValue = record.data[index];
    record.data[index] = managed;
    context.platform.vm.notifyWrite({kind: 'element', handle: receiver.h, generation: receiver.g, index, oldValue, value: managed});
    return {handled: true, value};
  }

  function read(receiver, step) {
    const native = nativeModel(receiver);
    if (native !== receiver || !isReference(receiver)) return readPathStep(native, step, {});
    const array = arrayAccess(receiver, step);
    if (array.handled) return array.value;
    const vector = vectorSource(receiver, step);
    if (vector) return step.kind === 'index' ? readPathStep(vector, step, {}) : vector.Count;
    if (step.kind !== 'attached') {
      const member = members.named(receiver, step.kind === 'index' ? 'Item' : step.name);
      if (member) return members.read(receiver, member, step.kind === 'index' ? [step.key] : []);
    }
    const property = dependencyProperty(receiver, step);
    if (property) return context.storeFor(receiver).getValue(property);
    const field = frameworkType(context.typeOf(receiver))?.properties?.[step.name];
    return field ? members.native(context.read(receiver, step.name), field.type) : UnsetValue;
  }

  function write(receiver, step, value) {
    const native = nativeModel(receiver);
    if (native !== receiver || !isReference(receiver)) return writePathStep(native, step, value, {});
    return heap.withRoots([receiver, value], () => {
      const array = arrayAccess(receiver, step, value, true);
      if (array.handled) return array.value;
      const vector = vectorSource(receiver, step);
      if (vector) {
        if (step.kind !== 'index') throw new ManagedFault('MissingMemberException', 'Vector size is read-only');
        return vector.set_Item(step.key, value);
      }
      if (step.kind !== 'attached') {
        const member = members.named(receiver, step.kind === 'index' ? 'Item' : step.name);
        if (member) return members.write(receiver, member, value, step.kind === 'index' ? [step.key] : []);
      }
      const property = dependencyProperty(receiver, step);
      if (!property) throw new ManagedFault('MissingMemberException', 'Binding source property is unavailable');
      return context.storeFor(receiver).setValue(property, value);
    });
  }

  function subscribe(receiver, step, changed) {
    const native = nativeModel(receiver);
    if (native !== receiver || !isReference(receiver)) return observePathStep(native, step, changed, {});
    const property = dependencyProperty(receiver, step);
    if (property) return context.storeFor(receiver).subscribe(property, changed);
    const vector = vectorSource(receiver, step);
    if (vector) return observePathStep(vector, {...step, name: ['Length', 'Size'].includes(step.name) ? 'Count' : step.name}, changed, {});
    return events.subscribe(receiver, 'PropertyChanged', changed, {propertyName: step.kind === 'index' ? 'Item' : step.name});
  }

  function sourcePropertyType(receiver, step) {
    if (!step || !isReference(receiver)) return 'object';
    const property = dependencyProperty(receiver, step);
    if (property) return property.propertyType;
    const record = heap.get(receiver);
    if (step.kind === 'index' && record.kind === 'array') return canonicalType(record.type.slice(0, -2));
    const definition = frameworkType(record.type);
    if (definition?.kind === 'collection') return step.kind === 'index' ? definition.elementType ?? definition.element ?? 'object' : 'int';
    const list = vectorSource(receiver, step);
    if (list) return step.kind === 'index' ? list.methods.get_Item.returnType : 'int';
    return members.named(receiver, step.kind === 'index' ? 'Item' : step.name)?.type ?? 'object';
  }

  function invokeConverter(receiver, name, args, {valueType = 'object'} = {}) {
    const method = members.method(receiver, name, 4, {interfaceType: 'Microsoft.UI.Xaml.Data.IValueConverter'});
    if (!method) throw new ManagedFault('MissingMethodException', 'Managed IValueConverter method is unavailable');
    return heap.withRoots([receiver, args[0], args[2]], () => {
      const type = context.typeValue(args[1]);
      heap.pins.push(type);
      return members.invoke(receiver, method, [args[0], type, args[2], args[3]], {argumentTypes: [valueType]});
    });
  }

  function tokenProperty(receiver, member) {
    return isReference(receiver) && context.properties.assignable('Microsoft.UI.Xaml.DependencyObject', context.typeOf(receiver))
      ? registry.lookup(context.typeOf(receiver), memberName(member)) : null;
  }

  function get(receiver, token, indexes = []) {
    const member = members.byToken(token);
    const property = tokenProperty(receiver, member);
    if (property && member.kind === 'contract') return context.storeFor(receiver).getValue(property);
    return members.read(receiver, member, indexes);
  }

  function set(receiver, token, value, {source = ValueSource.Local, indexes = []} = {}) {
    let member = members.byToken(token);
    const property = tokenProperty(receiver, member);
    if (property && (source !== ValueSource.Local || member.kind === 'contract')) {
      return context.storeFor(receiver).setSource(property, source, value);
    }
    if (member.kind === 'method' && member.name.startsWith('get_')) {
      member = members.named(receiver ?? member.owner, memberName(member));
    }
    return heap.withRoots([receiver, value], () => members.write(receiver, member, value, indexes));
  }

  const compiled = {
    get, set: (receiver, token, value, indexes = []) => set(receiver, token, value, {indexes}),
    targetGet: get,
    targetSet: (receiver, token, value) => set(receiver, token, value, {source: ValueSource.Binding}),
    subscribe: (receiver, token, changed) => subscribe(receiver, {kind: 'property', name: memberName(members.byToken(token))}, changed),
    targetSubscribe: (receiver, token, changed) => subscribe(receiver, {kind: 'property', name: memberName(members.byToken(token))}, changed),
    subscribeEvent: (receiver, token, changed) => {
      const name = memberName(members.byToken(token));
      const native = nativeModel(receiver);
      if (native !== receiver && typeof native.addEvent === 'function') {
        native.addEvent(name, changed);
        return () => native.removeEvent(name, changed);
      }
      return events.subscribe(receiver, name, changed);
    },
    invoke: (receiver, token, args) => {
      const member = members.byToken(token);
      return members.invokeToken(receiver, member, args);
    },
    isType: (receiver, token) => members.isType(receiver, token),
    identity: receiver => isReference(receiver) ? `${receiver.h}:${receiver.g}` : receiver,
    setLoad: (receiver, name, value) => {
      const deferred = context.services.deferredElementsFor?.(receiver);
      if (!deferred) throw new ManagedFault('NotSupportedException', 'Compiled x:Load requires its generated deferred element scope');
      return deferred.setLoad(name, value);
    },
    beginRestore: () => events.beginRestore(), endRestore: () => events.endRestore()
  };

  return {
    members, events, compiled, collection, read, write, subscribe, sourcePropertyType, invokeConverter,
    compileBinding: createManagedCompiledBindingCompiler(context), deferredElementIdentity: reference => heap.get(reference),
    storeFor: receiver => context.storeFor(receiver), typeOf: receiver => context.typeOf(receiver),
    findName: (owner, name) => context.findName?.(owner, name) ?? nameScope(owner)?.findName(name) ?? null,
    subscribeNameScope: (owner, changed, name) => nameScope(owner)?.subscribe(name, changed),
    templatedParent: owner => context.read(owner, '$templateOwner'),
    subscribeTemplatedParent: (owner, changed) => context.services.subscribeTemplatedParent?.(owner, changed),
    convert: (value, type) => convertBindingValue(value, type, {typeDefinition: frameworkType, ...context.services.conversion}),
    diagnostics: diagnostic => context.services.bindingDiagnostics?.(diagnostic),
    beginRestore: () => events.beginRestore(), endRestore: () => events.endRestore(),
    snapshot: () => events.snapshot(), restore: snapshot => events.restore(snapshot),
    prune: () => events.prune(), dispose: () => events.dispose()
  };
}
