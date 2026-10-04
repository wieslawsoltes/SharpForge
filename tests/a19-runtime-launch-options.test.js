import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProgramArguments, validateLaunchEnvironment, normalizeRuntimeLaunchOptions,
  runtimeLaunchLimits, runtimeLaunchCapabilities
} from '@sharpforge/runtime';
import { LaunchProfiles } from '../apps/studio/workbench/launch-profiles.js';

test('program argument normalization copies and freezes strings including empty and Unicode values', () => {
  const values = ['', 'snow 雪', '😀'];
  const copied = validateProgramArguments(values);
  values[1] = 'changed';
  assert.deepEqual(copied, ['', 'snow 雪', '😀']);
  assert.equal(Object.isFrozen(copied), true);
  assert.equal(copied.length, 3);
  assert.equal(validateProgramArguments(Array(runtimeLaunchLimits.arguments).fill('')).length, runtimeLaunchLimits.arguments);
  assert.equal(validateProgramArguments(['x'.repeat(runtimeLaunchLimits.argumentCharacters)])[0].length, 65_536);
});

test('argument count, individual size, total size, primitive type and null bytes have explicit limits', () => {
  const tooLong = 'x'.repeat(runtimeLaunchLimits.argumentCharacters + 1);
  for (const value of [null, {}, 'one', [1], ['a\0b'], [tooLong], Array(1025).fill(''), Array(17).fill('x'.repeat(65_536))]) {
    assert.throws(() => validateProgramArguments(value), { code: 'PROGRAM_ARGUMENTS' });
  }
});

test('environment normalization has private storage and never inherits host or prototype entries', () => {
  const input = Object.assign(Object.create(null), { VALUE: '雪', EMPTY: '', constructor: 'literal' });
  Object.defineProperty(input, '__proto__', { value: 'ordinary variable', enumerable: true });
  const environment = validateLaunchEnvironment(input);
  input.VALUE = 'changed';
  assert.equal(environment.VALUE, '雪');
  assert.equal(environment.EMPTY, '');
  assert.equal(environment.constructor, 'literal');
  assert.equal(environment.__proto__, 'ordinary variable');
  assert.equal(Object.getPrototypeOf(environment), null);
  assert.equal(Object.isFrozen(environment), true);
  assert.equal(environment.toString, undefined);
  assert.equal(Object.keys(validateLaunchEnvironment()).length, 0);
});

test('environment names, types, prototypes, per-entry and total sizes reject before launch', () => {
  const entries = count => Object.fromEntries(Array.from({ length: count }, (_, index) => ['VALUE_' + index, 'value']));
  const total = Object.fromEntries(Array.from({ length: 16 }, (_, index) => ['VALUE_' + index, 'x'.repeat(65_536)]));
  const invalid = [
    null, [], 'text', new Date(), Object.create({ INHERITED: 'value' }),
    { '': 'value' }, { '1INVALID': 'value' }, { 'INVALID-NAME': 'value' },
    { ['N'.repeat(257)]: 'value' }, { VALUE: 1 }, { VALUE: 'a\0b' },
    { VALUE: 'x'.repeat(65_537) }, entries(257), total
  ];
  for (const value of invalid) assert.throws(() => validateLaunchEnvironment(value), { code: 'LAUNCH_ENVIRONMENT' });
  assert.equal(Object.keys(validateLaunchEnvironment(entries(256))).length, 256);
  assert.equal(validateLaunchEnvironment({ VALUE: 'x'.repeat(65_536) }).VALUE.length, 65_536);
});

test('process argv cannot replace raw parameters of an explicitly selected method', () => {
  const arguments_ = [19, 23];
  const options = normalizeRuntimeLaunchOptions({ methodToken: 'Add', arguments: arguments_ });
  assert.equal(options.arguments, arguments_);
  assert.equal(options.programArguments, undefined);
  assert.throws(() => normalizeRuntimeLaunchOptions({ arguments: 'wrong' }), { code: 'METHOD_ARGUMENTS' });
  for (const selected of [{ methodToken: 'Add' }, { arguments: [1] }]) {
    assert.throws(() => normalizeRuntimeLaunchOptions({ ...selected, programArguments: ['one'] }), { code: 'PROGRAM_ARGUMENTS_METHOD' });
  }
  assert.doesNotThrow(() => normalizeRuntimeLaunchOptions({ methodToken: 'Add', arguments: [1, 2], programArguments: [] }));
});

test('launch profiles use the same bounds and advertise only the implemented environment capability', () => {
  const profiles = new LaunchProfiles();
  assert.throws(() => profiles.set('App', { arguments: ['a\0b'] }), { code: 'PROGRAM_ARGUMENTS' });
  assert.throws(() => profiles.set('App', { environment: { BAD: 'a\0b' } }), { code: 'LAUNCH_ENVIRONMENT' });
  assert.deepEqual(runtimeLaunchCapabilities, { arguments: true, environment: true, environmentMutation: false });
  profiles.dispose();
});
