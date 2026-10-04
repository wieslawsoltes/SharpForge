import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { findDirectDebugWrites, checkSessionStateOwnership, scanSessionStateOwnership,
  sessionStateOwners } from '../scripts/quality/session-state-ownership.js';

test('session state lint detects direct, computed, compound, destructuring and prefix writes', () => {
  const examples = [
    'state.debug = event;', 'this.state.debug=null;', "state['debug'] ??= event;", 'state.debug ||= event;',
    'state["debu\\u0067"] = null;', '++state.debug;', 'this.state.debug--;', 'delete state.debug;',
    '[state.debug] = values;', '({debug:state.debug}=value);', 'state.\\u0064ebug = value;', '++this.state.debug;'
  ];
  for (const source of examples) assert.equal(findDirectDebugWrites(source).length, 1, source);
});

test('session state lint excludes reads, equality, strings, comments and unrelated state properties', () => {
  const source = [
    'if (state.debug === null || this.state.debug == event) read(state.debug);',
    'state.debugSources = value; state.other = state.debug;',
    'const message="state.debug = null"; // state.debug = ignored;',
    '/* state["debug"] = ignored; */ const pattern=/state.debug = /;',
    'const template=`state.debug = ignored ${state.debug?.state}`;'
  ].join('\n');
  assert.deepEqual(findDirectDebugWrites(source), []);
  assert.equal(findDirectDebugWrites('const template=`value ${state.debug = event}`;').length, 1);
});

test('session state lint accepts only explicitly inventoried owners and includes stable diagnostics', () => {
  const source = 'read();\nstate.debug = event;';
  const diagnostics = checkSessionStateOwnership([
    ...sessionStateOwners.map(path => [path, source]),
    ['apps\\studio\\future-tool.js', source], ['apps/studio/studio.js', source]
  ]);
  assert.deepEqual(diagnostics.map(item => [item.code, item.path, item.line]), [
    ['SFST0001', 'apps/studio/future-tool.js', 2], ['SFST0001', 'apps/studio/studio.js', 2]
  ]);
});

test('all Studio modules keep direct debug-state writes inside session owners', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const diagnostics = await scanSessionStateOwnership(root);
  assert.deepEqual(diagnostics, [], JSON.stringify(diagnostics, null, 2));
});
