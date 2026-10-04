static partial class Oracle
{
    public static void Main()
    {
        Begin("collections");
        Case("collections-list-empty-count", () => new List<int>().Count);
        Case("collections-list-add", () => { var values = new List<int>(); values.Add(1); values.Add(2); return string.Join(",", values); });
        Case("collections-list-insert", () => { var values = new List<int> { 1, 3 }; values.Insert(1, 2); return string.Join(",", values); });
        Case("collections-list-remove-first", () => { var values = new List<int> { 1, 2, 1 }; values.Remove(1); return string.Join(",", values); });
        Case("collections-list-remove-missing", () => new List<int> { 1, 2 }.Remove(3));
        Case("collections-list-remove-all", () => { var values = new List<int> { 1, 2, 3, 4 }; int count = values.RemoveAll(x => x % 2 == 0); return count + "|" + string.Join(",", values); });
        Case("collections-list-clear", () => { var values = new List<int> { 1, 2 }; values.Clear(); return values.Count; });
        Case("collections-list-first-index", () => new List<int> { 1, 2, 1 }.IndexOf(1));
        Case("collections-list-last-index", () => new List<int> { 1, 2, 1 }.LastIndexOf(1));
        Case("collections-list-sort", () => { var values = new List<int> { 3, -1, 2, 2 }; values.Sort(); return string.Join(",", values); });
        Case("collections-list-reverse", () => { var values = new List<int> { 1, 2, 3 }; values.Reverse(); return string.Join(",", values); });
        Case("collections-list-index-outside", () => new List<int> { 1 }[1]);
        Case("collections-list-insert-negative", () => { new List<int>().Insert(-1, 2); return "unreachable"; });
        Case("collections-list-copy-offset", () => { var destination = new int[4]; new List<int> { 7, 8 }.CopyTo(destination, 1); return string.Join(",", destination); });
        Case("collections-dictionary-lookup", () => new Dictionary<string, int> { ["one"] = 1 }["one"]);
        Case("collections-dictionary-missing", () => new Dictionary<string, int>()["missing"]);
        Case("collections-dictionary-duplicate-add", () => { var values = new Dictionary<string, int> { ["one"] = 1 }; values.Add("one", 2); return "unreachable"; });
        Case("collections-dictionary-null-key", () => { var values = new Dictionary<string, int>(); values.Add(null, 1); return "unreachable"; });
        Case("collections-dictionary-try-get-missing", () => new Dictionary<string, int>().TryGetValue("missing", out int value) + "|" + value);
        Case("collections-dictionary-remove", () => { var values = new Dictionary<string, int> { ["one"] = 1 }; bool removed = values.Remove("one"); return removed + "|" + values.Count; });
        Case("collections-dictionary-ignore-case", () => new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) { ["Key"] = 42 }["KEY"]);
        Case("collections-dictionary-ordered-observation", () => string.Join(",", new Dictionary<string, int> { ["b"] = 2, ["a"] = 1 }.OrderBy(x => x.Key, StringComparer.Ordinal).Select(x => x.Key + "=" + x.Value)));
        Case("collections-set-deduplicates", () => new HashSet<int> { 1, 2, 1 }.Count);
        Case("collections-set-duplicate-add", () => new HashSet<int> { 1 }.Add(1));
        Case("collections-set-union", () => { var values = new HashSet<int> { 1, 2 }; values.UnionWith(new[] { 2, 3 }); return string.Join(",", values.OrderBy(x => x)); });
        Case("collections-set-intersection", () => { var values = new HashSet<int> { 1, 2 }; values.IntersectWith(new[] { 2, 3 }); return string.Join(",", values.OrderBy(x => x)); });
        Case("collections-set-except", () => { var values = new HashSet<int> { 1, 2, 3 }; values.ExceptWith(new[] { 2 }); return string.Join(",", values.OrderBy(x => x)); });
        Case("collections-set-symmetric-except", () => { var values = new HashSet<int> { 1, 2 }; values.SymmetricExceptWith(new[] { 2, 3 }); return string.Join(",", values.OrderBy(x => x)); });
        Case("collections-set-equality", () => new HashSet<int> { 1, 2 }.SetEquals(new[] { 2, 1, 1 }));
        Case("collections-set-empty-subset", () => new HashSet<int>().IsSubsetOf(new[] { 1 }));
        Case("collections-queue-peek", () => new Queue<int>(new[] { 1, 2 }).Peek());
        Case("collections-queue-dequeue-order", () => { var values = new Queue<int>(new[] { 1, 2 }); values.Enqueue(3); return values.Dequeue() + "|" + string.Join(",", values); });
        Case("collections-queue-empty-dequeue", () => new Queue<int>().Dequeue());
        Case("collections-queue-copy-offset", () => { var destination = new int[4]; new Queue<int>(new[] { 7, 8 }).CopyTo(destination, 1); return string.Join(",", destination); });
        Case("collections-stack-peek", () => new Stack<int>(new[] { 1, 2 }).Peek());
        Case("collections-stack-pop-order", () => { var values = new Stack<int>(new[] { 1, 2 }); values.Push(3); return values.Pop() + "|" + string.Join(",", values); });
        Case("collections-stack-empty-pop", () => new Stack<int>().Pop());
        Case("collections-array-binary-search", () => Array.BinarySearch(new[] { 1, 3, 5, 7 }, 5));
        Case("collections-array-search-insertion", () => Array.BinarySearch(new[] { 1, 3, 5, 7 }, 4));
        Case("collections-array-copy-overlap", () => { var values = new[] { 1, 2, 3, 4 }; Array.Copy(values, 0, values, 1, 3); return string.Join(",", values); });
    }
}
