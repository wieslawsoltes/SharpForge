using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

public sealed class Trie
{
    private sealed class Node
    {
        public readonly SortedDictionary<char, Node> Children = new SortedDictionary<char, Node>();
        public int Terminal;
        public int Passing;
    }

    private readonly Node root = new Node();
    public int Words { get; private set; }

    public void Add(string word)
    {
        var node = root;
        foreach (char c in word)
        {
            if (!node.Children.TryGetValue(c, out var next)) node.Children[c] = next = new Node();
            node = next;
            node.Passing++;
        }
        if (node.Terminal++ == 0) Words++;
    }

    private Node Find(string prefix)
    {
        var node = root;
        foreach (char c in prefix) if (!node.Children.TryGetValue(c, out node)) return null;
        return node;
    }

    public int Count(string word) => Find(word)?.Terminal ?? 0;
    public int CountPrefix(string prefix) => prefix.Length == 0 ? Words : Find(prefix)?.Passing ?? 0;

    public IEnumerable<string> Complete(string prefix)
    {
        var start = Find(prefix);
        if (start == null) yield break;
        var stack = new Stack<(Node Node, string Text)>();
        stack.Push((start, prefix));
        while (stack.Count > 0)
        {
            var (node, text) = stack.Pop();
            if (node.Terminal > 0) yield return text;
            foreach (var pair in node.Children.Reverse()) stack.Push((pair.Value, text + pair.Key));
        }
    }

    public string LongestCommonPrefix()
    {
        var builder = new StringBuilder();
        for (var node = root; node.Children.Count == 1 && node.Terminal == 0;)
        {
            var only = node.Children.First();
            builder.Append(only.Key);
            node = only.Value;
        }
        return builder.ToString();
    }
}

public static class Text
{
    public static IEnumerable<string> Words(string text)
    {
        int start = -1;
        for (int i = 0; i <= text.Length; i++)
        {
            bool letter = i < text.Length && (char.IsLetter(text[i]) || text[i] == '\'');
            if (letter && start < 0) start = i;
            else if (!letter && start >= 0)
            {
                yield return text.Substring(start, i - start).ToLowerInvariant().Trim('\'');
                start = -1;
            }
        }
    }

    public static IEnumerable<string> Sentences(string text) => text.Split(new[] { '.', '!', '?' }, StringSplitOptions.RemoveEmptyEntries).Select(s => s.Trim()).Where(s => s.Length > 0);
    public static string Sorted(string word) { var letters = word.ToCharArray(); Array.Sort(letters); return new string(letters); }
    public static int Syllables(string word) => Math.Max(1, word.Where((c, i) => "aeiouy".IndexOf(c) >= 0 && (i == 0 || "aeiouy".IndexOf(word[i - 1]) < 0)).Count() - (word.EndsWith("e") && word.Length > 2 ? 1 : 0));
    public static string Histogram(IEnumerable<(string Label, int Value)> bars, int width)
    {
        var list = bars.ToList();
        int max = list.Max(b => b.Value), labelWidth = list.Max(b => b.Label.Length);
        return string.Join("\n", list.Select(b => b.Label.PadRight(labelWidth) + " " + new string('#', Math.Max(1, b.Value * width / max)) + " " + b.Value));
    }
}

public static class Program
{
    private const string Passage = "It was the best of times, it was the worst of times. It was the age of wisdom; it was the age of foolishness! "
        + "Was it the epoch of belief? It was the epoch of incredulity. Listen: silent tinsel, enlist the inlets. Don't stop; the stop post spot tops opts.";

    public static void Main()
    {
        var words = Text.Words(Passage).ToList();
        var frequency = words.GroupBy(w => w).Select(g => (Word: g.Key, Count: g.Count())).OrderByDescending(p => p.Count).ThenBy(p => p.Word, StringComparer.Ordinal).ToList();
        Console.WriteLine(words.Count + " words, " + frequency.Count + " distinct, " + Text.Sentences(Passage).Count() + " sentences, average length " + words.Average(w => w.Length).ToString("F2", System.Globalization.CultureInfo.InvariantCulture));
        Console.WriteLine(Text.Histogram(frequency.Take(6).Select(p => (p.Word, p.Count)), 20));
        var byLength = words.Distinct().ToLookup(w => w.Length);
        Console.WriteLine(string.Join(" ", byLength.OrderBy(g => g.Key).Select(g => g.Key + ":" + g.Count())) + " longest " + string.Join("/", byLength[byLength.Max(g => g.Key)].OrderBy(w => w)));
        var anagrams = words.Distinct().GroupBy(Text.Sorted).Where(g => g.Count() > 1).OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal).Select(g => string.Join("=", g.OrderBy(w => w, StringComparer.Ordinal)));
        Console.WriteLine(string.Join(" | ", anagrams));
        Console.WriteLine(string.Join(" ", Text.Sentences(Passage).Select(s => Text.Words(s).Count() + ":" + Text.Words(s).Sum(Text.Syllables))) + " " + string.Join(",", new[] { "epoch", "age", "incredulity", "the", "rhythm" }.Select(Text.Syllables)));

        var trie = new Trie();
        foreach (var word in words) trie.Add(word);
        Console.WriteLine(trie.Words + " " + trie.Count("was") + trie.Count("wa") + trie.Count("times") + " " + trie.CountPrefix("t") + " " + trie.CountPrefix("") + " " + trie.CountPrefix("zz") + " [" + string.Join(",", trie.Complete("in")) + "] [" + string.Join(",", trie.Complete("s")) + "] [" + string.Join(",", trie.Complete("x")) + "] '" + trie.LongestCommonPrefix() + "'");
        var prefixes = new Trie();
        foreach (var word in new[] { "interstellar", "internet", "internal", "interval" }) prefixes.Add(word);
        Console.WriteLine(prefixes.LongestCommonPrefix() + " " + string.Join(",", prefixes.Complete("intern")));

        var bigrams = words.Zip(words.Skip(1), (a, b) => a + " " + b).GroupBy(b => b).Where(g => g.Count() > 1).OrderByDescending(g => g.Count()).ThenBy(g => g.Key).Select(g => g.Key + "x" + g.Count());
        var letters = Passage.Where(char.IsLetter).Select(char.ToLowerInvariant).GroupBy(c => c).OrderByDescending(g => g.Count()).ThenBy(g => g.Key).Take(5).Select(g => g.Key + "" + g.Count());
        Console.WriteLine(string.Join(", ", bigrams) + " | " + string.Join(" ", letters) + " | " + Passage.Count(char.IsPunctuation) + " " + Passage.Count(char.IsUpper) + " " + Passage.Split(' ').Count(t => t.EndsWith(".") || t.EndsWith("!") || t.EndsWith("?")));
        var acronym = string.Concat(Text.Sentences(Passage).Select(s => char.ToUpperInvariant(s[0])));
        var reversedWords = string.Join(" ", Text.Sentences(Passage).First().Split(' ').Reverse());
        var capitalised = string.Join(" ", words.Take(6).Select((w, i) => i % 2 == 0 ? char.ToUpperInvariant(w[0]) + w.Substring(1) : w.ToUpperInvariant()));
        Console.WriteLine(acronym + " | " + reversedWords + " | " + capitalised + " | " + words.Select(w => w.Length).Distinct().OrderBy(n => n).Aggregate(new StringBuilder(), (sb, n) => sb.Append(n).Append(';')).ToString());
    }
}
