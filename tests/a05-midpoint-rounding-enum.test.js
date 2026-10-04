import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {createRegistry, enumTypes, frameworkType, enumValue, canonicalType} from '@sharpforge/framework';
import {
  contributionManifest, idReservations, bclExtensionContribution, collectionExtensionContribution
} from '../packages/framework/src/contributions/manifest.js';
import {jsonExtensionContribution} from '../packages/framework/src/contributions/json.js';
import {numericTypeContribution} from '../packages/framework/src/contributions/numeric.js';

const name = 'System.MidpointRounding';
const values = {ToEven: 0, AwayFromZero: 1, ToZero: 2, ToNegativeInfinity: 3, ToPositiveInfinity: 4};

function compile(body) {
  const result = compileToIL(`using System; using Mode = System.MidpointRounding;
    class P { static void Main() { ${body} } }`);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}

function assertOutput(body, expected) {
  const compiled = compile(body);
  const engines = [
    ['source', () => new VirtualMachine(compiled.image)],
    ['reload', () => new VirtualMachine(loadAssembly(compiled.assembly))],
    ['CIL', () => new CilVirtualMachine(compiled.assembly)]
  ];
  for (const [engine, create] of engines) {
    const result = create().run();
    assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
    assert.equal(result.output, expected, engine);
  }
}

test('MidpointRounding exposes exactly the pinned .NET names and Int32 values', () => {
  const descriptor = frameworkType(name);
  assert.equal(descriptor.kind, 'enum');
  assert.equal(descriptor.base, 'System.Enum');
  assert.deepEqual(descriptor.values, values);
  assert(Object.isFrozen(descriptor.values));
  assert.equal(canonicalType('MidpointRounding'), name);
  for (const [member, value] of Object.entries(values)) {
    assert.deepEqual(enumValue(`${name}.${member}`), {type: name, value});
  }
  assert.equal(enumValue(`${name}.ToNearest`), null);
});

test('numeric enum contribution appends identity without allocating or moving any member contracts', () => {
  const registry = createRegistry({reservations: idReservations});
  registry.registerAll([
    ...contributionManifest, bclExtensionContribution, collectionExtensionContribution, jsonExtensionContribution
  ]);
  const priorEnums = [...registry.types.values()].filter(type => type.kind === 'enum').map(type => type.name);
  const priorContracts = [...registry.contracts];
  registry.register(numericTypeContribution);
  assert.deepEqual([...registry.types.values()].filter(type => type.kind === 'enum').map(type => type.name),
    [...priorEnums, name]);
  assert.deepEqual(enumTypes, [...priorEnums, name]);
  assert.equal(registry.contracts.length, priorContracts.length);
  for (const [index, contract] of priorContracts.entries()) assert.strictEqual(registry.contracts[index], contract);
  assert.throws(() => registry.register(numericTypeContribution), /Duplicate contribution/);
});

test('all named modes retain enum identity and values through source, emitted CIL and reload', () => {
  assertOutput(`Mode[] modes = new Mode[] { MidpointRounding.ToEven, Mode.AwayFromZero, Mode.ToZero,
    System.MidpointRounding.ToNegativeInfinity, Mode.ToPositiveInfinity };
    foreach (Mode mode in modes) Console.WriteLine(mode.ToString());`,
  'ToEven\nAwayFromZero\nToZero\nToNegativeInfinity\nToPositiveInfinity\n');
});

test('enum defaults and explicit unnamed Int32 values use existing enum storage and formatting', () => {
  assertOutput(`Mode[] modes = new Mode[3]; modes[1] = (Mode)(-1); modes[2] = (Mode)2147483647;
    foreach (Mode mode in modes) Console.WriteLine(mode.ToString());
    Mode local = Mode.ToPositiveInfinity; Console.WriteLine(local.ToString());`,
  'ToEven\n-1\n2147483647\nToPositiveInfinity\n');
});

test('missing enum names and implicit nonzero numeric conversions stay rejected', () => {
  for (const body of ['Console.WriteLine(MidpointRounding.ToNearest);',
    'MidpointRounding mode = 1;', 'int mode = MidpointRounding.ToEven;']) {
    const result = compileToIL(`using System; class P { static void Main() { ${body} } }`);
    assert.equal(result.success, false, body);
    assert(result.diagnostics.some(diagnostic => diagnostic.severity === 'error'));
  }
});
