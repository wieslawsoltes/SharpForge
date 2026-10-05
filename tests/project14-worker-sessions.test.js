import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {RuntimeSessionFactory} from '../apps/studio/workers/runtime-session.js';

const compile = source => {
  const program = compileToIL(source);
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  return program;
};

test('a rejected replacement session cannot stop the active runtime or publish candidate output', () => {
  const factory = new RuntimeSessionFactory(), activeOutput = [], candidateOutput = [];
  const activeProgram = compile('using System; Console.WriteLine("active");');
  const active = factory.create({image: activeProgram.image, debug: false}, {onOutput: value => activeOutput.push(value)});
  const candidateProgram = compile('using System; Console.WriteLine("candidate");');
  assert.throws(() => factory.create({assembly: candidateProgram.assembly, managedIL: true,
    runToCursor: {uri: 'Program.cs', line: 1, column: 1}}, {onOutput: value => candidateOutput.push(value)}), /run-to-instruction/);
  try {
    const result = active.vm.run();
    assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
    assert.equal(activeOutput.join(''), 'active\n');
    assert.equal(candidateOutput.join(''), '');
  } finally { active.stop(); }
});
