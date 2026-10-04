using System;
using System.Diagnostics.CodeAnalysis;
using System.Globalization;

public ref struct RingBuffer<T>
{
    private readonly Span<T> _items;
    private readonly ref int _overwrites;
    private int _head, _count;

    public RingBuffer(Span<T> storage, ref int overwrites)
    {
        _items = storage;
        _overwrites = ref overwrites;
        _head = 0;
        _count = 0;
    }

    public readonly int Count => _count;
    public readonly int Capacity => _items.Length;
    public readonly ref T this[int index] => ref _items[(_head + index) % _items.Length];

    public void Push(T item)
    {
        if (_count == _items.Length)
        {
            _items[_head] = item;
            _head = (_head + 1) % _items.Length;
            _overwrites++;
            return;
        }
        this[_count++] = item;
    }

    public bool TryPop(out T item)
    {
        if (_count == 0) { item = default; return false; }
        item = _items[_head];
        _items[_head] = default;
        _head = (_head + 1) % _items.Length;
        _count--;
        return true;
    }

    public readonly int CopyTo(scoped Span<T> destination)
    {
        int n = Math.Min(_count, destination.Length);
        for (int i = 0; i < n; i++) destination[i] = this[i];
        return n;
    }

    public readonly Enumerator GetEnumerator() => new Enumerator(this);

    public ref struct Enumerator
    {
        private readonly RingBuffer<T> _ring;
        private int _index;
        public Enumerator(RingBuffer<T> ring) { _ring = ring; _index = -1; }
        public readonly ref readonly T Current => ref _ring[_index];
        public bool MoveNext() => ++_index < _ring.Count;
    }
}

public ref struct TextBuilder
{
    private Span<char> _chars;
    private int _length;

    public TextBuilder(Span<char> initial) { _chars = initial; _length = 0; Grows = 0; }
    public int Grows { get; private set; }
    public readonly int Length => _length;
    public readonly int Capacity => _chars.Length;
    public readonly ReadOnlySpan<char> Written => _chars[.._length];
    public readonly ref char this[Index index] => ref _chars[.._length][index];

    public void Append(char c)
    {
        if (_length == _chars.Length) Grow(1);
        _chars[_length++] = c;
    }

    public void Append(scoped ReadOnlySpan<char> text)
    {
        if (text.Length > _chars.Length - _length) Grow(text.Length);
        text.CopyTo(_chars[_length..]);
        _length += text.Length;
    }

    public void Append(int value, scoped ReadOnlySpan<char> format = default)
    {
        Span<char> digits = stackalloc char[16];
        value.TryFormat(digits, out int written, format, CultureInfo.InvariantCulture);
        Append(digits[..written]);
    }

    public void Insert(int index, scoped ReadOnlySpan<char> text)
    {
        if (text.Length > _chars.Length - _length) Grow(text.Length);
        _chars[index.._length].CopyTo(_chars[(index + text.Length)..]);
        text.CopyTo(_chars[index..]);
        _length += text.Length;
    }

    public void Truncate(int length) { _chars[length.._length].Clear(); _length = length; }

    private void Grow(int extra)
    {
        var bigger = new char[Math.Max(_chars.Length * 2, _length + extra)];
        _chars[.._length].CopyTo(bigger);
        _chars = bigger;
        Grows++;
    }

    public override readonly string ToString() => new string(_chars[.._length]);
    public void Dispose() { _chars.Clear(); _length = 0; }
}

public struct Accumulator
{
    private long _sum;
    private int _samples;
    [UnscopedRef] public ref long Sum => ref _sum;
    [UnscopedRef] public ref int Samples => ref _samples;
    public readonly long Average => _samples == 0 ? 0 : _sum / _samples;
}

public static class Program
{
    private static string Join<T>(RingBuffer<T> ring)
    {
        using var text = new TextBuilder(stackalloc char[4]);
        foreach (ref readonly T item in ring)
        {
            if (text.Length > 0) text.Append(',');
            text.Append(item is null ? "null" : item.ToString());
        }
        return text.ToString();
    }

    private static void Feed(ref RingBuffer<int> ring, ref Accumulator stats, params ReadOnlySpan<int> values)
    {
        foreach (int value in values)
        {
            ring.Push(value);
            stats.Sum += value;
            stats.Samples++;
        }
    }

    public static void Main()
    {
        int overwrites = 0;
        var ring = new RingBuffer<int>(stackalloc int[4], ref overwrites);
        var stats = new Accumulator();
        Feed(ref ring, ref stats, 1, 2, 3);
        Console.WriteLine($"{Join(ring)} count={ring.Count}/{ring.Capacity} overwrites={overwrites}");
        Feed(ref ring, ref stats, 4, 5, 6, 7);
        Console.WriteLine($"{Join(ring)} count={ring.Count} overwrites={overwrites} sum={stats.Sum} avg={stats.Average}");
        ring[0] *= 10;
        ref int second = ref ring[1];
        second = -second;
        ref long total = ref stats.Sum;
        total -= 28;
        Console.WriteLine($"{Join(ring)} first={ring[0]} last={ring[ring.Count - 1]} sum={stats.Sum} samples={stats.Samples}");
        Span<int> snapshot = stackalloc int[3];
        int copied = ring.CopyTo(snapshot);
        bool popped = ring.TryPop(out int oldest) & ring.TryPop(out int next);
        ring.Push(100);
        Console.WriteLine($"{copied}:{snapshot[0]},{snapshot[1]},{snapshot[2]} popped={popped} {oldest} {next} now {Join(ring)}");
        while (ring.TryPop(out _)) { }
        Console.WriteLine($"empty={ring.Count == 0} pop={ring.TryPop(out int nothing)} {nothing} overwrites={overwrites} [{Join(ring)}]");

        int dropped = 0;
        var words = new RingBuffer<string>(new string[3], ref dropped);
        foreach (var word in "the quick brown fox jumps".Split(' ')) words.Push(word);
        words[1] = words[1].ToUpperInvariant();
        Console.WriteLine($"{Join(words)} dropped={dropped} {words.TryPop(out var head)} {head} {Join(words)}");

        var window = new RingBuffer<int>(stackalloc int[3], ref dropped);
        foreach (int sample in new[] { 5, 9, 2, 8 })
        {
            window.Push(sample);
            Console.WriteLine($"window {Join(window)} dropped={dropped}");
        }
        var builder = new TextBuilder(stackalloc char[8]);
        builder.Append("id=");
        builder.Append(42);
        builder.Append(';');
        Console.WriteLine($"{builder.ToString()} len={builder.Length} cap={builder.Capacity} grows={builder.Grows}");
        builder.Append(" hex=");
        builder.Append(255, "X4");
        builder.Append(-7, "D3");
        builder.Insert(0, "[row] ");
        builder[0] = '<';
        builder[^1] = '!';
        ref char mark = ref builder[4];
        mark = '>';
        Console.WriteLine($"{builder.ToString()} len={builder.Length} cap={builder.Capacity} grows={builder.Grows} {builder.Written.IndexOf("hex")} {builder.Written[^5..].ToString()}");
        builder.Truncate(11);
        for (int i = 0; i < 30; i++) builder.Append((char)('a' + i % 26));
        Console.WriteLine($"{builder.ToString()} len={builder.Length} cap={builder.Capacity} grows={builder.Grows}");
        builder.Dispose();
        Console.WriteLine($"disposed len={builder.Length} [{builder.ToString()}] {builder.Written.IsEmpty}");

        var totals = new Accumulator[2];
        for (int i = 1; i <= 6; i++)
        {
            ref Accumulator bucket = ref totals[i % 2];
            bucket.Sum += i * i;
            bucket.Samples += 1;
        }
        Console.WriteLine($"{totals[0].Sum}/{totals[0].Samples}={totals[0].Average} {totals[1].Sum}/{totals[1].Samples}={totals[1].Average}");
    }
}
