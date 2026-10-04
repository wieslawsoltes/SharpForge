using System;

// Unsafe code: pointers to locals, fields and struct members, pointer arithmetic and comparison, pointer
// conversions, `sizeof`, the `fixed` statement over variables, arrays, strings and `GetPinnableReference`,
// `stackalloc` to a pointer and fixed-size buffers.

enum Small : byte { One, Two }

struct Point
{
    public int X;
    public int Y;
}

struct Wide
{
    public byte Tag;
    public long Value;
    public Point Corner;
}

unsafe struct Packet
{
    public fixed byte Header[3];
    public fixed int Data[4];
    public int Length;
    public fixed double Scale[2];
}

class Holder
{
    public int Value;
    public Packet Packet;
    public static int Shared;
}

class Pinnable
{
    int[] items = { 10, 20, 30 };
    public ref int GetPinnableReference() { return ref items[0]; }
}

unsafe class Program
{
    static void Twice(int* pointer) { *pointer = *pointer * 2; }
    static void Swap(int* left, int* right) { int kept = *left; *left = *right; *right = kept; }

    static int Sum(int* pointer, int count)
    {
        int total = 0;
        for (int index = 0; index < count; index++) total += pointer[index];
        return total;
    }

    static long SumBackwards(long* end, int count)
    {
        long total = 0;
        while (count-- > 0) total += *--end;
        return total;
    }

    static int Total(Packet* packet)
    {
        int total = 0;
        for (int index = 0; index < packet->Length; index++) total += packet->Data[index];
        return total;
    }

    static void Locals()
    {
        int x = 21, y = 5;
        int* p = &x;
        Twice(p);
        Swap(&x, &y);
        Console.WriteLine(x + " " + y + " " + *p);
        int** indirect = &p;
        **indirect = 7;
        *indirect = &y;
        Console.WriteLine(x + " " + *p + " " + (p == &y) + " " + (p != &x));
        Point point = new Point();
        Point* pp = &point;
        pp->X = 4;
        (*pp).Y = 5;
        pp->X += 10;
        pp->Y++;
        Console.WriteLine(point.X + " " + point.Y + " " + (pp->X + pp->Y));
        void* erased = pp;
        Point* back = (Point*)erased;
        int* asInts = (int*)back;
        Console.WriteLine(back->Y + " " + asInts[0] + " " + asInts[1]);
        long address = (long)p;
        ulong unsignedAddress = (ulong)p;
        int* rebuilt = (int*)address;
        int* nothing = null;
        Console.WriteLine((address != 0) + " " + (unsignedAddress == (ulong)address) + " " + (rebuilt == p) + " " + (nothing == null) + " " + (p != null));
    }

    static void Arithmetic()
    {
        int[] numbers = { 1, 2, 3, 4, 5 };
        long[] wide = { 10, 20, 30 };
        fixed (int* first = numbers)
        fixed (long* longs = wide)
        {
            int* end = first + numbers.Length;
            int* walk = first;
            walk++;
            walk += 2;
            --walk;
            Console.WriteLine(first[1] + *(first + 2) + " " + Sum(first, 5) + " " + (end - first) + " " + (walk - first) + " " + *walk);
            Console.WriteLine((first < end) + " " + (end <= first) + " " + (walk > first) + " " + (walk >= end) + " " + *(end - 1) + " " + *(1 + first));
            Console.WriteLine(SumBackwards(longs + 3, 3) + " " + (longs + 2 - longs) + " " + longs[2u] + " " + longs[1L]);
            uint offset = 3;
            long big = 4;
            Console.WriteLine(*(first + offset) + " " + *(first + big) + " " + first[offset]);
        }
    }

    static void Sizes()
    {
        Console.WriteLine(sizeof(int) + sizeof(double) + sizeof(bool) + sizeof(char) + sizeof(decimal));
        Console.WriteLine(sizeof(Point) + " " + sizeof(Wide) + " " + sizeof(Packet) + " " + sizeof(Small) + " " + (sizeof(int*) == sizeof(void*)));
    }

    static void Pinning()
    {
        Holder holder = new Holder();
        fixed (int* field = &holder.Value) *field = 9;
        fixed (int* shared = &Holder.Shared) *shared = 11;
        Console.WriteLine(holder.Value + " " + Holder.Shared);
        fixed (char* text = "hi there")
        {
            char* cursor = text;
            int length = 0;
            while (*cursor != '\0') { cursor++; length++; }
            Console.WriteLine(text[1] + " " + length + " " + (char)(text[0] - 32));
        }
        int[] none = null, empty = new int[0];
        string missing = null;
        fixed (int* a = none, b = empty)
        fixed (char* c = missing)
            Console.WriteLine((a == null) + " " + (b == null) + " " + (c == null));
        fixed (int* custom = new Pinnable()) Console.WriteLine(custom[0] + custom[2]);
        byte[] bytes = { 1, 2, 3, 4 };
        fixed (byte* raw = &bytes[1]) Console.WriteLine(*(short*)raw + " " + raw[2]);
    }

    static void Buffers()
    {
        Packet packet = new Packet();
        packet.Length = 3;
        packet.Data[0] = 5;
        packet.Data[1] = 6;
        packet.Data[2] = 7;
        packet.Header[2] = 200;
        packet.Scale[1] = 1.5;
        int* first = packet.Data;
        Console.WriteLine(Total(&packet) + " " + *(first + 2) + " " + packet.Header[2] + " " + packet.Scale[1] + " " + packet.Data[3]);
        Holder holder = new Holder();
        holder.Packet.Data[1] = 42;
        holder.Packet.Length = 2;
        fixed (int* data = holder.Packet.Data) Console.WriteLine(data[1] + " " + holder.Packet.Data[1]);
        fixed (Packet* inside = &holder.Packet) Console.WriteLine(Total(inside));
        int* stack = stackalloc int[3];
        stack[0] = 7;
        stack[2] = stack[0] + 1;
        Point* points = stackalloc Point[2];
        points[1].X = 3;
        Console.WriteLine(stack[0] + stack[2] + " " + points[1].X + " " + points->Y);
    }

    static void Main()
    {
        Locals();
        Arithmetic();
        Sizes();
        Pinning();
        Buffers();
        unsafe { int value = 1; int* pointer = &value; Console.WriteLine(*pointer + sizeof(long)); }
    }
}
