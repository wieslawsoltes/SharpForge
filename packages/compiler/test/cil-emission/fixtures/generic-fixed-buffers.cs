using System;

unsafe struct Packet<T> where T : unmanaged
{
    public fixed int Data[3];
    public T Tag;
    public int Sum() => Data[0] + Data[1] + Data[2];
}

unsafe class Outer<T>
{
    public struct Buffer<U> where U : unmanaged
    {
        public fixed byte Data[4];
        public U Tag;
    }
}

unsafe class Program
{
    static void Fill<T>(ref Packet<T> packet) where T : unmanaged
    {
        fixed (int* data = packet.Data)
        {
            data[0] = 2;
            data[1] = 3;
            data[2] = 5;
        }
    }
    static void Swap<T>(T* first, T* second) where T : unmanaged
    {
        T temporary = *first;
        *first = *second;
        *second = temporary;
    }
    static void Main()
    {
        Packet<int> first = default;
        Fill(ref first);
        first.Tag = 7;
        var copy = first;
        copy.Data[0] = 13;
        Console.WriteLine(first.Sum() + first.Tag);
        Console.WriteLine(copy.Sum());
        Console.WriteLine(sizeof(Packet<int>));
        Packet<long> second = default;
        second.Data[2] = 19;
        Console.WriteLine(second.Sum());
        Outer<string>.Buffer<int> nested = default;
        nested.Data[0] = 23;
        nested.Data[3] = 29;
        Console.WriteLine(nested.Data[0] + nested.Data[3]);
        int[] values = { 31, 37, 41 };
        fixed (int* firstValue = values, lastValue = &values[^1]) Swap(firstValue, lastValue);
        Console.WriteLine(values[0]);
        Console.WriteLine(values[2]);
    }
}
