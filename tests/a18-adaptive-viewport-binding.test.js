import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalType, frameworkType, contractForMember, findContracts, createRegistry, XAML} from '@sharpforge/framework';
import {normalizeCallType, intrinsicDefinition, supportedIntrinsic, AssemblyInspector, resolveExecutionMethod,
  verifyCilAssembly} from '@sharpforge/cil';
import {viewportCompilation} from './fixtures/a18-adaptive-viewport.js';

const registered = 'Windows.Foundation.TypedEventHandler`2<object, Microsoft.UI.Xaml.WindowSizeChangedEventArgs>';
const compact = 'Windows.Foundation.TypedEventHandler`2<object,Microsoft.UI.Xaml.WindowSizeChangedEventArgs>';
const member = (name = 'add_SizeChanged', parameter = compact) => ({kind: 'method', owner: XAML + 'Window', name,
  signature: {isStatic: false, parameters: [parameter], returnType: 'void', genericArity: 0, callingConvention: 0}});

test('CLI-normalized closed Window delegate resolves to the original registered accessor contract and ABI ID', () => {
  assert.equal(normalizeCallType(registered), compact, 'This is the exact CIL resolver spelling that previously failed');
  assert.equal(canonicalType(compact), registered);
  assert.equal(frameworkType(compact), frameworkType(registered));
  for (const [name, id] of [['add_SizeChanged', 1245200], ['remove_SizeChanged', 1245201]]) {
    const descriptor = member(name);
    const contract = findContracts(XAML + 'Window', name, false)[0];
    assert.equal(contract.id, id);
    assert.equal(contractForMember(descriptor), contract);
    assert.equal(intrinsicDefinition(descriptor)?.contract, contract);
    assert.equal(supportedIntrinsic(descriptor), true);
  }
});

test('emitted MemberRefs verify through actual CIL resolution rather than an event-name allowlist', () => {
  const compiled = viewportCompilation();
  const inspector = new AssemblyInspector(compiled.assembly);
  const descriptors = [...inspector.methods.values()].flatMap(method => inspector.getMethod(method.token).instructions
    .filter(instruction => ['call', 'callvirt'].includes(instruction.name))
    .map(instruction => resolveExecutionMethod(inspector, instruction.operand)))
    .filter(descriptor => descriptor.owner === XAML + 'Window' && descriptor.name === 'add_SizeChanged');
  assert.equal(descriptors.length, 2);
  for (const descriptor of descriptors) {
    assert.equal(descriptor.signature.parameters[0], compact);
    assert.equal(intrinsicDefinition(descriptor)?.contract.id, 1245200);
  }
  const verification = verifyCilAssembly(compiled.assembly);
  assert.equal(verification.success, true, JSON.stringify(verification.issues));
});

test('changed generic arguments, arity, namespace and method shape remain unregistered', () => {
  const invalid = [compact.replace('object,', 'string,'), compact.replace('`2', '`3'), compact.replace('`2', '`1'),
    compact.replace('WindowSizeChangedEventArgs', 'RoutedEventArgs'), compact.replace('Windows.Foundation', 'Unknown.Foundation'),
    compact.replace('EventHandler`2', 'UnknownHandler`2'), compact.replace(',Microsoft', ',object,Microsoft')];
  for (const parameter of invalid) {
    assert.equal(frameworkType(parameter), null);
    assert.equal(contractForMember(member('add_SizeChanged', parameter)), null);
    assert.equal(supportedIntrinsic(member('add_SizeChanged', parameter)), false);
  }
  for (const descriptor of [{...member(), owner: 'Unknown.Window'}, {...member(), name: 'OtherSizeChanged'},
    {...member(), signature: {...member().signature, isStatic: true}},
    {...member(), signature: {...member().signature, returnType: 'int'}},
    {...member(), signature: {...member().signature, parameters: [compact, compact]}}]) {
    assert.equal(contractForMember(descriptor), null);
    assert.equal(supportedIntrinsic(descriptor), false);
  }
});

test('registry aliases reject canonical/compact collisions and roll back with their failed contribution', () => {
  for (const reverse of [false, true]) {
    const registry = createRegistry({reservations: [{name: 'test', start: 0, size: 32}]});
    const names = reverse ? [compact, registered] : [registered, compact];
    assert.throws(() => registry.register({name: 'test', register(api) {
      api.define(names[0]);
      api.define(names[1]);
    }}), /Conflicting registered type alias/);
    assert.equal(registry.frameworkType(compact), null);
    assert.equal(registry.frameworkType(registered), null);
    assert.equal(registry.canonicalType(compact), compact);
    registry.register({name: 'test', register: api => api.define(registered)});
    assert.equal(registry.canonicalType(compact), registered);
    assert.equal(registry.types.get(registered).name, registered);
  }
});
