import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyControlRegions} from '../packages/cil/src/control-flow-profile.js';

function issues(target = 4, opcode = 'leave') {
  const instructions = Array.from({length: 9}, (_, offset) => ({
    offset, size: 1, name: offset === 8 ? 'ret' : offset % 2 ? 'leave' : 'nop',
    operandKind: offset % 2 ? 'br32' : 'none', operand: offset < 4 ? 4 : 8,
  }));
  Object.assign(instructions[1], {name: opcode, operand: target});
  const method = {instructions, codeSize: 9, handlers: [
    {flags: 0, start: 0, end: 2, target: 2, handlerEnd: 4, catchType: 1},
    {flags: 0, start: 4, end: 6, target: 6, handlerEnd: 8, catchType: 1},
  ]};
  const result = [];
  verifyControlRegions({resolveToken: () => ({kind: 'type'})}, method,
    (_, instruction, code, message) => result.push({offset: instruction?.offset, code, message}));
  return result;
}

test('T04: leave enters a subsequent try only at its first instruction', () => {
  assert.deepEqual(issues(), []);
  for (const target of [5, 6, 7]) {
    assert(issues(target).some(issue => issue.offset === 1 && issue.code === 'IL_EH'));
  }
  assert(issues(4, 'br').some(issue => issue.offset === 1 && issue.code === 'IL_EH'));
});
