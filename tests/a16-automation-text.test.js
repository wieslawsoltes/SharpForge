import test from 'node:test';
import assert from 'node:assert/strict';
import { TextUnit } from '../packages/winui-controls/src/automation/index.js';
import { automationFixture, automationNode as node } from './helpers/a16-automation.js';

test('text provider reports live UTF-16 ranges, selections and grapheme-safe moves', () => {
  const fixture = automationFixture([node('root', 'TextBox', { Text: 'A😀e\u0301 word\nnext', SelectionStart: 1, SelectionLength: 2 })]);
  const provider = fixture.peer('root').GetPattern('Text');
  assert.equal(provider.GetSelection()[0].GetText(), '😀');
  const range = provider.DocumentRange;
  range.ExpandToEnclosingUnit(TextUnit.Character);
  assert.equal(range.GetText(), 'A');
  assert.equal(range.Move(TextUnit.Character, 1), 1);
  assert.equal(range.GetText(), '😀');
  assert.equal(range.Move(TextUnit.Character, 1), 1);
  assert.equal(range.GetText(), 'e\u0301');
  const found = provider.DocumentRange.FindText('WORD', false, true);
  assert.equal(found.GetText(), 'word');
  found.Select();
  assert.deepEqual(fixture.actions.at(-1), { id: 'root', method: 'SelectText', args: [6, 4] });
  fixture.nodes.get('root').properties.Text = 'x';
  assert.equal(range.GetText(), '');
  assert.throws(() => range.GetBoundingRectangles(), /shaping service/);
});

test('text range validation and geometry use explicit shaping adapters', () => {
  const fixture = automationFixture([node('root', 'TextBox', { Text: 'first\nsecond' })]);
  fixture.host.services.text = { hitTest: () => 3, rangeBounds: () => [{ x: 12, y: 4, width: 20, height: 16 }],
    unitBoundaries: () => [0, 6, 12], visibleRanges: () => [{ start: 0, end: 5 }] };
  const provider = fixture.peer('root').GetPattern('Text');
  assert.equal(provider.RangeFromPoint({ X: 12, Y: 4 }).start, 3);
  assert.equal(provider.GetVisibleRanges()[0].GetText(), 'first');
  const range = provider.DocumentRange.Clone();
  range.ExpandToEnclosingUnit(TextUnit.Line);
  assert.equal(range.GetText(), 'first\n');
  assert.deepEqual(range.GetBoundingRectangles(), [12, 4, 20, 16]);
  assert.throws(() => range.GetText(-2), /Invalid text length/);
  assert.throws(() => range.Move(TextUnit.Character, 0.5), /integer/);
  assert.throws(() => range.AddToSelection(), /Multiple text selections/);
});

test('case-insensitive range search preserves source UTF-16 offsets after expanding Unicode mappings', () => {
  const { peer } = automationFixture([node('root', 'TextBox', { Text: 'İx İstanbul' })]);
  const document = peer('root').GetPattern('Text').DocumentRange;
  const range = document.FindText('x', false, true);
  assert.equal(range.GetText(), 'x');
  assert.equal(range.start, 1);
  assert.equal(range.end, 2);
});
