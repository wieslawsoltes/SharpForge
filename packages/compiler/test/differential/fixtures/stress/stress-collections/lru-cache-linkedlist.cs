using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;

namespace Caching
{
    // Least-recently-used cache: a dictionary of linked-list nodes, most recent entry at the front.
    public sealed class LruCache<TKey, TValue> : IEnumerable<KeyValuePair<TKey, TValue>>
    {
        private readonly int capacity;
        private readonly Dictionary<TKey, LinkedListNode<KeyValuePair<TKey, TValue>>> map;
        private readonly LinkedList<KeyValuePair<TKey, TValue>> order = new LinkedList<KeyValuePair<TKey, TValue>>();

        public LruCache(int capacity, IEqualityComparer<TKey> comparer = null)
        {
            this.capacity = capacity;
            map = new Dictionary<TKey, LinkedListNode<KeyValuePair<TKey, TValue>>>(capacity, comparer);
        }

        public event Action<TKey, TValue> Evicted;
        public int Count => map.Count;
        public int Hits { get; private set; }
        public int Misses { get; private set; }

        public bool TryGet(TKey key, out TValue value)
        {
            if (map.TryGetValue(key, out LinkedListNode<KeyValuePair<TKey, TValue>> node))
            {
                if (node != order.First) { order.Remove(node); order.AddFirst(node); }
                value = node.Value.Value;
                Hits++;
                return true;
            }
            value = default;
            Misses++;
            return false;
        }

        public void Put(TKey key, TValue value)
        {
            if (map.Remove(key, out var existing)) order.Remove(existing);
            else if (map.Count == capacity)
            {
                LinkedListNode<KeyValuePair<TKey, TValue>> oldest = order.Last;
                order.RemoveLast();
                map.Remove(oldest.Value.Key);
                Evicted?.Invoke(oldest.Value.Key, oldest.Value.Value);
            }
            map.Add(key, order.AddFirst(KeyValuePair.Create(key, value)));
        }

        public TValue GetOrAdd(TKey key, Func<TKey, TValue> factory)
        {
            if (!TryGet(key, out TValue value)) Put(key, value = factory(key));
            return value;
        }

        public bool Remove(TKey key)
        {
            if (!map.Remove(key, out var node)) return false;
            order.Remove(node);
            return true;
        }

        public TValue this[TKey key]
        {
            get => TryGet(key, out TValue value) ? value : throw new KeyNotFoundException("no entry for " + key);
            set => Put(key, value);
        }

        public IEnumerator<KeyValuePair<TKey, TValue>> GetEnumerator() => order.GetEnumerator();
        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
        public override string ToString() => string.Join(" ", order.Select(pair => pair.Key + "=" + pair.Value));
    }

    public static class Program
    {
        private static string Walk<T>(LinkedList<T> list)
        {
            var forward = new List<string>();
            for (LinkedListNode<T> node = list.First; node != null; node = node.Next) forward.Add(node.Value.ToString());
            var backward = new List<string>();
            for (LinkedListNode<T> node = list.Last; node != null; node = node.Previous) backward.Add(node.Value.ToString());
            backward.Reverse();
            return string.Join(">", forward) + (forward.SequenceEqual(backward) ? "" : " BROKEN LINKS") + " (" + list.Count + ")";
        }

        public static void Main()
        {
            var cache = new LruCache<string, int>(3, StringComparer.OrdinalIgnoreCase);
            var evictions = new List<string>();
            cache.Evicted += (key, value) => evictions.Add(key + ":" + value);
            cache.Put("one", 1); cache.Put("two", 2); cache.Put("three", 3);
            Console.WriteLine(cache + " | count " + cache.Count);
            Console.WriteLine(cache.TryGet("ONE", out int one) + " " + one + " -> " + cache);
            cache.Put("four", 4);
            cache["Three"] = 33;
            cache.Put("five", 5);
            Console.WriteLine(cache + " | evicted " + string.Join(",", evictions));
            Console.WriteLine(cache.TryGet("two", out int two) + " " + two + " " + cache.Remove("FOUR") + " " + cache.Remove("four") + " " + cache["three"] + " -> " + cache);
            try { Console.WriteLine(cache["zero"]); }
            catch (KeyNotFoundException e) { Console.WriteLine(e.Message + " | hits " + cache.Hits + " misses " + cache.Misses); }
            foreach (var (key, value) in cache) Console.WriteLine($"  entry {key,-6}{value,3}");

            var collatz = new LruCache<long, int>(8);
            int computed = 0;
            int Steps(long n) => n == 1 ? 0 : collatz.GetOrAdd(n, k => { computed++; return 1 + Steps(k % 2 == 0 ? k / 2 : 3 * k + 1); });
            Console.WriteLine(string.Join(" ", new long[] { 6, 7, 6, 12, 27, 7, 3 }.Select(n => n + ":" + Steps(n))));
            Console.WriteLine($"computed {computed}, hits {collatz.Hits}, misses {collatz.Misses}, kept {string.Join(",", collatz.Select(p => p.Key))}");

            var playlist = new LinkedList<string>(new[] { "intro", "verse", "chorus", "outro" });
            Console.WriteLine(Walk(playlist));
            LinkedListNode<string> chorus = playlist.Find("chorus");
            playlist.AddBefore(chorus, "bridge");
            LinkedListNode<string> solo = playlist.AddAfter(chorus, "solo");
            playlist.AddAfter(solo, new LinkedListNode<string>("chorus"));
            playlist.AddFirst("count-in");
            Console.WriteLine(Walk(playlist));
            Console.WriteLine(playlist.Find("chorus") == chorus);
            Console.WriteLine(playlist.FindLast("chorus").Previous.Value + " " + chorus.Next.Value + " " + chorus.Previous.Previous.Value + " " + (playlist.Find("missing") == null) + " " + (solo.List == playlist));

            LinkedListNode<string> first = playlist.First;
            playlist.RemoveFirst();
            playlist.AddLast(first);
            playlist.Remove(solo);
            Console.WriteLine(Walk(playlist) + " detached=" + (solo.List == null && solo.Next == null) + " removed=" + playlist.Remove("verse") + playlist.Remove("verse"));
            var encore = new LinkedList<string>();
            encore.AddLast(solo);
            try { playlist.AddLast(encore.First); }
            catch (InvalidOperationException) { Console.WriteLine("a node belongs to one list at a time"); }

            var numbers = new LinkedList<int>(Enumerable.Range(1, 10));
            for (LinkedListNode<int> node = numbers.First; node != null;)
            {
                LinkedListNode<int> next = node.Next;
                if (node.Value % 3 == 0) numbers.Remove(node);
                else if (node.Value % 4 == 0) numbers.AddBefore(node, node.Value * 10);
                else node.ValueRef *= 2;
                node = next;
            }
            Console.WriteLine(Walk(numbers) + " sum=" + numbers.Sum() + " contains 40: " + numbers.Contains(40));
            var josephus = new LinkedList<int>(Enumerable.Range(1, 7));
            var eliminated = new List<int>();
            LinkedListNode<int> current = josephus.First;
            while (josephus.Count > 1)
            {
                for (int skip = 0; skip < 2; skip++) current = current.Next ?? josephus.First;
                LinkedListNode<int> victim = current;
                current = current.Next ?? josephus.First;
                eliminated.Add(victim.Value);
                josephus.Remove(victim);
            }
            Console.WriteLine("eliminated " + string.Join(",", eliminated) + " survivor " + josephus.First.Value);
        }
    }
}
