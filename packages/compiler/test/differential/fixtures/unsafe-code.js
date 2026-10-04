/**
 * Differential fixtures for SF-A02-T47 (C# 1 unsafe code): unsafe contexts and the /unsafe option, pointer types,
 * pointer expressions and conversions, the fixed statement and fixed-size buffers. A fixture marked `allowUnsafe` is
 * compiled with /unsafe by Roslyn and by SharpForge; the others are compiled without it.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('unsafe-code', [
    out(
      'unsafe-contexts-around-safe-code',
      cs`
    using System;
    unsafe class Counter
    {
        int count;
        public unsafe void Add(int amount) { count += amount; }
        public int Count { get { return count; } }
    }
    class Program
    {
        static unsafe int Twice(int value) { return value * 2; }
        static void Main()
        {
            Counter c = new Counter();
            c.Add(2);
            unsafe
            {
                c.Add(Twice(3));
                Console.WriteLine(sizeof(int) + sizeof(double) + sizeof(bool));
            }
            Console.WriteLine(c.Count);
        }
    }
    `,
      { allowUnsafe: true },
    ),
    out(
      'pointers-fixed-and-stackalloc',
      cs`
    using System;
    struct Point { public int X; public int Y; }
    class Holder { public int Value; public static int Shared; public string Text; }
    unsafe class Program
    {
        static void Twice(int* p) { *p = *p * 2; }
        static int Sum(int* p, int count)
        {
            int total = 0;
            for (int i = 0; i < count; i++) total += p[i];
            return total;
        }
        static void Main()
        {
            int x = 21;
            int* p = &x;
            Twice(p);
            Console.WriteLine(x);
            Console.WriteLine(sizeof(int) + sizeof(long) + sizeof(Point));
            int[] a = { 1, 2, 3 };
            fixed (int* q = a)
            {
                Console.WriteLine(q[1] + *(q + 2));
                Console.WriteLine(Sum(q, 3));
                int* end = q + 3;
                Console.WriteLine(end - q);
                Console.WriteLine(q < end);
                int* walk = q;
                walk++;
                Console.WriteLine(*walk);
            }
            Point pt = new Point();
            Point* pp = &pt;
            pp->X = 4;
            (*pp).Y = 5;
            Console.WriteLine(pt.X + pt.Y);
            void* v = pp;
            Point* back = (Point*)v;
            Console.WriteLine(back->Y);
            long address = (long)p;
            Console.WriteLine(address != 0);
            int* nothing = null;
            Console.WriteLine(nothing == null);
            fixed (char* c = "hi") Console.WriteLine(c[1]);
            Holder h = new Holder();
            fixed (int* f = &h.Value) *f = 9;
            Console.WriteLine(h.Value);
            int* stack = stackalloc int[2];
            stack[0] = 7;
            Console.WriteLine(stack[0]);
            int** pointerToPointer = &p;
            Console.WriteLine(**pointerToPointer);
        }
    }
    `,
      { allowUnsafe: true },
    ),
    out(
      'fixed-size-buffers',
      cs`
    using System;
    unsafe struct Packet
    {
        public fixed int Data[4];
        public int Length;
    }
    unsafe class Program
    {
        static int Total(Packet* packet)
        {
            int total = 0;
            for (int i = 0; i < packet->Length; i++) total += packet->Data[i];
            return total;
        }
        static void Main()
        {
            Packet packet = new Packet();
            packet.Length = 3;
            packet.Data[0] = 5;
            packet.Data[1] = 6;
            packet.Data[2] = 7;
            Console.WriteLine(Total(&packet));
            int* first = packet.Data;
            Console.WriteLine(*(first + 2));
            Console.WriteLine(sizeof(Packet));
        }
    }
    `,
      { allowUnsafe: true },
    ),
    diag(
      'unsafe-needs-the-option',
      cs`
    using System;
    struct Point { public int X; public int Y; }
    class Holder { public int Value; public static int Shared; public string Text; }
    unsafe class Program
    {
        static void Twice(int* p) { *p = *p * 2; }
        static int Sum(int* p, int count)
        {
            int total = 0;
            for (int i = 0; i < count; i++) total += p[i];
            return total;
        }
        static void Main()
        {
            int x = 21;
            int* p = &x;
            Twice(p);
            Console.WriteLine(x);
            Console.WriteLine(sizeof(int) + sizeof(long) + sizeof(Point));
            int[] a = { 1, 2, 3 };
            fixed (int* q = a)
            {
                Console.WriteLine(q[1] + *(q + 2));
                Console.WriteLine(Sum(q, 3));
                int* end = q + 3;
                Console.WriteLine(end - q);
                Console.WriteLine(q < end);
                int* walk = q;
                walk++;
                Console.WriteLine(*walk);
            }
            Point pt = new Point();
            Point* pp = &pt;
            pp->X = 4;
            (*pp).Y = 5;
            Console.WriteLine(pt.X + pt.Y);
            void* v = pp;
            Point* back = (Point*)v;
            Console.WriteLine(back->Y);
            long address = (long)p;
            Console.WriteLine(address != 0);
            int* nothing = null;
            Console.WriteLine(nothing == null);
            fixed (char* c = "hi") Console.WriteLine(c[1]);
            Holder h = new Holder();
            fixed (int* f = &h.Value) *f = 9;
            Console.WriteLine(h.Value);
            int* stack = stackalloc int[2];
            stack[0] = 7;
            Console.WriteLine(stack[0]);
            int** pointerToPointer = &p;
            Console.WriteLine(**pointerToPointer);
        }
    }
    `,
    ),
    diag(
      'pointer-rules',
      cs`
    using System;
    struct Point { public int X; }
    struct Managed { public string Name; }
    class Holder { public int Value; public static int Shared; }
    unsafe struct Buffer { public fixed int Data[4]; public fixed bool Flags[2]; }
    class Buffers { public unsafe fixed int Wrong[4]; }
    unsafe struct BadBuffers { public fixed string Names[2]; public fixed int Empty[0]; public fixed int None[]; }
    class Safe
    {
        int* field;
        static int* Make() { return null; }
        static void Take(int* p) { }
        static void Body()
        {
            int x = 1;
            int* p = &x;
            int y = *p;
            int size = sizeof(Point);
            int ok = sizeof(int);
            unsafe { int* q = &x; }
        }
    }
    unsafe class Program
    {
        static int number;
        static void Main()
        {
            int x = 1;
            Holder h = new Holder();
            int* a = &h.Value;
            int* b = &Holder.Shared;
            int* c = &number;
            int* d = &(x + 1);
            int* e = &x;
            int f = *x;
            void* v = e;
            int g = *v;
            int i = v->X;
            string* s = null;
            Managed* m = null;
            int j = e[1, 2];
            int k = e["a"];
            double* dp = e;
            double* cast = (double*)e;
            int* fromInt = 5;
            int* fromCast = (int*)5;
            int toInt = e;
            bool cmp = e == dp;
            int* sum = e + e;
            long diff = e - cast;
            int* scaled = e * 2;
            fixed (int q = &x) { }
            fixed (int* q) { }
            fixed (int* q = &x) { }
            fixed (int* q = h) { }
            fixed (int* q = &h.Value) { q = null; }
            int[] arr = new int[1];
            fixed (int* q = arr, r = &h.Value) { }
            object o = e;
            e.ToString();
            var t = typeof(int*);
        }
    }
    `,
      { allowUnsafe: true },
    ),
  ]),
];
