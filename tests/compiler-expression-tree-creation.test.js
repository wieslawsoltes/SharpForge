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
import { fixtures } from '../packages/compiler/test/differential/fixtures/expression-tree-creation.js';
import { dotnetHost, sdkVersion, openDotnetScratch, runFixtureOnDotnet } from '../packages/compiler/test/differential/tools/dotnet-axis.mjs';

test('A02-T07.5 anonymous, nested-initializer and rectangular-array trees have complete factory descriptions', () => {
  for (const fixture of fixtures) {
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
    assert.ok(count >= 3, `${fixture.id}: all declared trees were visited`);
  }
});

const pack = loadReferencePack();
const dotnet = dotnetHost();
const sdk = pack ? sdkVersion(dotnet) : null;
const skip = !pack || !sdk ? 'a .NET SDK and reference pack are required' : false;

test('A02-T07.5 creation tree ToString, node walks and compiled delegates match real Roslyn output', { skip }, t => {
  const pins = loadPinned().results;
  const scratch = openDotnetScratch({ dotnet, sdk, pack });
  try {
    for (const fixture of fixtures) {
      const pin = pins.get(fixture.id);
      assert.ok(pin, `a real Roslyn pin is required for ${fixture.id}`);
      const result = runFixtureOnDotnet(fixture, pin, scratch.context('references'));
      assert.equal(result.ok, true, `${fixture.id}: ${result.detail}`);
    }
    t.diagnostic(`.NET SDK ${sdk}, reference pack ${pack.version}; compared with stored Roslyn output`);
  } finally {
    scratch.close();
  }
});
