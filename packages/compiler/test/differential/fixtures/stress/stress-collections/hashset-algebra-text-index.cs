using System;
using System.Collections.Generic;
using System.Linq;

string[] documents =
{
    "The quick brown fox jumps over the lazy dog",
    "A lazy afternoon: the dog sleeps, the cat watches",
    "Quick sort and merge sort are sorting algorithms",
    "The cat and the fox are not friends",
    "Brown bread, brown sugar and a quick breakfast",
};

var index = new TextIndex(new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "the", "a", "and", "are", "over", "not" });
for (int id = 0; id < documents.Length; id++) index.Add(id, documents[id]);

string Ids(IEnumerable<int> ids) => "{" + string.Join(",", ids.Order()) + "}";

Console.WriteLine($"terms={index.TermCount} postings={index.PostingCount} skipped={index.Skipped}");
Console.WriteLine("quick: " + Ids(index["QUICK"]) + " dog: " + Ids(index["dog"]) + " the: " + Ids(index["the"]) + " zebra: " + Ids(index["zebra"]));
Console.WriteLine("quick AND brown: " + Ids(index.All("quick", "brown")) + " | lazy AND dog AND cat: " + Ids(index.All("lazy", "dog", "cat")) + " | no terms: " + Ids(index.All()));
Console.WriteLine("fox OR cat: " + Ids(index.Any("fox", "cat")) + " | sort OR zebra: " + Ids(index.Any("sort", "zebra")));
Console.WriteLine("quick NOT brown: " + Ids(index.Without("quick", "brown")) + " | fox XOR cat: " + Ids(index.ExactlyOne("fox", "cat")));
Console.WriteLine("top terms: " + string.Join(" ", index.TopTerms(4).Select(t => t.Term + "x" + t.Documents)));

Console.WriteLine("-- set relations");
HashSet<int> quick = index["quick"], brown = index["brown"], everything = Enumerable.Range(0, documents.Length).ToHashSet();
var both = new HashSet<int>(quick);
both.IntersectWith(brown);
Console.WriteLine(string.Join(" ", both.IsSubsetOf(quick), both.IsProperSubsetOf(quick), quick.IsSubsetOf(quick), quick.IsProperSubsetOf(quick), quick.IsSupersetOf(both), everything.IsProperSupersetOf(quick),
    quick.Overlaps(index["cat"]), quick.Overlaps(brown), quick.SetEquals(new[] { 4, 2, 0, 0 }), new HashSet<int>().IsSubsetOf(both), both.SetEquals(brown)));
var complement = new HashSet<int>(everything);
complement.ExceptWith(quick);
var symmetric = new HashSet<int>(quick);
symmetric.SymmetricExceptWith(index["dog"]);
var union = new HashSet<int>(quick);
union.UnionWith(index["dog"]);
Console.WriteLine(Ids(complement) + Ids(symmetric) + Ids(union) + " removed " + union.RemoveWhere(id => id % 2 == 0) + " -> " + Ids(union) + " " + union.Add(1) + union.Add(3) + union.Remove(7) + union.Contains(3));
// De Morgan: not (A or B) == (not A) and (not B)
var notUnion = new HashSet<int>(everything.Except(quick.Union(brown)));
var notA = everything.Except(quick).ToHashSet();
notA.IntersectWith(everything.Except(brown));
Console.WriteLine("De Morgan holds: " + notUnion.SetEquals(notA) + " " + Ids(notUnion));

Console.WriteLine("-- comparers and lookups");
var tags = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Linq", "LINQ", "sets", "Sets ", "hash" };
Console.WriteLine(tags.Count + " " + tags.Contains("HASH") + " " + (tags.TryGetValue("linq", out string canonical) ? canonical : "?") + " " + tags.Comparer.Equals("a", "A") + " " + string.Join("|", tags.Order(StringComparer.Ordinal)));
var points = new HashSet<(int X, int Y)> { (0, 0), (1, 2), (0, 0), (2, 1) };
var mirrored = new HashSet<(int X, int Y)>(points.Select(p => (p.Y, p.X)));
Console.WriteLine(points.Count + " " + points.SetEquals(mirrored) + " " + points.Contains((1, 2)) + " " + points.Remove((1, 2)) + " " + points.IsProperSubsetOf(mirrored));
var families = new HashSet<HashSet<int>>(HashSet<int>.CreateSetComparer()) { new HashSet<int> { 1, 2 }, new HashSet<int> { 2, 1 }, new HashSet<int> { 3 } };
Console.WriteLine("distinct sets: " + families.Count + " " + families.Contains(new HashSet<int> { 3 }) + " " + families.Contains(new HashSet<int>()));

Console.WriteLine("-- dictionary operations");
var stock = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) { ["apple"] = 5, ["pear"] = 0 };
Console.WriteLine(string.Join(" ", stock.TryAdd("APPLE", 99), stock.TryAdd("fig", 12), stock["Apple"], stock.TryGetValue("PEAR", out int pears), pears, stock.TryGetValue("kiwi", out int kiwis), kiwis,
    stock.GetValueOrDefault("kiwi", 404), stock.Remove("pear", out int removed), removed, stock.Remove("pear", out removed), removed, stock.ContainsKey("FIG"), stock.ContainsValue(12), stock.Count));
stock["fig"] += 3;
stock["plum"] = stock.GetValueOrDefault("plum") + 1;
foreach (string key in stock.Keys.ToList()) if (stock[key] > 10) stock[key] /= 2;
foreach ((string fruit, int count) in stock.OrderBy(p => p.Key, StringComparer.Ordinal)) Console.WriteLine($"  {fruit,-6}{count,3}");
try { stock.Add("Fig", 1); } catch (ArgumentException) { Console.WriteLine("Add rejects an existing key"); }
try { Console.WriteLine(stock["durian"]); } catch (KeyNotFoundException) { Console.WriteLine("indexer get throws for a missing key"); }
var anagrams = new Dictionary<string, List<string>>();
foreach (string word in new[] { "listen", "silent", "enlist", "google", "gogole", "cat", "act", "tac", "dog" })
{
    string key = new string(word.Order().ToArray());
    if (!anagrams.TryGetValue(key, out List<string> group)) anagrams[key] = group = new List<string>();
    group.Add(word);
}
Console.WriteLine(string.Join(" ", anagrams.Where(p => p.Value.Count > 1).OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => p.Key + "=" + string.Join("/", p.Value))));
var byLength = new Dictionary<(int Length, char First), int>();
foreach (string word in documents.SelectMany(d => d.Split(' ')))
{
    var key = (word.Length, char.ToLowerInvariant(word[0]));
    byLength[key] = byLength.TryGetValue(key, out int seen) ? seen + 1 : 1;
}
Console.WriteLine(string.Join(" ", byLength.Where(p => p.Value > 1).OrderByDescending(p => p.Value).ThenBy(p => p.Key.Length).ThenBy(p => p.Key.First).Select(p => $"{p.Key.Length}{p.Key.First}:{p.Value}")));

public sealed class TextIndex
{
    private static readonly HashSet<int> Empty = new HashSet<int>();
    private readonly Dictionary<string, HashSet<int>> postings = new Dictionary<string, HashSet<int>>(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> stopWords;
    public TextIndex(HashSet<string> stopWords) { this.stopWords = stopWords; }
    public int TermCount => postings.Count;
    public int PostingCount => postings.Values.Sum(set => set.Count);
    public int Skipped { get; private set; }
    public HashSet<int> this[string term] => postings.TryGetValue(term, out HashSet<int> ids) ? ids : Empty;

    public void Add(int id, string text)
    {
        foreach (string word in text.Split(new[] { ' ', ',', ':' }, StringSplitOptions.RemoveEmptyEntries))
        {
            if (stopWords.Contains(word)) { Skipped++; continue; }
            if (!postings.TryGetValue(word, out HashSet<int> ids)) postings.Add(word, ids = new HashSet<int>());
            ids.Add(id);
        }
    }

    public HashSet<int> All(params string[] terms)
    {
        if (terms.Length == 0) return new HashSet<int>();
        var result = new HashSet<int>(this[terms[0]]);
        foreach (string term in terms.Skip(1)) result.IntersectWith(this[term]);
        return result;
    }

    public HashSet<int> Any(params string[] terms)
    {
        var result = new HashSet<int>();
        foreach (string term in terms) result.UnionWith(this[term]);
        return result;
    }

    public HashSet<int> Without(string wanted, string unwanted) { var result = new HashSet<int>(this[wanted]); result.ExceptWith(this[unwanted]); return result; }
    public HashSet<int> ExactlyOne(string left, string right) { var result = new HashSet<int>(this[left]); result.SymmetricExceptWith(this[right]); return result; }

    public IEnumerable<(string Term, int Documents)> TopTerms(int count) =>
        postings.Select(p => (Term: p.Key.ToLowerInvariant(), Documents: p.Value.Count)).OrderByDescending(t => t.Documents).ThenBy(t => t.Term, StringComparer.Ordinal).Take(count);
}
