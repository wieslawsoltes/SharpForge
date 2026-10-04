using System;
using System.Collections.Generic;

public struct Pixel
{
    public byte R, G, B, A;
}

public unsafe struct Packet
{
    public fixed byte Payload[8];
    public int Length;
    public short Tag;
}

public unsafe struct Node
{
    public int Value;
    public Node* Next;
}

public static unsafe class Native
{
    public static int Sum(int* values, int count)
    {
        int total = 0;
        for (int* p = values, end = values + count; p < end; p++) total += *p;
        return total;
    }

    public static void Reverse(char* text, int length)
    {
        for (char* left = text, right = text + length - 1; left < right; left++, right--)
        {
            char swap = *left;
            *left = *right;
            *right = swap;
        }
    }

    public static int Length(byte* zeroTerminated)
    {
        byte* cursor = zeroTerminated;
        while (*cursor != 0) cursor++;
        return (int)(cursor - zeroTerminated);
    }

    public static void Swap<T>(T* a, T* b) where T : unmanaged
    {
        T held = *a;
        *a = *b;
        *b = held;
    }

    public static uint ByteSum(void* data, int bytes)
    {
        uint sum = 0;
        byte* p = (byte*)data;
        for (int i = 0; i < bytes; i++) sum += p[i];
        return sum;
    }

    public static int Walk(Node* head, delegate*<int, int, int> combine, int seed)
    {
        for (Node* node = head; node != null; node = node->Next) seed = combine(seed, node->Value);
        return seed;
    }

    public static int Add(int a, int b) => a + b;
    public static int Sub(int a, int b) => a - b;
    public static int Mul(int a, int b) => a * b;
    public static T Largest<T>(T a, T b) where T : IComparable<T> => a.CompareTo(b) >= 0 ? a : b;
    public static void Triple(ref int value) => value *= 3;
    public static bool TryHalve(int value, out int half) { half = value / 2; return value % 2 == 0; }

    public static delegate*<int, int, int> Pick(char symbol) => symbol switch
    {
        '+' => &Add,
        '-' => &Sub,
        '*' => &Mul,
        '>' => &Largest<int>,
        _ => null,
    };

    public static int Fold(delegate*<int, int, int> operation, int seed, ReadOnlySpan<int> values)
    {
        foreach (int value in values) seed = operation(seed, value);
        return seed;
    }

    public static T Apply<T>(delegate*<T, T, T> operation, T left, T right) => operation(left, right);

    public static void Map(int* values, int count, delegate*<ref int, void> mutate)
    {
        for (int i = 0; i < count; i++) mutate(ref values[i]);
    }
}

public static unsafe class Program
{
    private static string Join(int* values, int count)
    {
        var parts = new List<string>();
        for (int i = 0; i < count; i++) parts.Add((*(values + i)).ToString());
        return string.Join(",", parts);
    }

    public static void Main()
    {
        int* numbers = stackalloc int[] { 4, 8, 15, 16, 23, 42 };
        int* middle = numbers + 2;
        Console.WriteLine($"{Native.Sum(numbers, 6)} {*middle} {middle[-1]} {middle[3]} {*(middle + 1)} {middle - numbers} {(numbers + 6) - middle} {middle > numbers} {&numbers[2] == middle}");
        Native.Swap(numbers, numbers + 5);
        Native.Swap(&middle[0], &middle[1]);
        *middle++ += 100;
        (*middle)--;
        Console.WriteLine($"{Join(numbers, 6)} {*middle} {middle - numbers} {sizeof(int)} {sizeof(long)} {sizeof(char)} {sizeof(Pixel)} {sizeof(decimal)} {sizeof(Packet)} {sizeof(double) * 2 + sizeof(byte)}");

        int[] managed = { 1, 2, 3, 4, 5 };
        fixed (int* first = managed, last = &managed[^1])
        {
            int* next = first + 1;
            *next = 20;
            *last *= 10;
            Console.WriteLine($"{Native.Sum(first, managed.Length)} {last - first} {string.Join(",", managed)} {Native.Sum(first + 3, 2)}");
        }
        char[] letters = "pointers".ToCharArray();
        fixed (char* text = letters) { Native.Reverse(text, letters.Length); Native.Reverse(text + 1, 3); }
        string word = "unsafe";
        int vowels = 0;
        fixed (char* chars = word)
        {
            for (char* c = chars; *c != '\0'; c++) if (*c is 'a' or 'e' or 'u') vowels++;
        }
        byte[] ascii = { (byte)'h', (byte)'e', (byte)'y', 0, (byte)'x', 0 };
        fixed (byte* bytes = ascii) Console.WriteLine($"{new string(letters)} {vowels} {Native.Length(bytes)} {Native.Length(bytes + 4)} {Native.Length(bytes + 3)} {Native.ByteSum(bytes, ascii.Length)}");

        Pixel* pixels = stackalloc Pixel[3];
        for (int i = 0; i < 3; i++) pixels[i] = new Pixel { R = (byte)(i * 40), G = (byte)(255 - i), B = 7, A = 255 };
        Pixel* cursor = pixels + 1;
        cursor->R += 5;
        (*cursor).G = 1;
        (cursor + 1)->B = cursor->R;
        Native.Swap(pixels, cursor);
        byte* raw = (byte*)pixels;
        Console.WriteLine($"{pixels->R},{pixels->G} {pixels[1].R},{pixels[1].G} {pixels[2].B} {raw[0]} {raw[sizeof(Pixel) + 1]} {raw[2 * sizeof(Pixel) + 3]} {Native.ByteSum(pixels, 3 * sizeof(Pixel))} {(byte*)(pixels + 3) - raw}");

        Packet packet = default;
        packet.Tag = 9;
        for (int i = 0; i < 5; i++) packet.Payload[i] = (byte)('a' + i);
        packet.Length = Native.Length(packet.Payload);
        Packet* alias = &packet;
        alias->Payload[1] = (byte)'Z';
        var copy = packet;
        copy.Payload[0] = (byte)'!';
        Console.WriteLine($"{packet.Length} {(char)packet.Payload[0]}{(char)packet.Payload[1]}{(char)copy.Payload[0]}{(char)copy.Payload[4]} {alias->Tag} {Native.ByteSum(alias->Payload, 8)} {Native.ByteSum(copy.Payload, 8)}");

        Node third = new() { Value = 3 }, second = new() { Value = 20, Next = &third }, head = new() { Value = 100, Next = &second };
        int local = 5;
        int* pointer = &local;
        int** indirect = &pointer;
        **indirect += 37;
        *indirect = &second.Value;
        *pointer += 2;
        Console.WriteLine($"{local} {second.Value} {Native.Walk(&head, &Native.Add, 0)} {Native.Walk(&head, &Native.Sub, 0)} {Native.Walk(head.Next, &Native.Mul, 1)} {Native.Walk(null, &Native.Add, -1)} {head.Next->Next->Value} {third.Next == null}");

        delegate*<int, int, int>[] table = { &Native.Add, &Native.Sub, &Native.Mul, &Math.Max, &Native.Largest<int> };
        var results = new List<int>();
        ReadOnlySpan<int> series = stackalloc int[] { 3, 1, 4, 1, 5 };
        string[] names = { "add", "sub", "mul", "max", "largest" };
        for (int i = 0; i < table.Length; i++)
        {
            results.Add(table[i](12, 5));
            Console.WriteLine($"{names[i]}(12, 5) = {results[i]}; folded from 1: {Native.Fold(table[i], 1, series)}");
        }
        delegate*<int, int, int> add = Native.Pick('+');
        Console.WriteLine($"{string.Join(",", results)} {Native.Fold(add, 0, series)} {Native.Fold(Native.Pick('*'), 1, series)} {Native.Fold(Native.Pick('-'), 100, series)} {Native.Fold(Native.Pick('>'), int.MinValue, series)} {add(2, 3) == table[0](2, 3)} {add(2, 3) == table[1](2, 3)} {Native.Pick('?') == null}");
        delegate*<string, string, string> longest = &Native.Largest<string>;
        delegate*<double, double, double> power = &Math.Pow;
        delegate*<int, out int, bool> halve = &Native.TryHalve;
        delegate* managed<ref int, void> triple = &Native.Triple;
        Native.Map(numbers, 3, triple);
        bool even = halve(numbers[1], out int half), odd = halve(7, out int rounded);
        Console.WriteLine($"{Native.Apply(longest, "kiwi", "apple")} {Native.Apply(power, 2, 10) == 1024} {Native.Apply<long>(&Math.Min, 9L, -9L)} {Join(numbers, 6)} {even}:{half} {odd}:{rounded} {Native.Apply(&Native.Mul, half, 2)}");
        string symbols = "+*->";
        int accumulator = 2;
        foreach (char symbol in symbols)
        {
            accumulator = Native.Pick(symbol)(accumulator, symbol == '>' ? 50 : 7);
            Console.WriteLine($"after '{symbol}': {accumulator}");
        }
    }
}
