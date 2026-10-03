import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SourceText, BoundedCache } from '@sharpforge/text';
import { SyntaxTree, lex, parse, matchesGrammar } from '@sharpforge/syntax';
import { fixtureRoot, filesUnder } from './support/syntax-reference.js';

// SF-A01-T12.1: mutation fuzzer. Seeded token swaps, deletions and duplications are applied to every corpus file; each
// mutant must parse without an exception, in bounded time, and round-trip byte for byte.
const corpus = ['reference', 'lexer-corpus', 'expression-corpus', 'matrix'].flatMap(directory => filesUnder(join(fixtureRoot, directory), name => name === 'positive.cs' || name.endsWith('.cs') && name !== 'rejected.cs')).map(file => ({ name: file.slice(fixtureRoot.length + 1), text: readFileSync(file, 'utf8') }));
test('mutate: seeded token swaps, deletions and duplications parse, round-trip and stay within the time budget', () => {
  let seed = 31337, mutants = 0, slowest = 0; const random = n => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; }, cache = new BoundedCache(65536);
  for (const { name, text } of corpus) {
    const pieces = lex(new SourceText(text)).tokens.map(token => token.green.fullText); assert.equal(pieces.join(''), text, name); const count = pieces.length;
    for (let k = 0, rounds = Math.min(80, 20 + count); k < rounds; k++) {
      const mutated = [...pieces], operations = 1 + random(3), log = [];
      for (let o = 0; o < operations; o++) {
        const kind = random(4), a = random(mutated.length), b = random(mutated.length);
        if (kind === 0) { [mutated[a], mutated[b]] = [mutated[b], mutated[a]]; log.push(`swap ${a} ${b}`); }
        else if (kind === 1) { mutated.splice(a, 1 + random(3)); log.push(`delete ${a}`); }
        else if (kind === 2) { mutated.splice(a, 0, mutated[b] ?? ''); log.push(`duplicate ${b} at ${a}`); }
        else { const from = Math.min(a, b), to = Math.max(a, b); mutated.splice(from, to - from, ...mutated.slice(from, to).reverse()); log.push(`reverse ${from}..${to}`); }
      }
      const source = mutated.join(''), label = `${name} seed step ${k} [${log.join('; ')}]`, start = performance.now(); let tree;
      try { tree = SyntaxTree.parseText(source, { cache }); } catch (error) { assert.fail(`${label}: ${error.stack}`); }
      const elapsed = performance.now() - start; slowest = Math.max(slowest, elapsed); assert(elapsed < 5000, `${label} took ${elapsed} ms`);
      if (tree.toFullString() !== source) assert.fail(`${label}: round-trip failed`);
      if (mutants % 25 === 0) { assert(matchesGrammar(tree.green), label); try { assert.equal(parse(source).green.fullText, source); } catch (error) { assert.fail(`${label} (legacy adapter): ${error.stack}`); } }
      mutants++;
    }
  }
  assert(mutants > 7000, `${mutants} mutants`); assert(slowest < 5000);
});
