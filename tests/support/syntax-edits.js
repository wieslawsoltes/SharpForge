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
