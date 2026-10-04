using System;
using System.Collections;
using System.Collections.Generic;

class Explicit : IEnumerable<int>
{
    IEnumerator<int> IEnumerable<int>.GetEnumerator() { yield return 1; yield return 2; }
    IEnumerator IEnumerable.GetEnumerator() { yield return 9; }
}

struct Counted : IEnumerable<string>
{
    IEnumerator<string> IEnumerable<string>.GetEnumerator() { yield return "s"; }
    IEnumerator IEnumerable.GetEnumerator() { yield return "o"; }
}

class Disposing : IEnumerable
{
    class Cursor : IEnumerator, IDisposable
    {
        int position;
        public object Current => position;
        public bool MoveNext() => ++position < 3;
        public void Reset() { }
        public void Dispose() { Console.WriteLine("disposed"); }
    }

    public IEnumerator GetEnumerator() => new Cursor();
}

class Program
{
    static IEnumerable<int> Numbers() { yield return 3; yield return 4; }

    static void Main()
    {
        foreach (var x in new Explicit()) Console.WriteLine(x);
        foreach (var x in new Counted()) Console.WriteLine(x);
        foreach (var x in Numbers()) Console.WriteLine(x);
        IEnumerable plain = new Explicit();
        foreach (var x in plain) Console.WriteLine(x);
        foreach (int x in new Disposing()) Console.WriteLine(x);
        IList<string> names = new List<string> { "a", "b" };
        foreach (var name in names) Console.WriteLine(name);
        IReadOnlyDictionary<string, int> map = new Dictionary<string, int> { ["k"] = 1 };
        foreach (var pair in map) Console.WriteLine(pair.Key + "=" + pair.Value);
        foreach (var c in new Stack<char>(new[] { 'x', 'y' })) Console.WriteLine(c);
        foreach (var e in new ArrayList { 1, "two" }) Console.WriteLine(e);
        ICollection<int> set = new HashSet<int> { 7 };
        foreach (var s in set) Console.WriteLine(s);
        foreach (var (key, value) in new Dictionary<int, string> { [1] = "one" }) Console.WriteLine(key + value);
    }
}
