// SF-A02-T10.1 (properties), SF-A02-T10.3 (const and readonly fields), constructors and call-site arguments:
// pinned against Roslyn and .NET, plus the rules the pinned programs do not reach.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { testPinnedFeature } from './support/pinned-feature.js';

testPinnedFeature('SF-A02-T10.1', 'member-properties', { outputs: 2, diagnostics: 2 });
testPinnedFeature('SF-A02-T10.3', 'member-fields', { outputs: 1, diagnostics: 2 });
testPinnedFeature('SF-A02-T03.4', 'member-constructors', { outputs: 2, diagnostics: 1 });
testPinnedFeature('SF-A02-T06.3', 'member-arguments', { outputs: 1, diagnostics: 2 });

const errorsOf = source =>
  analyze([parse(new SourceText(source, 'a.cs'))])
    .diagnostics.filter(d => d.severity === 'error')
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`)
    .sort();

test('SF-A02-T06.3 parameter list rules apply to constructors and indexers too', () => {
  const source = `
    class C {
      public C(int a = 1, int b) { }
      public int this[params int[] rest, int last] { get { return 0; } }
    }
    class P { static void Main() { } }`;
  assert.deepEqual(errorsOf(source), ['CS0231:params int[] rest', 'CS1737:)']);
});

test('SF-A02-T06.3 a default of the wrong type is CS1750; other errors in a default are reported as they are', () => {
  const source = `
    class C {
      static void A(string s = 5) { }
      static void B(int x = missing) { }
    }
    class P { static void Main() { } }`;
  assert.deepEqual(errorsOf(source), ['CS0103:missing', 'CS1750:s']);
});

test('SF-A02-T03.4 a constructor cycle is reported once, a self call on the constructor itself', () => {
  const source = `
    class C {
      public C(int a) : this("s") { }
      public C(string s) : this(1.5) { }
      public C(double d) : this(1) { }
      public C(bool b) : this(b) { }
    }
    class P { static void Main() { } }`;
  assert.deepEqual(errorsOf(source), ['CS0516:this', 'CS0768:: this(1)']);
});

test('SF-A02-T10.3 a constant without a value is CS0145 also when nothing reads it', () => {
  const source = `class C { const int A; public const string B; } class P { static void Main() { } }`;
  assert.deepEqual(errorsOf(source), ['CS0145:A', 'CS0145:B']);
});
