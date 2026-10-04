import test from 'node:test';
import assert from 'node:assert/strict';
import {FORMAT_VERSION, Op, verifyImage} from '@sharpforge/bytecode';
import {VirtualMachine} from '@sharpforge/runtime';
import {sourceConstant, sourceInitialValue} from '../packages/runtime/src/execution/source-numbers.js';

function imageWith(value, staticValue = 0) {
  return {
    formatVersion: FORMAT_VERSION,
    entryPoint: 0,
    constants: [value],
    types: [],
    sequencePoints: [],
    statics: [{type: 'long', value: staticValue}],
    methods: [{
      id: 0,
      qualifiedName: 'Program.Main',
      parameters: [],
      isStatic: true,
      locals: [],
      handlers: [],
      code: Int32Array.from([Op.CONST, 0, 0, Op.RET, 0, 0]),
    }],
  };
}

test('present but falsy scalar tags are rejected in constants and static initializers', () => {
  for (const scalar of ['', 0, false, null, undefined, NaN]) {
    const invalid = {scalar, value: '1'};
    for (const image of [imageWith(invalid), imageWith(0, invalid)]) {
      assert(verifyImage(image).some(error => error.includes('Invalid scalar constant')));
      assert.throws(() => new VirtualMachine(image), /Invalid scalar constant/);
    }
  }
});

test('source load adapters do not return malformed scalar wire records as guest objects', () => {
  for (const scalar of ['', 0, false, null, undefined, NaN]) {
    const value = {scalar, value: '1'};
    const vm = {image: {constants: [value]}, options: {}, constantValues: new Map()};
    assert.throws(() => sourceConstant(vm, 0), {name: 'InvalidProgramException'});
    assert.throws(() => sourceInitialValue(vm, {type: 'long', value}), {name: 'InvalidProgramException'});
    assert.equal(vm.constantValues.size, 0);
  }
});

test('ordinary constants and valid scalar records retain their load behavior', () => {
  for (const value of [null, false, 0, 'text', {scalar: 'long', value: '9223372036854775807'}]) {
    assert.deepEqual(verifyImage(imageWith(value)), []);
  }
  const value = {scalar: 'long', value: '-9223372036854775808'};
  const vm = {image: {constants: [value, false, 0]}, options: {}, constantValues: new Map()};
  assert.equal(sourceConstant(vm, 0), -9223372036854775808n);
  assert.equal(sourceInitialValue(vm, {type: 'long', value}), -9223372036854775808n);
  assert.equal(sourceConstant(vm, 1), false);
  assert.equal(sourceConstant(vm, 2), 0);
});
