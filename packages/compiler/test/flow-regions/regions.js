// The region corpus of the flow analysis (SF-A02-T35): programs with one marked region each - the statements between
// the two marker comments (an opening and a closing angle bracket in a block comment) - as an "extract method"
// refactoring would select it. Roslyn's answers for every region are pinned in pinned.json (tools/pin.mjs);
// tests/compiler-flow-regions.test.js compares the semantic model with them.
//
// Every program is a body of `static int M(int a, int b, int[] items)` in a class with a few helpers, so that the
// regions differ only in what they are about.

/** The comments that open and close the region of a program. */
export const markers = Object.freeze({ open: '/*<*/', close: '/*>*/' });

/** Wraps the statements of a method body into a complete program. */
function program(body) {
  const lines = body.replace(/^\n/, '').replace(/\s+$/, '').split('\n'),
    indent = Math.min(...lines.filter(line => line.trim()).map(line => line.match(/^ */)[0].length)),
    text = lines.map(line => '        ' + line.slice(indent)).join('\n');
  return `using System;
static class P
{
    static int Read(int value) => value;
    static void Fill(out int value) { value = 1; }
    static void Touch(ref int value) { value++; }
    static bool Try(int input, out int value) { value = input; return input > 0; }
    static int M(int a, int b, int[] items)
    {
${text}
    }
    static void Main() { }
}
`;
}

const region = (id, body) => ({ id, source: program(body) });

export const regions = [
  region('straight-line-reads-and-writes', `
    int x = a + 1;
    /*<*/
    int y = x * 2;
    x = y + b;
    /*>*/
    return x + y;
  `),
  region('declared-inside-and-used-after', `
    /*<*/
    int total = a + b;
    int unused = total;
    /*>*/
    return total;
  `),
  region('declared-inside-and-not-used-after', `
    int result = a;
    /*<*/
    int temp = result * 2;
    result = temp + 1;
    /*>*/
    return result;
  `),
  region('overwritten-before-the-next-read', `
    int x = a;
    /*<*/
    x = b;
    /*>*/
    x = 5;
    return x;
  `),
  region('assigned-on-one-branch-only', `
    int x = 0;
    /*<*/
    if (a > 0) x = b;
    /*>*/
    return x;
  `),
  region('assigned-on-both-branches', `
    int x;
    /*<*/
    if (a > 0) x = b; else x = a;
    /*>*/
    return x;
  `),
  region('read-before-written-inside', `
    int x = a;
    /*<*/
    int y = x;
    x = y + 1;
    int z = x;
    /*>*/
    return z;
  `),
  region('written-before-read-inside', `
    int x = a;
    /*<*/
    x = b;
    int y = x;
    /*>*/
    return y;
  `),
  region('whole-loop', `
    int sum = 0;
    /*<*/
    for (int i = 0; i < items.Length; i++)
    {
        sum += items[i];
    }
    /*>*/
    return sum;
  `),
  region('loop-body-with-back-edge', `
    int last = 0, count = 0;
    while (count < a)
    {
        int seen = last;
        /*<*/
        last = seen + count;
        count++;
        /*>*/
    }
    return last;
  `),
  region('loop-body-overwritten-each-iteration', `
    int count = 0, scratch = 0;
    while (count < a)
    {
        scratch = count;
        count += Read(scratch);
        /*<*/
        scratch = b;
        /*>*/
    }
    return count;
  `),
  region('nested-loops', `
    int total = 0;
    for (int i = 0; i < a; i++)
    {
        /*<*/
        for (int j = 0; j < b; j++)
        {
            total += i * j;
        }
        /*>*/
    }
    return total;
  `),
  region('foreach-over-a-parameter', `
    int max = 0;
    /*<*/
    foreach (int item in items)
    {
        if (item > max) max = item;
    }
    /*>*/
    return max;
  `),
  region('do-while', `
    int n = a, steps = 0;
    /*<*/
    do
    {
        n = n / 2;
        steps++;
    } while (n > 0);
    /*>*/
    return steps;
  `),
  region('out-argument', `
    int value;
    /*<*/
    Fill(out value);
    int copy = value;
    /*>*/
    return copy + value;
  `),
  region('ref-argument', `
    int value = a;
    /*<*/
    Touch(ref value);
    /*>*/
    return value;
  `),
  region('out-variable-declaration', `
    /*<*/
    bool ok = Try(a, out int parsed);
    /*>*/
    return ok ? parsed : b;
  `),
  region('compound-assignment-and-increment', `
    int x = a, y = b;
    /*<*/
    x += y;
    y++;
    /*>*/
    return x;
  `),
  region('return-inside', `
    int x = a;
    /*<*/
    if (x > b) return x;
    x = b;
    /*>*/
    return x + 1;
  `),
  region('break-out-of-the-region', `
    int found = -1;
    for (int i = 0; i < items.Length; i++)
    {
        /*<*/
        if (items[i] == a) { found = i; break; }
        /*>*/
    }
    return found;
  `),
  region('continue-out-of-the-region', `
    int sum = 0;
    for (int i = 0; i < items.Length; i++)
    {
        /*<*/
        if (items[i] < 0) continue;
        sum += items[i];
        /*>*/
    }
    return sum;
  `),
  region('break-of-a-loop-inside', `
    int i = 0;
    /*<*/
    while (true)
    {
        if (i >= a) break;
        i++;
    }
    /*>*/
    return i;
  `),
  region('throw-inside', `
    int x = a;
    /*<*/
    if (x < 0) throw new ArgumentException("a");
    x = x + b;
    /*>*/
    return x;
  `),
  region('try-catch-finally', `
    int x = 0, y = 0;
    /*<*/
    try { x = Read(a); }
    catch (Exception) { y = b; }
    finally { y++; }
    /*>*/
    return x + y;
  `),
  region('switch-statement', `
    int kind = 0;
    /*<*/
    switch (a)
    {
        case 0: kind = b; break;
        case 1: kind = 1; break;
        default: break;
    }
    /*>*/
    return kind;
  `),
  region('conditional-expression', `
    int x = a;
    /*<*/
    int y = x > 0 ? b : Read(x);
    /*>*/
    return y;
  `),
  region('pattern-variable', `
    object boxed = a;
    /*<*/
    int n = boxed is int number ? number : b;
    /*>*/
    return n;
  `),
  region('tuple-deconstruction', `
    int x = a, y = b;
    /*<*/
    (x, y) = (y, x);
    /*>*/
    return x - y;
  `),
  region('null-coalescing-assignment', `
    string text = null;
    /*<*/
    text ??= a.ToString();
    /*>*/
    return text.Length;
  `),
  region('lambda-captures-inside', `
    int x = a, y = b;
    /*<*/
    Func<int> f = () => x + 1;
    y = f();
    /*>*/
    return y;
  `),
  region('lambda-outside-captures', `
    int x = a, y = b;
    Func<int> f = () => x + y;
    /*<*/
    x = 5;
    int z = y;
    /*>*/
    return f() + z;
  `),
  region('lambda-writes-a-captured-variable', `
    int counter = 0;
    /*<*/
    Action bump = () => counter++;
    bump();
    /*>*/
    return counter;
  `),
  region('local-function-captures', `
    int x = a;
    int Add(int n) => x + n;
    /*<*/
    int y = Add(b);
    x = y;
    /*>*/
    return Add(x);
  `),
  region('parameter-written-inside', `
    /*<*/
    a = b * 2;
    b = 0;
    /*>*/
    return a;
  `),
  region('unreachable-region', `
    int x = a;
    return x;
    /*<*/
    x = b;
    /*>*/
  `),
  region('end-point-not-reachable', `
    int x = a;
    /*<*/
    if (x > 0) return x;
    else return b;
    /*>*/
  `),
];
