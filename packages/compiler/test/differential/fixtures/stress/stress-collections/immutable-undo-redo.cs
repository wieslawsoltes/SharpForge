using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Linq;

namespace Editing
{
    public sealed record Document(ImmutableList<string> Lines, ImmutableDictionary<string, string> Meta, ImmutableArray<int> Bookmarks)
    {
        public static readonly Document Blank = new Document(ImmutableList<string>.Empty, ImmutableDictionary.Create<string, string>(StringComparer.OrdinalIgnoreCase), ImmutableArray<int>.Empty);

        public string Describe() =>
            $"[{string.Join("|", Lines)}] meta{{{string.Join(",", Meta.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => p.Key + "=" + p.Value))}}} marks({string.Join(",", Bookmarks)})";
    }

    // Every edit produces a new snapshot; undo and redo are just two persistent stacks of snapshots.
    public sealed class Editor
    {
        private ImmutableStack<Document> undo = ImmutableStack<Document>.Empty;
        private ImmutableStack<Document> redo = ImmutableStack<Document>.Empty;
        public Document Current { get; private set; } = Document.Blank;
        public int UndoDepth => undo.Count();

        public Editor Apply(Func<Document, Document> edit)
        {
            Document next = edit(Current);
            if (ReferenceEquals(next, Current)) return this;
            undo = undo.Push(Current);
            redo = redo.Clear();
            Current = next;
            return this;
        }

        public bool Undo()
        {
            if (undo.IsEmpty) return false;
            redo = redo.Push(Current);
            undo = undo.Pop(out Document previous);
            Current = previous;
            return true;
        }

        public bool Redo()
        {
            if (redo.IsEmpty) return false;
            undo = undo.Push(Current);
            Current = redo.Peek();
            redo = redo.Pop();
            return true;
        }
    }

    public static class Program
    {
        public static void Main()
        {
            var editor = new Editor();
            editor.Apply(d => d with { Lines = d.Lines.Add("title").Add("body") })
                  .Apply(d => d with { Meta = d.Meta.Add("Author", "ada").SetItem("lang", "en") })
                  .Apply(d => d with { Lines = d.Lines.Insert(1, "subtitle"), Bookmarks = d.Bookmarks.Add(1) })
                  .Apply(d => d with { Lines = d.Lines.SetItem(2, "BODY").AddRange(new[] { "footer", "end" }), Bookmarks = d.Bookmarks.AddRange(4, 2) })
                  .Apply(d => d)
                  .Apply(d => d with { Meta = d.Meta.SetItem("AUTHOR", "grace").Remove("LANG"), Lines = d.Lines.RemoveAt(3).Remove("missing") });
            Console.WriteLine(editor.Current.Describe() + " depth=" + editor.UndoDepth);
            Document latest = editor.Current;
            while (editor.Undo()) Console.WriteLine("undo -> " + editor.Current.Describe());
            Console.WriteLine(editor.Undo() + " " + editor.Redo() + " " + editor.Redo() + " " + editor.Current.Describe());
            editor.Apply(d => d with { Lines = d.Lines.Add("branch") });
            Console.WriteLine("redo after a new edit: " + editor.Redo() + " " + editor.Current.Describe());
            Console.WriteLine("old snapshot intact: " + latest.Describe());

            Console.WriteLine("-- ImmutableArray and its builder");
            ImmutableArray<int> primes = ImmutableArray.Create(2, 3, 5, 7);
            ImmutableArray<int> more = primes.Add(11).Insert(0, 1).RemoveAt(2).SetItem(0, 0).Replace(7, 77);
            ImmutableArray<int>.Builder builder = ImmutableArray.CreateBuilder<int>(8);
            builder.AddRange(more);
            builder.Add(13);
            builder[1] *= 100;
            builder.Insert(2, -4 + 8);
            builder.RemoveAll(x => x == 0);
            builder.Sort();
            builder.Reverse();
            ImmutableArray<int> built = builder.ToImmutable();
            builder.Clear();
            Console.WriteLine(string.Join(",", primes) + " | " + string.Join(",", more) + " | " + string.Join(",", built) + " | builder " + builder.Count + " | " + default(ImmutableArray<int>).IsDefault + ImmutableArray<int>.Empty.IsEmpty + default(ImmutableArray<int>).IsDefaultOrEmpty);
            Console.WriteLine(built.IndexOf(13) + " " + built.Contains(77) + " " + built.Length + " " + built[^1] + " " + string.Join(",", built.Sort().RemoveRange(0, 2)) + " " + (primes == ImmutableArray.Create(2, 3, 5, 7)) + primes.SequenceEqual(ImmutableArray.Create(2, 3, 5, 7))
                + " " + string.Join(",", built.AsSpan().Slice(1, 2).ToArray()) + " " + string.Join(",", new[] { 9, 8 }.ToImmutableArray().AddRange(primes.Where(p => p > 4))) + " " + string.Join("", ImmutableArray.CreateRange("abc").Reverse()));
            ImmutableArray<string> names = ["zed", "amy", "Bob"];
            Console.WriteLine(string.Join(" ", names.Sort(StringComparer.OrdinalIgnoreCase)) + " | " + string.Join(" ", names.OrderBy(n => n.Length).ThenBy(n => n, StringComparer.Ordinal)) + " | " + names.Select(n => n.Length).ToImmutableArray().Sum() + " " + names.IndexOf("AMY", 0, names.Length, StringComparer.OrdinalIgnoreCase));

            Console.WriteLine("-- ImmutableList and ImmutableDictionary builders");
            ImmutableList<string>.Builder lines = ImmutableList.CreateBuilder<string>();
            foreach (string word in "one two three four five six".Split(' ')) lines.Add(word);
            lines.RemoveAll(w => w.Length == 3 && w[0] == 't');
            lines.Insert(0, "zero");
            lines.Reverse();
            ImmutableList<string> list = lines.ToImmutable();
            lines.Add("ignored by the snapshot");
            ImmutableList<string> sorted = list.Sort(StringComparer.Ordinal);
            Console.WriteLine(string.Join(" ", list) + " | " + string.Join(" ", sorted) + " | " + sorted.BinarySearch("six", StringComparer.Ordinal) + " " + list.IndexOf("five") + " " + list.FindIndex(w => w.Contains('z'))
                + " " + string.Join("", list.GetRange(1, 3).ConvertAll(w => w[0])) + " " + list.RemoveRange(new[] { "six", "one" }).Count + " " + list.Replace("four", "4").Find(w => w.Length == 1) + " " + list.Exists(w => w == "two") + list.TrueForAll(w => w.Length > 2) + " " + lines.Count);
            var counts = ImmutableDictionary.CreateBuilder<char, int>();
            foreach (char c in "mississippi") counts[c] = counts.GetValueOrDefault(c) + 1;
            counts.Remove('m');
            ImmutableDictionary<char, int> frequency = counts.ToImmutable();
            ImmutableDictionary<char, int> adjusted = frequency.SetItem('s', 40).Add('z', 1).RemoveRange(new[] { 'p', 'q' }).SetItems(new[] { KeyValuePair.Create('i', 0), KeyValuePair.Create('y', 2) });
            string Show(IEnumerable<KeyValuePair<char, int>> pairs) => string.Join(" ", pairs.OrderBy(p => p.Key).Select(p => p.Key + ":" + p.Value));
            Console.WriteLine(Show(frequency) + " | " + Show(adjusted) + " | " + frequency.TryGetValue('s', out int s) + s + " " + adjusted.ContainsKey('p') + " " + adjusted.TryGetKey('z', out char actual) + actual + " " + frequency.Count + "/" + adjusted.Count + " " + (frequency.Add('i', 4) == frequency));
            try { frequency.Add('i', 5); } catch (ArgumentException) { Console.WriteLine("adding a different value for an existing key throws"); }

            Console.WriteLine("-- sorted and set flavours");
            ImmutableSortedDictionary<string, int> ranks = ImmutableSortedDictionary.Create<string, int>(StringComparer.Ordinal).Add("gold", 1).Add("bronze", 3).Add("silver", 2);
            ImmutableSortedSet<int> evens = Enumerable.Range(1, 10).Where(n => n % 2 == 0).ToImmutableSortedSet();
            ImmutableHashSet<string> seen = ImmutableHashSet.Create(StringComparer.OrdinalIgnoreCase, "A", "b").Add("a").Add("C").Union(new[] { "B", "d" }).Except(new[] { "c" });
            Console.WriteLine(string.Join(" ", ranks.Select(p => p.Key + p.Value)) + " | " + ranks.Keys.First() + " " + ranks.Remove("gold").Values.Min() + " | " + string.Join(",", evens.Add(5).Remove(8)) + " " + evens.Min + ".." + evens.Max + " " + evens[1] + " " + evens.IndexOf(6)
                + " " + string.Join(",", evens.Intersect(new[] { 4, 5, 6, 12 })) + " | " + string.Join(",", seen.Order(StringComparer.Ordinal)) + " " + seen.Count + seen.Contains("D") + seen.SetEquals(new[] { "a", "B", "D" }));
            ImmutableQueue<int> queue = ImmutableQueue.Create(1, 2, 3).Enqueue(4);
            ImmutableQueue<int> rest = queue.Dequeue(out int head);
            ImmutableStack<char> stack = ImmutableStack.CreateRange("xyz");
            Console.WriteLine(head + " " + string.Join("", rest) + " " + string.Join("", queue) + " " + queue.Peek() + " " + string.Join("", stack) + " " + stack.Pop().Peek() + " " + stack.Pop().Pop().Pop().IsEmpty + " " + string.Join("", stack.Push('w')));
        }
    }
}
