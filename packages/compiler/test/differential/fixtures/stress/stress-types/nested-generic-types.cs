using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;

public class LinkedDeque<T> : IEnumerable<T>
{
    internal sealed class Node
    {
        public Node(T value) { Value = value; }
        public T Value;
        public Node Previous, Next;
    }

    public struct Enumerator : IEnumerator<T>
    {
        private readonly LinkedDeque<T> owner;
        private Node current;
        private bool started;
        internal Enumerator(LinkedDeque<T> owner) { this.owner = owner; current = null; started = false; }
        public T Current => current.Value;
        object IEnumerator.Current => Current;
        public bool MoveNext()
        {
            current = started ? current?.Next : owner.head;
            started = true;
            return current != null;
        }
        public void Reset() { current = null; started = false; }
        public void Dispose() { }
    }

    public class Cursor
    {
        private readonly LinkedDeque<T> owner;
        private Node node;
        internal Cursor(LinkedDeque<T> owner, Node node) { this.owner = owner; this.node = node; }
        public bool Valid => node != null;
        public T Value { get => node.Value; set => node.Value = value; }
        public Cursor Forward() { node = node?.Next; return this; }
        public void InsertAfter(T value)
        {
            var added = new Node(value) { Previous = node, Next = node.Next };
            if (node.Next != null) node.Next.Previous = added; else owner.tail = added;
            node.Next = added;
            owner.Count++;
        }
    }

    private Node head, tail;
    public int Count { get; private set; }

    public void PushFront(T value)
    {
        var node = new Node(value) { Next = head };
        if (head != null) head.Previous = node; else tail = node;
        head = node;
        Count++;
    }

    public void PushBack(T value)
    {
        var node = new Node(value) { Previous = tail };
        if (tail != null) tail.Next = node; else head = node;
        tail = node;
        Count++;
    }

    public bool TryPopFront(out T value)
    {
        if (head == null) { value = default; return false; }
        value = head.Value;
        head = head.Next;
        if (head != null) head.Previous = null; else tail = null;
        Count--;
        return true;
    }

    public T PopBack()
    {
        if (tail == null) throw new InvalidOperationException("empty");
        T value = tail.Value;
        tail = tail.Previous;
        if (tail != null) tail.Next = null; else head = null;
        Count--;
        return value;
    }

    public Cursor First() => new Cursor(this, head);
    public Enumerator GetEnumerator() => new Enumerator(this);
    IEnumerator<T> IEnumerable<T>.GetEnumerator() => GetEnumerator();
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();

    public LinkedDeque<TResult> Map<TResult>(Func<T, TResult> selector)
    {
        var result = new LinkedDeque<TResult>();
        foreach (var item in this) result.PushBack(selector(item));
        return result;
    }
}

public static class Outer<TKey> where TKey : notnull
{
    public sealed class Cache<TValue>
    {
        private readonly Dictionary<TKey, Entry> entries = new Dictionary<TKey, Entry>();
        public readonly struct Entry
        {
            public Entry(TValue value, int hits) { Value = value; Hits = hits; }
            public TValue Value { get; }
            public int Hits { get; }
            public Entry Hit() => new Entry(Value, Hits + 1);
        }
        public TValue GetOrAdd(TKey key, Func<TKey, TValue> factory)
        {
            entries[key] = entries.TryGetValue(key, out var entry) ? entry.Hit() : new Entry(factory(key), 0);
            return entries[key].Value;
        }
        public IEnumerable<KeyValuePair<TKey, Entry>> Entries => entries;
        public static string Describe() => $"Cache<{typeof(TKey).Name},{typeof(TValue).Name}>";
    }
    public static Cache<TValue> Create<TValue>() => new Cache<TValue>();
}

public static class Program
{
    public static void Main()
    {
        var deque = new LinkedDeque<int>();
        for (int i = 1; i <= 4; i++) { deque.PushBack(i); deque.PushFront(-i); }
        Console.WriteLine(string.Join(" ", deque) + " count=" + deque.Count);
        deque.TryPopFront(out int front);
        Console.WriteLine(front + " " + deque.PopBack() + " " + deque.Sum() + " " + deque.Max() + " " + deque.Count);
        var cursor = deque.First().Forward().Forward();
        cursor.Value *= 100;
        cursor.InsertAfter(7);
        int steps = 0;
        for (var walker = deque.First(); walker.Valid; walker.Forward()) steps++;
        Console.WriteLine(string.Join(",", deque.Map(n => n < 0 ? "(" + -n + ")" : n.ToString())) + " " + steps);
        int total = 0;
        foreach (var item in deque) total += item;
        LinkedDeque<int>.Enumerator enumerator = deque.GetEnumerator();
        enumerator.MoveNext();
        var copy = enumerator;
        copy.MoveNext();
        Console.WriteLine(total + " " + enumerator.Current + " " + copy.Current);
        var empty = new LinkedDeque<string>();
        Console.WriteLine(empty.TryPopFront(out var nothing) + " " + (nothing == null) + " " + empty.Any());
        try { empty.PopBack(); } catch (InvalidOperationException e) { Console.WriteLine(e.Message); }

        var cache = Outer<string>.Create<int>();
        int computed = 0;
        foreach (var word in new[] { "aa", "b", "aa", "ccc", "aa", "b" }) cache.GetOrAdd(word, key => { computed++; return key.Length; });
        Console.WriteLine(computed + " " + string.Join(" ", cache.Entries.Select(pair => pair.Key + "=" + pair.Value.Value + "/" + pair.Value.Hits)));
        Console.WriteLine(Outer<string>.Cache<int>.Describe() + " " + Outer<int>.Cache<List<string>>.Describe() + " " + typeof(Outer<long>.Cache<bool>.Entry).Name + " " + typeof(LinkedDeque<>.Cursor).Name);
        var nested = new Dictionary<string, List<(int Id, Dictionary<char, int[]> Map)>>();
        nested["k"] = new List<(int, Dictionary<char, int[]>)> { (1, new Dictionary<char, int[]> { ['x'] = new[] { 1, 2 } }) };
        nested["k"][0].Map['x'][1] += 40;
        Console.WriteLine(nested["k"][0].Id + nested["k"][0].Map['x'].Sum());
    }
}
