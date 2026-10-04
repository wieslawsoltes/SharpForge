import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '@sharpforge/workspace';
import { ExtensionDriver, UnreferencedLocalAnalyzer } from '@sharpforge/extensions';

/** Compile one top-level or class-based program with the unreferenced-local analyzer enabled. */
function analyze(text) {
  const extensions = new ExtensionDriver().registerAnalyzer(UnreferencedLocalAnalyzer);
  const workspace = new Workspace({ extensions });
  workspace.update('Program.cs', text, 1);
  return workspace.compile();
}

const locals = result => result.symbols.filter(symbol => symbol.kind === 'local').map(symbol => symbol.name);
const unreferenced = result => result.diagnostics.filter(diagnostic => diagnostic.code === 'SFAN1001');

test('synthesized top-level entry parameters have no IDE symbol and no analyzer diagnostic', () => {
  const result = analyze('int used = 1;\nConsole.WriteLine(used);');
  assert(result.success, JSON.stringify(result.diagnostics));
  assert.deepEqual(locals(result), ['used']);
  assert.deepEqual(unreferenced(result), []);
});

test('the implicit args parameter still binds when top-level statements read it', () => {
  const result = analyze('Console.WriteLine(args.Length);');
  assert(result.success, JSON.stringify(result.diagnostics));
  assert.deepEqual(locals(result), []);
  assert.deepEqual(unreferenced(result), []);
});

test('declared locals and declared parameters keep their source spans', () => {
  const local = analyze('int unused = 1;');
  assert.deepEqual(unreferenced(local).map(d => [d.start, d.length]), [[4, 6]]);
  const source = 'class P { static void Main(string[] args) { } }';
  const parameter = analyze(source);
  assert.deepEqual(unreferenced(parameter).map(d => [d.start, d.length]), [[source.indexOf('args'), 4]]);
});
