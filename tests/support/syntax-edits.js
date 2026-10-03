import assert from 'node:assert/strict';
/** Seeded random text edits shared by the incremental lexing and parsing suites. */
export const editSeedDocument = `#define TRACE
using System;
using System.Collections.Generic;

namespace Sample.App
{
    /// <summary>A sample type.</summary>
    public partial class Widget<T> : Base, IDisposable where T : class, new()
    {
        private readonly List<T> items = new List<T>();
        const double Pi = 3.14159, Tau = 2 * Pi;
        public int Count { get; private set; }
        public string Name => $"widget {Count:D2} of {items.Count}";
#if TRACE
        static string Raw = """
            raw "text" here
            """;
#else
        static string Raw = @"verbatim ""text""";
#endif
        public event EventHandler Changed;

        public Widget(int count) : base(count) { Count = count; }

        public async Task<int> RunAsync(int limit)
        {
            var total = 0; /* block comment */
            for (int i = 0, j = limit; i < j; i++, j--)
            {
                if (i % 2 == 0 && j is > 3 and not 7) total += i * j; // trailing
                else if (items is [var first, .., var last]) total -= 1.5e3 > 0x1F ? 1 : 0;
            }
            await Task.Delay(1);
            switch (total) { case 1: case 2: return 1; default: break; }
            try { Changed?.Invoke(this, EventArgs.Empty); } catch (Exception e) when (e != null) { throw; } finally { total >>= 1; }
            Func<int, int> twice = x => x * 2;
            var q = from x in items where x != null orderby x select x;
            return twice(total) + (q.Any() ? 'a' : '\\n');
        }

        #region Members
        public T this[int index] { get { return items[index]; } set { items[index] = value; } }
        public static Widget<T> operator +(Widget<T> a, Widget<T> b) => a ?? b;
        void IDisposable.Dispose() { lock (items) { items.Clear(); } }
        #endregion
    }

    enum Color { Red = 1, Green, Blue = Red << 2 }
    struct Point { public int X, Y; }
    interface IShape { double Area(); }
}
`;
/** A compact document for long fuzz runs. */
export const editSmallDocument = `using System;
namespace N
{
    class C<T> : B where T : class
    {
        int a = 1, b;
        public string Name => $"n {a:D2}";
#if X
        const int K = 2;
#endif
        async Task<int> M(int p)
        {
            for (int i = 0; i < p; i++) { if (i > 2 && p is > 3 and not 7) a += i; else b--; }
            await Task.Delay(1); /* c */
            Func<int, int> f = x => x * 2; // t
            return f(a) + (b > 0 ? 'a' : 1.5e3);
        }
        public int P { get; set; }
    }
    enum E { A = 1, B }
}
`;
const snippets = [' ', '\n', ';', '{', '}', '(', ')', '[', ']', '<', '>', '=', '+', '-', '*', '/', '.', ',', ':', '?', '!', '"', "'", '$"', '@"', '"""', '//', '/*', '*/', '///', '#if X\n', '#else\n', '#endif\n', '#define Q\n', '#region R\n', '#endregion\n',
  'x', 'int', 'var', 'class C { }', 'void M() { }', 'int y = 1;', 'return;', 'if (a) b();', 'else', 'async', 'await', 'static', 'public', 'new', '=>', '..', '>>', '0x', '1.5', 'e3', 'u8', '\\u0041', '{x}', '\r\n', '\t', 'namespace N', 'using', 'catch', 'case 1:', 'where T : struct', '@', '#'];
/** A deterministic generator: `next(text)` returns { start, length, text } for the next edit of `text`. */
export function editGenerator(seed) {
  let state = seed >>> 0;
  const random = n => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return (state >>> 8) % n; };
  return { random, next(text) {
    const kind = random(10), start = random(text.length + 1);
    if (kind < 4) return { start, length: 0, text: snippets[random(snippets.length)] };
    if (kind < 7) return { start, length: Math.min(text.length - start, 1 + random(kind === 6 ? 40 : 4)), text: '' };
    if (kind < 9) return { start, length: Math.min(text.length - start, random(6)), text: snippets[random(snippets.length)] + (random(3) ? '' : snippets[random(snippets.length)]) };
    const from = random(text.length), copy = text.slice(from, from + random(60)); return { start, length: 0, text: copy };
  } };
}
export const applyEdit = (text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.start + edit.length);
const triviaEquals = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && (a[i].kind !== b[i].kind || a[i].text !== b[i].text)) return false; return true; };
/** Structural green comparison: kinds, child shape, token text, value flags and trivia. Returns a description of the first difference or null. */
export function greenDifference(a, b) {
  const stack = [[a, b]];
  while (stack.length) {
    const [x, y] = stack.pop(); if (x === y) continue;
    if (!x || !y) return `child presence differs (${x?.kind} vs ${y?.kind})`;
    if (x.kind !== y.kind) return `kind ${x.kind} != ${y.kind}`;
    if (x.fullWidth !== y.fullWidth || x.flags !== y.flags) return `${x.kind}: width or flags differ (${x.fullWidth}/${x.flags} vs ${y.fullWidth}/${y.flags})`;
    if (x.isNode) { if (x.children.length !== y.children.length) return `${x.kind}: child count ${x.children.length} != ${y.children.length}`; for (let i = 0; i < x.children.length; i++) stack.push([x.children[i], y.children[i]]); }
    else if (x.text !== y.text || !triviaEquals(x.leading, y.leading) || !triviaEquals(x.trailing, y.trailing)) return `token ${x.kind} ${JSON.stringify(x.text)} != ${JSON.stringify(y.text)} or its trivia`;
  }
  return null;
}
const diagnosticKey = d => `${d.code}@${d.start}+${d.length} ${d.severity} ${d.message} v${d.version} ${d.range.start.line}:${d.range.start.character}`;
const featureKey = f => `${f.id}@${f.start}-${f.end}`, directiveKey = d => `${d.kind}@${d.start}-${d.end}`;
export function assertSameTree(incremental, full, label) {
  assert.equal(incremental.toFullString(), full.source.text, label + ': text');
  const difference = greenDifference(incremental.green, full.green); if (difference) assert.fail(`${label}: ${difference}`);
  assert.deepEqual(incremental.getDiagnostics().map(diagnosticKey).sort(), full.getDiagnostics().map(diagnosticKey).sort(), label + ': diagnostics');
  assert.deepEqual(incremental.features.map(featureKey).sort(), full.features.map(featureKey).sort(), label + ': features');
  assert.deepEqual(incremental.directives.map(directiveKey), full.directives.map(directiveKey), label + ': directives');
}
