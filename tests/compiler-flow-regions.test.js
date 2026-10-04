import test from 'node:test';
import assert from 'node:assert/strict';
import { SemanticModel } from '@sharpforge/compiler';
import { regions } from '../packages/compiler/test/flow-regions/regions.js';
import { loadPinned, markedSpan, regionHash, variableSets } from '../packages/compiler/test/flow-regions/store.js';

const pinned = loadPinned();
const names = symbols => symbols.map(symbol => symbol.name).sort();

/** The answers of the semantic model for the marked region of a program, in the shape of the pins. */
function analyze(source) {
  const { model } = SemanticModel.create([{ uri: 'Program.cs', text: source }], { semantic: true }),
    { start, end } = markedSpan(source),
    data = model.analyzeDataFlow(start, end),
    control = model.analyzeControlFlow(start, end),
    result = {};
  for (const key of variableSets) result[key] = names(data[key]);
  result.startPointIsReachable = control.startPointIsReachable;
  result.endPointIsReachable = control.endPointIsReachable;
  result.returnStatements = control.returnStatements.length;
  result.exitPoints = control.exitPoints.length;
  result.entryPoints = control.entryPoints.length;
  return result;
}

test('SF-A02-T35 corpus: every region has a current pinned Roslyn result', () => {
  assert(regions.length >= 30, `expected at least 30 regions, found ${regions.length}`);
  assert.match(String(pinned.roslyn?.version), /^\d+\.\d+/);
  assert.equal(new Set(regions.map(region => region.id)).size, regions.length, 'ids are unique');
  for (const region of regions) {
    const pin = pinned.regions[region.id];
    assert(pin, `${region.id}: not pinned; run node packages/compiler/test/flow-regions/tools/pin.mjs`);
    assert.equal(pin.hash, regionHash(region), `${region.id}: changed since it was pinned; run tools/pin.mjs`);
  }
  assert.deepEqual(Object.keys(pinned.regions).sort(), regions.map(region => region.id).sort());
});

for (const region of regions) {
  test(`SF-A02-T35 region ${region.id} matches Roslyn`, () => {
    const { hash, region: span, ...expected } = pinned.regions[region.id];
    assert.deepEqual(analyze(region.source), expected);
  });
}

test('SF-A02-T35 a span without a statement gets the position-based sets; a span outside a body gets nothing', () => {
  const source = regions.find(region => region.id === 'straight-line-reads-and-writes').source,
    { model } = SemanticModel.create([{ uri: 'Program.cs', text: source }], { semantic: true }),
    start = source.indexOf('x * 2'),
    expression = model.analyzeDataFlow(start, start + 'x * 2'.length);
  assert.deepEqual(names(expression.readInside), ['x']);
  assert.deepEqual(names(expression.dataFlowsIn), ['x']);
  assert.deepEqual(names(expression.writtenInside), []);
  assert.deepEqual(names(expression.dataFlowsOut), []);
  assert.deepEqual(model.analyzeControlFlow(start, start + 5).statements, []);
  assert.equal(model.analyzeDataFlow(0, 5), null, 'the using directive is not in a method body');
});
