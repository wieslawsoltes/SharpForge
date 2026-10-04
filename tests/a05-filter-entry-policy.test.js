import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, verifyCilAssembly, verifiedStackBound} from '@sharpforge/cil';
import {validateHandlerEntryHeights} from '../packages/cil/src/verify/handlers-access.js';
import {controlFixture} from './support/control-fixture.js';

test('filtered exception seeds require explicit policy while ordinary nonempty try entries remain invalid', () => {
  const instructions = [0, 10, 12, 20, 22].map(offset => ({offset}));
  const method = {
    instructions,
    handlers: [
      {flags: 1, start: 0, target: 10},
      {flags: 2, start: 10, target: 12},
      {flags: 2, start: 20, target: 22}
    ]
  };
  const offsets = new Map(instructions.map((instruction, index) => [instruction.offset, index]));
  const heights = new Map([[0, 0], [1, 1], [2, 0], [3, 1], [4, 0]]);
  for (const options of [undefined, {filteredHandlers: false}, {filteredHandlers: true}]) {
    const issues = [];
    const issue = (_method, instruction, code, message, details) =>
      issues.push({offset: instruction.offset, code, message, height: details.height});
    if (options === undefined) validateHandlerEntryHeights(method, offsets, heights, issue);
    else validateHandlerEntryHeights(method, offsets, heights, issue, options);
    assert.deepEqual(issues.map(item => item.offset), options?.filteredHandlers ? [20] : [10, 20]);
    for (const item of issues) {
      assert.equal(item.code, 'IL_EH_ENTRY');
      assert.equal(item.height, 1);
      assert.match(item.message, /Ordinary try entry requires an empty evaluation stack/);
    }
  }
});

function nestedFilteredHandler(delayed) {
  let entryOffset;
  const bytes = controlFixture([{name: 'Program', methods: [{
    name: 'Main',
    maxStack: 1,
    body(writer) {
      writer.mark('outer').op('ldnull').op('throw').mark('outerEnd');
      writer.mark('filter').op('pop').integer(1).op('endfilter').mark('handler');
      if (delayed) writer.op('nop');
      writer.mark('inner').op('pop').op('leave', 'afterInner');
      writer.mark('finally').op('endfinally').mark('afterInner');
      writer.op('leave', 'done').mark('done').op('ret');
      entryOffset = writer.labels.get('inner');
    },
    handlers(labels) {
      return [
        {flags: 2, start: labels.get('inner'), end: labels.get('finally'),
          target: labels.get('finally'), handlerEnd: labels.get('afterInner')},
        {flags: 1, start: labels.get('outer'), end: labels.get('outerEnd'),
          target: labels.get('handler'), handlerEnd: labels.get('done'), catchType: labels.get('filter')}
      ];
    }
  }]}]);
  return {bytes, entryOffset};
}

test('execution verification preserves the filtered-handler seed only at its exact nested try entry', () => {
  for (const delayed of [false, true]) {
    const fixture = nestedFilteredHandler(delayed);
    const inspector = new AssemblyInspector(fixture.bytes);
    const method = inspector.getMethod(0x06000001);
    const filtered = method.handlers.find(handler => handler.flags === 1);
    assert.equal(fixture.entryOffset === filtered.target, !delayed);
    const report = verifyCilAssembly(inspector);
    assert.equal(report.success, !delayed, JSON.stringify(report.issues));
    if (delayed) {
      const issues = report.issues.filter(issue => issue.code === 'IL_EH_ENTRY');
      assert.equal(issues.length, 1);
      assert.equal(issues[0].offset, fixture.entryOffset);
      assert.equal(verifiedStackBound(inspector, report, method), null);
    } else {
      assert.deepEqual(report.issues, []);
      assert.ok(verifiedStackBound(inspector, report, method));
    }
  }
});
