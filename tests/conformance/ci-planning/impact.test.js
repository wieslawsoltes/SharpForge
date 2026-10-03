import test from 'node:test';
import assert from 'node:assert/strict';
import { selectImpact } from '../../../scripts/conformance/ci-planning/impact.js';

const manifests = ['A00', 'A19', 'A29', 'A05'].map(area => ({
  area, nodeGlobs: [`tests/${area}.test.js`], nodeFiles: [`tests/${area}.test.js`], browserScripts: [],
}));
const graph = { errors: [], modules: [
  { path: 'packages/editor/src/index.js', dependencies: [] },
  { path: 'tests/A19.test.js', dependencies: ['packages/editor/src/index.js'] },
] };
const ownership = { areas: { A19: { write: ['packages/editor/**'], evidence: ['tests/A19.test.js'] } } };
const select = input => selectImpact({ manifests, graph, ownership, files: ['packages/editor/src/index.js'], ...input });

test('editor changes select actual consumers, owner and shared areas within one core', () => {
  const plan = select();
  assert.equal(plan.mode, 'impacted');
  assert.deepEqual(plan.areas, ['A00', 'A19', 'A29']);
  assert.equal(plan.nodeFiles.length, 3);
});
test('merge queue, unknown module, unresolved graph and non-JS changes fall back to full', () => {
  for (const input of [
    { eventName: 'merge_group' }, { files: ['packages/editor/missing.js'] },
    { files: ['packages/editor/style.css'] }, { graph: { errors: ['unresolved import'], modules: [] } },
  ]) {
    assert.equal(select(input).mode, 'full');
    assert.equal(select(input).areas.length, manifests.length);
  }
});
test('documentation-only changes keep shared checks without pretending browser qualification', () => {
  const plan = select({ files: ['docs/README.md'] });
  assert.deepEqual(plan.areas, ['A00', 'A29']);
  assert.deepEqual(plan.browserScripts, []);
});
