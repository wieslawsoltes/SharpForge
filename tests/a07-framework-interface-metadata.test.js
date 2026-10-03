import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegistry} from '@sharpforge/framework';
import {RegistryBridge} from '../packages/compiler/src/symbols/registry-bridge.js';
import {TypeKind} from '../packages/compiler/src/symbols/types.js';
import {MethodTableRegistry} from '../packages/runtime/src/execution/method-table.js';
import {CastCache} from '../packages/runtime/src/execution/casting.js';
import {frameworkMethodTable} from '../packages/runtime/src/execution/framework-method-table.js';

const stringInterface = 'Fixture.ICompare`1<string>';
const objectInterface = 'Fixture.ICompare`1<object>';

function fixture() {
  const registry = createRegistry({reservations: [{name: 'fixture', start: 100, size: 16}]});
  registry.register({name: 'fixture', register(target) {
    for (const element of ['string', 'object']) {
      const name = `Fixture.ICompare\`1<${element}>`;
      target.define(name, {kind: 'bcl', typeKind: 'interface', base: null, variance: ['in']});
      target.member(name, 'Compare', [element, element], 'int', {isAbstract: true});
    }
    target.define('Fixture.Parent', {interfaces: [stringInterface], isAbstract: true});
    target.define('Fixture.Child', {base: 'Fixture.Parent', isSealed: true});
  }});
  return registry;
}

function bridgeFor(registry) {
  return new RegistryBridge({types: registry.types, contracts: registry.contracts, builtins: []});
}

test('framework metadata: interface assignment follows declared and inherited edges', () => {
  const registry = fixture();
  assert.equal(registry.frameworkAssignable(stringInterface, 'Fixture.Parent'), true);
  assert.equal(registry.frameworkAssignable(stringInterface, 'Fixture.Child'), true);
  assert.equal(registry.frameworkAssignable(objectInterface, 'Fixture.Child'), false);
  assert.equal(registry.frameworkAssignable('Fixture.Parent', stringInterface), false);
  assert.equal(registry.frameworkAssignable('object', stringInterface), true);
});

test('framework metadata: compiler symbols retain interface shape, variance and inherited interfaces', () => {
  const bridge = bridgeFor(fixture());
  const interfaceType = bridge.typeFromName(stringInterface);
  assert.equal(interfaceType.typeKind, TypeKind.Interface);
  assert.equal(interfaceType.baseType, null);
  assert.equal(interfaceType.isAbstract, true);
  assert.equal(interfaceType.isSealed, false);
  assert.equal(interfaceType.originalDefinition.typeParameters[0].variance, 'in');
  assert.ok(bridge.typeFromName('Fixture.Child').allInterfaces.some(type => type.equals(interfaceType)));
  assert.equal(bridge.typeFromName('Fixture.Parent').isAbstract, true);
  assert.equal(bridge.typeFromName('Fixture.Child').isSealed, true);
});

test('framework metadata: open comparer signatures retain abstract generic parameters', () => {
  const bridge = bridgeFor(fixture());
  const definition = bridge.typeFromName(stringInterface).originalDefinition;
  const method = definition.getMembers('Compare')[0];
  assert.equal(method.isAbstract, true);
  assert.equal(method.parameters[0].type, definition.typeParameters[0]);
  assert.equal(method.parameters[1].type, definition.typeParameters[0]);
  assert.equal(definition.baseType, null);
  assert.equal(bridge.typeFromName(stringInterface).getMembers('Compare')[0].isAbstract, true);
});

test('framework metadata: projected interfaces participate in runtime casts and contravariance', () => {
  const registry = new MethodTableRegistry();
  registry.define({name: 'Fixture.IConsumer`1', ...frameworkMethodTable({typeKind: 'interface', variance: ['in']})});
  registry.define({name: 'Fixture.Parent', ...frameworkMethodTable({
    interfaces: ['Fixture.IConsumer`1<object>'], isAbstract: true
  })});
  registry.define({name: 'Fixture.Child', ...frameworkMethodTable({base: 'Fixture.Parent', isSealed: true})});
  const cache = new CastCache(registry);
  const child = registry.get('Fixture.Child');
  const target = registry.get('Fixture.IConsumer`1<string>');
  assert.equal(target.flags.interface, true);
  assert.equal(target.base, null);
  assert.equal(child.flags.sealed, true);
  assert.equal(child.base.flags.abstract, true);
  assert.equal(cache.isAssignableFrom(target, child), true);
  assert.equal(cache.isAssignableFrom(child, target), false);
});

for (const kind of ['unknown', 'class', 'cycle', 'non-array']) {
  test(`framework metadata: ${kind} interface contribution is rejected and rolled back`, () => {
    const registry = createRegistry({reservations: [{name: 'shapes', start: 0, size: 16}]});
    assert.throws(() => registry.register({name: 'shapes', register(target) {
      const interfaces = kind === 'non-array' ? 'Target' : [kind === 'cycle' ? 'Shape' : 'Target'];
      target.define('Shape', {interfaces, typeKind: 'interface'});
      if (kind === 'class') target.define('Target');
    }}), /interface/);
    assert.equal(registry.types.size, 0);
    assert.equal(registry.contracts.length, 0);
  });
}
