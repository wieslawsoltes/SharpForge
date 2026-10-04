import test from 'node:test';
import assert from 'node:assert/strict';
import {Op} from '@sharpforge/bytecode';
import {loadAssembly} from '@sharpforge/cil';
import {microbenchmarks} from '../bench/vm/fixtures.js';
import {compileFixture, artifactForEngine, createVM, assertOutput, withVM, runVM} from '../bench/vm/operations.js';
import {virtualAssembly} from '../bench/vm/virtual.js';
import {hash} from '../bench/vm/evidence.js';
import {validateReport} from '../bench/vm/report-validation.js';
import {reportFixture, syntheticOptions} from './a05-12-fixtures.js';

const fixture = microbenchmarks.find(item => item.virtual);

for (const engine of ['source', 'reloaded', 'cil']) test(`T12 ${engine} virtual route executes its declared dispatch`, async () => {
  const artifact = compileFixture(fixture);
  const selected = artifactForEngine(engine, artifact);
  if (engine === 'cil') {
    assert.equal(hash(selected.assembly), hash(virtualAssembly(fixture.iterations)));
    assert.equal(fixture.dispatchByEngine[engine], 'class-override-callvirt');
  } else {
    const image = engine === 'source' ? selected.image : loadAssembly(selected.assembly);
    const main = image.methods.find(method => method.name === 'Main');
    const calls = [];
    for (let index = 0; index < main.code.length; index += 3) {
      if (main.code[index] === Op.CALLVIRT) calls.push(main.code[index + 1]);
    }
    assert.equal(calls.length, 1, 'the loop executes a real interface dispatch site');
    assert.equal(image.methods[calls[0]].owner, 'IValue');
    assert.equal(fixture.dispatchByEngine[engine], 'interface-callvirt');
    assert.notEqual(hash(selected.assembly), hash(artifact.assembly));
  }
  await withVM(() => createVM(engine, artifact, {maxInstructions: 20000000}), async vm => {
    await runVM(vm);
    assertOutput(vm, fixture);
    assert.equal(Number(vm.returnValue), 140000);
  });
});

test('T12 source virtual fixture catches substituting the interface default for the implementation', async () => {
  const wrong = {...fixture, source: fixture.source.replace('return 7;', 'return 0;')};
  await withVM(() => createVM('source', compileFixture(wrong)), async vm => {
    await runVM(vm);
    assert.throws(() => assertOutput(vm, fixture), /incorrect result/);
  });
});

test('T12 report validation rejects labeling interface dispatch as the CIL class-override workload', () => {
  const report = reportFixture({engine: 'source'});
  report.rows.find(row => row.fixture === 'virtual').dispatch = 'class-override-callvirt';
  assert.throws(() => validateReport(report, syntheticOptions), /virtual dispatch mechanism/);
});
