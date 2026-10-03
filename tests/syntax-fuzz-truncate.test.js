import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SourceText, BoundedCache } from '@sharpforge/text';
import { SyntaxTree, lex, parse, matchesGrammar } from '@sharpforge/syntax';
import { fixtureRoot, filesUnder } from './support/syntax-reference.js';

// SF-A01-T12.1: truncation fuzzer. Every corpus file is cut at every token boundary; each prefix must parse without an
// exception, in bounded time, and round-trip byte for byte.
const corpus = ['reference', 'lexer-corpus', 'expression-corpus']
  .flatMap(directory => filesUnder(join(fixtureRoot, directory)))
  .map(file => ({ name: file.slice(fixtureRoot.length + 1), text: readFileSync(file, 'utf8') }));
test('truncate: every corpus file cut at every token boundary parses, round-trips and stays within the time budget', () => {
  assert(corpus.length >= 40, String(corpus.length));
  const cache = new BoundedCache(65536);
  let inputs = 0,
    slowest = 0;
  for (const { name, text } of corpus) {
    const boundaries = new Set();
    for (const token of lex(new SourceText(text)).tokens) {
      boundaries.add(token.start);
      boundaries.add(token.end);
    }
    for (const cut of boundaries) {
      const prefix = text.slice(0, cut),
        start = performance.now();
      let tree;
      try {
        tree = SyntaxTree.parseText(prefix, { cache });
      } catch (error) {
        assert.fail(`${name} cut at ${cut}: ${error.stack}`);
      }
      const elapsed = performance.now() - start;
      slowest = Math.max(slowest, elapsed);
      assert(elapsed < 5000, `${name} cut at ${cut} took ${elapsed} ms`);
      if (tree.toFullString() !== prefix) assert.fail(`${name} cut at ${cut}: round-trip failed`);
      if (tree.green.fullWidth !== prefix.length) assert.fail(`${name} cut at ${cut}: width`);
      if (inputs % 40 === 0) {
        assert(matchesGrammar(tree.green), `${name} cut at ${cut}`);
        try {
          assert.equal(parse(prefix).green.fullText, prefix);
        } catch (error) {
          assert.fail(`${name} cut at ${cut} (legacy adapter): ${error.stack}`);
        }
      }
      inputs++;
    }
  }
  assert(inputs > 15000, `${inputs} truncated inputs`);
  assert(slowest < 5000);
});
test('truncate: cuts inside tokens (strings, comments, directives, interpolations) also round-trip', () => {
  let seed = 99;
  const random = n => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 8) % n;
  };
  for (const { name, text } of corpus)
    for (let k = 0; k < 60; k++) {
      const cut = random(text.length + 1),
        prefix = text.slice(0, cut),
        tree = SyntaxTree.parseText(prefix);
      if (tree.toFullString() !== prefix) assert.fail(`${name} cut at ${cut}: round-trip failed`);
    }
});
