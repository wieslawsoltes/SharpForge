import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { walk } from '../packages/compiler/src/bound/semantic-walker.js';
import { lowerExpressionTree } from '../packages/compiler/src/lowering/expression-trees.js';
import { expressionTreeDelegate } from '../packages/compiler/src/symbols/expression-tree-types.js';
import { loadPinned } from '../packages/compiler/test/differential/corpus-store.js';
import { fixtures as creation } from '../packages/compiler/test/differential/fixtures/expression-tree-creation.js';
import { fixtures as operators } from '../packages/compiler/test/differential/fixtures/expression-tree-operators.js';
import { fixtures as delegates } from '../packages/compiler/test/differential/fixtures/expression-tree-delegates.js';
import { dotnetHost, sdkVersion, openDotnetScratch, runFixtureOnDotnet } from '../packages/compiler/test/differential/tools/dotnet-axis.mjs';

const fixtures = [...creation, ...operators, ...delegates];

test('A02-T07.5 creation, operator and delegate trees have complete factory descriptions', async t => {
  for (const fixture of fixtures) {
    await t.test(fixture.id, () => {
      const analysis = analyze([parse(new SourceText(fixture.source, 'Program.cs'))]);
      assert.deepEqual(analysis.diagnostics.filter(row => row.severity === 'error'), [], fixture.id);
      let count = 0;
      for (const body of analysis.bound.values()) {
        walk(body, node => {
          const delegate = node.kind === 'Conversion' ? expressionTreeDelegate(node.type, analysis.core) : null;
          if (!delegate || node.operand?.kind !== 'Lambda') return true;
          const lowered = lowerExpressionTree(node.operand, delegate, analysis.core);
          assert.equal(lowered.unsupported, undefined, `${fixture.id}: ${lowered.unsupported}`);
          assert.equal(lowered.tree.factory, 'Lambda');
          count++;
          return false;
        });
      }
      assert.ok(count >= 3, `${fixture.id}: declared trees were visited`);
    });
  }
});

const pack = loadReferencePack();
const dotnet = dotnetHost();
const sdk = pack ? sdkVersion(dotnet) : null;
const skip = !pack || !sdk ? 'a .NET SDK and reference pack are required' : false;

test('A02-T07.5 tree text, node walks and compiled behavior match real Roslyn output', { skip }, async t => {
  const pins = loadPinned().results;
  const scratch = openDotnetScratch({ dotnet, sdk, pack });
  try {
    for (const fixture of fixtures) {
      await t.test(fixture.id, () => {
        const pin = pins.get(fixture.id);
        assert.ok(pin, `a real Roslyn pin is required for ${fixture.id}`);
        const result = runFixtureOnDotnet(fixture, pin, scratch.context('references'));
        assert.equal(result.ok, true, `${fixture.id}: ${result.detail}`);
      });
    }
    t.diagnostic(`.NET SDK ${sdk}, reference pack ${pack.version}; compared with stored Roslyn output`);
  } finally {
    scratch.close();
  }
});
