using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;

namespace CustomCollections
{
    // Fixed-capacity buffer that overwrites its oldest element; usable with collection initializers, foreach and LINQ.
    public sealed class RingBuffer<T> : ICollection<T>, IReadOnlyList<T>
    {
        private readonly T[] buffer;
        private int head, version;
        public RingBuffer(int capacity) { buffer = new T[capacity]; }
        public int Count { get; private set; }
        public int Dropped { get; private set; }
        public bool IsReadOnly => false;
        public T this[int index] => (uint)index < (uint)Count ? buffer[(head + index) % buffer.Length] : throw new ArgumentOutOfRangeException(nameof(index));

        public void Add(T item)
        {
            version++;
            if (Count < buffer.Length) { buffer[(head + Count++) % buffer.Length] = item; return; }
            buffer[head] = item;
            head = (head + 1) % buffer.Length;
            Dropped++;
        }

        public void Clear() { version++; head = 0; Count = 0; Array.Clear(buffer); }
        public bool Contains(T item) => IndexOf(item) >= 0;
        public int IndexOf(T item)
        {
            for (int i = 0; i < Count; i++) if (EqualityComparer<T>.Default.Equals(this[i], item)) return i;
            return -1;
        }

        public void CopyTo(T[] array, int arrayIndex) { for (int i = 0; i < Count; i++) array[arrayIndex + i] = this[i]; }

        public bool Remove(T item)
        {
            int index = IndexOf(item);
            if (index < 0) return false;
            version++;
            for (int i = index; i < Count - 1; i++) buffer[(head + i) % buffer.Length] = buffer[(head + i + 1) % buffer.Length];
            Count--;
            return true;
        }

        public IEnumerator<T> GetEnumerator()
        {
            int expected = version;
            for (int i = 0; i < Count; i++)
            {
                if (expected != version) throw new InvalidOperationException("buffer changed during enumeration");
                yield return this[i];
            }
        }

        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    }

    // Dictionary-like type with two indexers, an Add method for initializers and read-only views of its values.
    public sealed class MultiMap<TKey, TValue> : IEnumerable<KeyValuePair<TKey, ReadOnlyCollection<TValue>>>
    {
        private readonly SortedDictionary<TKey, List<TValue>> groups;
        public MultiMap(IComparer<TKey> comparer = null) { groups = new SortedDictionary<TKey, List<TValue>>(comparer); }
        public int KeyCount => groups.Count;
        public void Add(TKey key, TValue value) => Bucket(key).Add(value);
        public void Add(TKey key, params TValue[] values) => Bucket(key).AddRange(values);
        private List<TValue> Bucket(TKey key) { if (!groups.TryGetValue(key, out var list)) groups[key] = list = new List<TValue>(); return list; }

        public ReadOnlyCollection<TValue> this[TKey key]
        {
            get => groups.TryGetValue(key, out var list) ? list.AsReadOnly() : ReadOnlyCollection<TValue>.Empty;
            set => groups[key] = new List<TValue>(value);
        }

        public TValue this[TKey key, int index]
        {
            get => groups[key][index];
            set => groups[key][index] = value;
        }

        public IEnumerator<KeyValuePair<TKey, ReadOnlyCollection<TValue>>> GetEnumerator() => groups.Select(p => KeyValuePair.Create(p.Key, p.Value.AsReadOnly())).GetEnumerator();
        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    }

    public static class Program
    {
        private static string Bits(BitArray bits) => string.Concat(bits.Cast<bool>().Select(b => b ? '1' : '0'));
        private static int PopCount(BitArray bits) { int n = 0; foreach (bool bit in bits) if (bit) n++; return n; }

        public static void Main()
        {
            var ring = new RingBuffer<string>(4) { "a", "b", "c" };
            Console.WriteLine(string.Join("", ring) + " " + ring.Count + " " + ring[0] + ring[2] + " " + ring.Contains("b") + ring.Contains("z"));
            foreach (string s in new[] { "d", "e", "f" }) ring.Add(s);
            Console.WriteLine(string.Join("", ring) + " dropped=" + ring.Dropped + " first=" + ring.First() + " last=" + ring[^1] + " " + ring.Remove("d") + ring.Remove("a") + " " + string.Join("", ring) + " " + ring.IndexOf("f"));
            ring.Add("g"); ring.Add("h");
            var target = new string[6];
            ring.CopyTo(target, 1);
            ICollection<string> asCollection = ring;
            IReadOnlyList<string> asList = ring;
            Console.WriteLine(string.Join(",", target.Select(t => t ?? "-")) + " " + asCollection.Count + asList.Count + " " + asList[1] + " " + string.Join("", ring.Reverse()) + " " + string.Join("", ring.Where(s => s[0] > 'f').Select(s => s.ToUpperInvariant())) + " " + new List<string>(ring).Count + " " + ring.ToArray().Length);
            try { foreach (string s in ring) if (s == "f") ring.Add("x"); }
            catch (InvalidOperationException e) { Console.WriteLine(e.Message + " -> " + string.Join("", ring)); }
            try { Console.WriteLine(ring[4]); } catch (ArgumentOutOfRangeException e) { Console.WriteLine("bad index: " + e.ParamName); }
            var samples = new RingBuffer<double>(3) { 1.5, 2.5, 4.0, 8.0 };
            ring.Clear();
            Console.WriteLine(samples.Sum().ToString("F2", System.Globalization.CultureInfo.InvariantCulture) + " " + (int)samples.Max() + " " + samples.Count + " " + ring.Count + ring.Any() + " " + ((IEnumerable)samples).Cast<double>().Count(d => d > 3));

            Console.WriteLine("-- multimap with indexers and initializers");
            var routes = new MultiMap<string, string>(StringComparer.OrdinalIgnoreCase) { { "GET", "/users" }, { "post", "/users" }, { "get", "/orders", "/health" }, { "DELETE", "/users/1" } };
            routes["PUT"] = new ReadOnlyCollection<string>(new[] { "/users/1", "/orders/7" });
            routes["get", 1] = routes["GET", 1].ToUpperInvariant();
            foreach (var (verb, paths) in routes) Console.WriteLine($"  {verb,-7}{paths.Count} {string.Join(" ", paths)}");
            ReadOnlyCollection<string> gets = routes["Get"];
            routes.Add("GET", "/late");
            Console.WriteLine(routes.KeyCount + " " + gets.Count + " " + gets[^1] + " " + gets.Contains("/users") + " " + gets.IndexOf("/health") + " " + routes["PATCH"].Count + " " + routes.Sum(p => p.Value.Count) + " " + routes.Max(p => p.Value.Count));
            try { ((IList<string>)gets).Add("/hack"); } catch (NotSupportedException) { Console.WriteLine("read-only view rejects Add"); }
            try { ((IList<string>)gets)[0] = "/hack"; } catch (NotSupportedException) { Console.WriteLine("read-only view rejects the indexer setter"); }
            var settings = new Dictionary<string, int> { ["retries"] = 3, ["timeout"] = 30 };
            var frozen = new ReadOnlyDictionary<string, int>(settings);
            settings["retries"]++;
            KeyValuePair<string, int> pair = KeyValuePair.Create("timeout", frozen["timeout"]);
            var (name, number) = pair;
            Console.WriteLine(frozen["retries"] + " " + frozen.Count + " " + frozen.TryGetValue("timeout", out int timeout) + timeout + " " + name + "=" + number + " " + pair + " " + frozen.Keys.Contains("retries") + " " + (frozen is IDictionary<string, int> { IsReadOnly: true }));

            Console.WriteLine("-- BitArray");
            var sieve = new BitArray(60, true);
            sieve[0] = sieve[1] = false;
            for (int i = 2; i * i < sieve.Length; i++) if (sieve[i]) for (int j = i * i; j < sieve.Length; j += i) sieve.Set(j, false);
            Console.WriteLine(PopCount(sieve) + " primes: " + string.Join(" ", Enumerable.Range(0, sieve.Length).Where(sieve.Get)));
            var read = new BitArray(new[] { true, true, false, false, true, false, true, false });
            var write = new BitArray(new byte[] { 0b0101_0110 });
            Console.WriteLine(Bits(read) + " " + Bits(write) + " and=" + Bits(new BitArray(read).And(write)) + " or=" + Bits(new BitArray(read).Or(write)) + " xor=" + Bits(new BitArray(read).Xor(write)) + " not=" + Bits(new BitArray(read).Not()));
            var shifted = new BitArray(read).LeftShift(2);
            var packed = new int[1];
            read.CopyTo(packed, 0);
            var wide = new BitArray(new[] { 0x0F0F, 1 });
            Console.WriteLine(Bits(shifted) + " " + Bits(new BitArray(read).RightShift(3)) + " " + packed[0] + " " + wide.Length + " " + PopCount(wide) + " " + read.HasAnySet() + read.HasAllSet() + new BitArray(3, true).HasAllSet() + " " + PopCount(new BitArray(read) { Length = 4 }) + " " + read.Count);
            read.SetAll(false);
            read[^1] = true;
            Console.WriteLine(Bits(read) + " " + read.Get(7) + " " + Bits(new BitArray(5)));
        }
    }
}
