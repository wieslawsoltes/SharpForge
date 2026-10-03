import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundedCache, SourceText } from '@sharpforge/text';
import { SyntaxTree } from '@sharpforge/syntax';
import { editSeedDocument, editSmallDocument, editGenerator, applyEdit, assertSameTree } from './support/syntax-edits.js';

// SF-A01-T03.4: randomized incremental-versus-full differential test. Seeded insert, delete and replace edits are
// applied with SyntaxTree.withChangedText and every resulting tree is compared structurally with a full parse of the
// same text. A failure prints the seed and edit index so `replay(seed, edits)` reproduces it.
function replay(seed, edits, options = {}, stats = { reused: 0, incremental: 0 }, document = editSeedDocument) {
  const generator = editGenerator(seed),
    incrementalCache = new BoundedCache(65536),
    fullCache = new BoundedCache(65536);
  let text = document,
    tree = SyntaxTree.parseText(text, { ...options, cache: incrementalCache });
  for (let n = 0; n < edits; n++) {
    if (text.length > document.length * 1.6 || text.length < document.length / 3) {
      text = document;
      tree = SyntaxTree.parseText(text, { ...options, cache: incrementalCache });
    }
    const edit = generator.next(text),
      label = `seed ${seed} edit ${n} ${JSON.stringify(edit)} (replay(${seed}, ${n + 1}))`;
    text = applyEdit(text, edit);
    try {
      tree = tree.withChangedText([edit]);
    } catch (error) {
      error.message = `${label}: ${error.message}`;
      throw error;
    }
    assertSameTree(tree, SyntaxTree.parseText(new SourceText(text, tree.source.uri, tree.source.version), { ...options, cache: fullCache }), label);
    stats.reused += tree.reusedNodeCount;
    stats.incremental++;
  }
  return stats;
}
test('incremental fuzz: 50,000 seeded edits produce trees identical to full parses', () => {
  const stats = { reused: 0, incremental: 0 };
  for (let seed = 1; seed <= 50; seed++)
    replay(
      seed * 7919,
      1000,
      seed % 5 === 0 ? { languageVersion: '7.3' } : seed % 7 === 0 ? { preprocessorSymbols: ['X'] } : {},
      stats,
      seed % 10 === 1 ? editSeedDocument : editSmallDocument
    );
  assert.equal(stats.incremental, 50000);
  assert(stats.reused > 50000, `old nodes are blended into the new trees (${stats.reused})`);
});
test('incremental fuzz: versions are compared with a full parse at the same source version and several changes at once', () => {
  const generator = editGenerator(4242);
  let text = editSeedDocument,
    tree = SyntaxTree.parseText(text);
  for (let n = 0; n < 500; n++) {
    const a = generator.next(text),
      b = generator.next(text),
      [first, second] = a.start <= b.start ? [a, b] : [b, a],
      changes = first.start + first.length <= second.start ? [second, first] : [first];
    for (const change of [...changes].sort((x, y) => y.start - x.start)) text = applyEdit(text, change);
    tree = tree.withChangedText(changes);
    assertSameTree(tree, SyntaxTree.parseText(new SourceText(text, tree.source.uri, tree.source.version)), `multi-change ${n}`);
    if (text.length > 5000 || text.length < 200) {
      text = editSeedDocument;
      tree = SyntaxTree.parseText(text);
    }
  }
});
