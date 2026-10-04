using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;

int fibCalls = 0;
Func<int, BigInteger> fib = null;
fib = Fn.Memoize<int, BigInteger>(n => { fibCalls++; return n < 2 ? n : fib(n - 1) + fib(n - 2); });
Console.WriteLine("fib(90)=" + fib(90) + " calls=" + fibCalls + ", fib(91)=" + fib(91) + " calls=" + fibCalls);

Func<int, long> factorial = Fn.Y<int, long>(self => n => n <= 1 ? 1 : n * self(n - 1));
Func<long, int> collatz = Fn.MemoY<long, int>(self => n => n == 1 ? 1 : 1 + self(n % 2 == 0 ? n / 2 : 3 * n + 1));
Console.WriteLine("Y factorial: " + factorial(5) + " " + factorial(20) + " | memoized collatz lengths: " + string.Join(",", new long[] { 6, 7, 27, 97 }.Select(collatz)));

Func<int, int, int, int> volume = (a, b, c) => a * b * c + a;
var curried = Fn.Curry(volume);
Func<int, Func<int, int>> withWidth2 = curried(2);
Func<int, int, int> partial = Fn.Partial(volume, 10);
Console.WriteLine("curry: " + curried(2)(3)(4) + " " + withWidth2(5)(6) + " partial: " + partial(2, 3) + " uncurried: " + Fn.Uncurry(curried)(1, 2, 3));
Console.WriteLine("flip: " + Fn.Flip<int, int, int>((a, b) => a - b)(1, 10) + " compose: " + Fn.Compose<int, int, string>(n => n * n, n => "<" + n + ">")(7));

Console.WriteLine("even/odd: " + IsEven(10) + " " + IsOdd(7) + " " + IsEven(7) + " | odd squares: " + string.Join(",", Enumerable.Range(1, 9).Where(IsOdd).Select(Square)));
Console.WriteLine("hofstadter F: " + string.Join(" ", Enumerable.Range(0, 12).Select(Female)) + " | M: " + string.Join(" ", Enumerable.Range(0, 12).Select(Male)));
Console.WriteLine("edit distance: " + Distance("kitten", "sitting") + " " + Distance("flaw", "lawn") + " " + Distance("", "abc") + " " + Distance("intention", "execution"));

int[] data = { 4, 9, 2, 7 };
int left = 1, right = 2;
Swap(ref left, ref right);
Swap(ref data[0], ref data[3]);
ref int largest = ref Largest(data);
largest = -1;
bool ok = TryDivide(17, 5, out int quotient, out int remainder), bad = TryDivide(1, 0, out _, out int untouched);
Console.WriteLine("ref/out: " + left + "," + right + " [" + string.Join(",", data) + "] " + ok + ":" + quotient + "r" + remainder + " " + bad + ":" + untouched);
Console.WriteLine("defaults: " + Pad("ab") + " " + Pad("ab", 4) + " " + Pad("ab", fill: '*') + " " + Pad("toolong", 3) + " | generic: " + Fold(new[] { "x", "y", "z" }, "", (acc, s) => s + acc) + " " + Fold(data, 0, Math.Max) + " | gcd: " + Gcd(1071, 462));

int offset = 100;
int Shifted(int value) => value + offset;
Func<int, int> shiftedDelegate = Shifted;
offset = 1000;
Func<int[], int> span = values =>
{
    int Span(int low, int high) => high - low + offset;
    return Span(values.Min(), values.Max());
};
Console.WriteLine("captured after change: " + Shifted(1) + " " + shiftedDelegate(2) + " | local function in lambda: " + span(new[] { 5, 1, 8 }));

var (slowSquare, stats) = Fn.MemoizeWithStats<int, int>(Square);
int squares = new[] { 3, 4, 3, 3, 5, 4 }.Sum(slowSquare);
Console.WriteLine("memo stats: sum=" + squares + " " + stats());
var evicted = new List<string>();
int loads = 0;
Func<string, int> lengthOf = Fn.MemoizeLru<string, int>(text => { loads++; return text.Length; }, capacity: 2, evicted.Add);
int lengths = new[] { "a", "bb", "a", "ccc", "bb", "a", "a" }.Sum(lengthOf);
Console.WriteLine("lru: sum=" + lengths + " loads=" + loads + " evicted=" + string.Join(",", evicted));

var meter = new Meter(new[] { 3.0, 4.0, 5.0, 12.0 });
Console.WriteLine("this-capturing local functions: " + meter.Report(2) + " | " + meter.Report(10) + " | calls=" + meter.Calls);

Func<(int Row, int Column), BigInteger> grid = Fn.MemoY<(int Row, int Column), BigInteger>(self => cell => cell.Row == 0 || cell.Column == 0 ? 1 : self((cell.Row - 1, cell.Column)) + self((cell.Row, cell.Column - 1)));
Console.WriteLine("lattice paths: " + grid((2, 2)) + " " + grid((10, 10)) + " " + grid((20, 20)));

static bool IsEven(int n) => n == 0 || IsOdd(n - 1);
static bool IsOdd(int n) => n != 0 && IsEven(n - 1);
static int Square(int n) => n * n;
static long Gcd(long a, long b) => b == 0 ? a : Gcd(b, a % b);
static void Swap<T>(ref T a, ref T b) => (a, b) = (b, a);
static T Fold<T>(IEnumerable<T> items, T seed, Func<T, T, T> combine) { foreach (T item in items) seed = combine(seed, item); return seed; }
static string Pad(string text, int width = 6, char fill = '.') => text.Length >= width ? text.Substring(0, width) : text + new string(fill, width - text.Length);

static ref int Largest(int[] values)
{
    int best = 0;
    for (int i = 1; i < values.Length; i++) if (values[i] > values[best]) best = i;
    return ref values[best];
}

static bool TryDivide(int dividend, int divisor, out int quotient, out int remainder)
{
    quotient = remainder = 0;
    if (divisor == 0) return false;
    quotient = Math.DivRem(dividend, divisor, out remainder);
    return true;
}

int Female(int n) => n == 0 ? 1 : n - Male(Female(n - 1));
int Male(int n) => n == 0 ? 0 : n - Female(Male(n - 1));

static int Distance(string a, string b)
{
    var memo = new Dictionary<(int, int), int>();
    return Go(a.Length, b.Length);

    int Go(int i, int j)
    {
        if (i == 0 || j == 0) return i + j;
        if (memo.TryGetValue((i, j), out int known)) return known;
        int cost = a[i - 1] == b[j - 1] ? 0 : 1;
        return memo[(i, j)] = Min3(Go(i - 1, j) + 1, Go(i, j - 1) + 1, Go(i - 1, j - 1) + cost);

        static int Min3(int x, int y, int z) => Math.Min(x, Math.Min(y, z));
    }
}

sealed class Meter
{
    private readonly double[] samples;
    public int Calls { get; private set; }
    public Meter(double[] samples) { this.samples = samples; }

    public string Report(int top)
    {
        int considered = 0;
        return Format(Mean()) + "/" + Format(Deviation()) + " n=" + considered;

        double Mean() { Calls++; var used = samples.Take(top).ToArray(); considered = used.Length; return used.Average(); }
        double Deviation() { double mean = Mean(); return Math.Sqrt(samples.Take(top).Sum(sample => Squared(sample - mean)) / considered); }
        static double Squared(double value) => value * value;
        static string Format(double value) => value.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture);
    }
}

static class Fn
{
    private delegate Func<T, TResult> Rec<T, TResult>(Rec<T, TResult> self);

    public static Func<T, TResult> Y<T, TResult>(Func<Func<T, TResult>, Func<T, TResult>> f)
    {
        Rec<T, TResult> rec = self => x => f(self(self))(x);
        return rec(rec);
    }

    public static Func<T, TResult> Memoize<T, TResult>(Func<T, TResult> f)
    {
        var cache = new Dictionary<T, TResult>();
        return x => cache.TryGetValue(x, out TResult hit) ? hit : cache[x] = f(x);
    }

    public static Func<T, TResult> MemoY<T, TResult>(Func<Func<T, TResult>, Func<T, TResult>> f)
    {
        Func<T, TResult> self = null;
        return self = Memoize<T, TResult>(x => f(self)(x));
    }

    public static (Func<T, TResult> Call, Func<string> Stats) MemoizeWithStats<T, TResult>(Func<T, TResult> f)
    {
        int hits = 0, misses = 0;
        Func<T, TResult> cached = Memoize<T, TResult>(x => { misses++; hits--; return f(x); });
        return (x => { hits++; return cached(x); }, () => "hits=" + hits + " misses=" + misses);
    }

    public static Func<T, TResult> MemoizeLru<T, TResult>(Func<T, TResult> f, int capacity, Action<T> onEvict)
    {
        var order = new LinkedList<(T Key, TResult Value)>();
        var index = new Dictionary<T, LinkedListNode<(T Key, TResult Value)>>();
        return key =>
        {
            if (index.TryGetValue(key, out var node)) order.Remove(node);
            else
            {
                node = new LinkedListNode<(T Key, TResult Value)>((key, f(key)));
                index[key] = node;
                if (index.Count > capacity) { T oldest = order.Last.Value.Key; order.RemoveLast(); index.Remove(oldest); onEvict(oldest); }
            }
            order.AddFirst(node);
            return node.Value.Value;
        };
    }

    public static Func<T1, Func<T2, Func<T3, TResult>>> Curry<T1, T2, T3, TResult>(Func<T1, T2, T3, TResult> f) => a => b => c => f(a, b, c);
    public static Func<T1, T2, T3, TResult> Uncurry<T1, T2, T3, TResult>(Func<T1, Func<T2, Func<T3, TResult>>> f) => (a, b, c) => f(a)(b)(c);
    public static Func<T2, T3, TResult> Partial<T1, T2, T3, TResult>(Func<T1, T2, T3, TResult> f, T1 first) => (b, c) => f(first, b, c);
    public static Func<T2, T1, TResult> Flip<T1, T2, TResult>(Func<T1, T2, TResult> f) => (b, a) => f(a, b);
    public static Func<T, TResult> Compose<T, TMiddle, TResult>(Func<T, TMiddle> first, Func<TMiddle, TResult> second) => x => second(first(x));
}
