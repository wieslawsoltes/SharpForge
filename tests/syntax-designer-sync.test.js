import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesign, generateDesignCode, readDesignSource } from '@sharpforge/designer';

// Regression for the designer source-sync "blocked" state (tests/browser_release13_test.py, incomplete-source step).
// The designer writes numbers as `Width = 248.0`. Deleting only `248` leaves `Width =.0`, which is valid C# - `.0` is a
// real literal (SF-A01-T04.3) - so the sync must read it as 0. Only genuinely incomplete source may block the sync.
const source = generateDesignCode(createDesign('Sync')), property = /Width = (\d+(?:\.\d+)?)/.exec(source);
test('designer sync: incomplete C# blocks the source read with SFSYNC_PARSE', () => {
  assert(property, 'generated design code assigns a Width');
  for (const broken of [source.replace(property[0], 'Width ='), source.replace(property[0], 'Width = ('), source.slice(0, source.lastIndexOf('}'))])
    assert.throws(() => readDesignSource(broken), error => error.code === 'SFSYNC_PARSE', broken.slice(property.index - 20, property.index + 30));
  assert.equal(readDesignSource(source).text, source);
});
test('designer sync: a leading-dot real literal is valid source and reads as a number', () => {
  const edited = source.replace(property[0], 'Width =.0'), analysis = readDesignSource(edited);
  assert(analysis.document.nodes.some(node => node.properties.Width === 0), 'Width =.0 is read as 0');
  assert(readDesignSource(source.replace(property[0], 'Width = .5')).document.nodes.some(node => node.properties.Width === 0.5));
});
