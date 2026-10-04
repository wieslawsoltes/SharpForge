using System.Collections.Generic;

class C
{
    string Statement(string format, object arg, int a, int b)
    {
        switch (format, arg)
        {
            case ("id", int number): return "id" + number;
            case ({ } f, string text) when f.Length > 0:
                return text;
            case (_, null): break;
        }
        switch (a, b, a + b) { case (1, 2, 3): return "sum"; default: break; }
        switch (first: a, second: b) { case (0, 0): return "origin"; }
        switch ((a, b)) { case (1, _): return "one"; }
        switch (a) { case 1: return "single"; }
        return null;
    }

    int Guards(object value, Dictionary<string, int> map, System.Func<int, int, int> f)
    {
        var result = value switch
        {
            string name when map.TryGetValue(name, out int bound) => bound,
            string other when map.TryGetValue(other, out var found) => found,
            int n when f(n, n) > 0 => n,
            _ => 0,
        };
        System.Func<int, int, int> typed = int (int x, int y) => x + y;
        System.Func<int, int, int> untyped = (x, y) => x * y;
        var natural = object (ref int x, out int y) => y = x;
        return result + typed(1, 2) + untyped(3, 4);
    }
}
