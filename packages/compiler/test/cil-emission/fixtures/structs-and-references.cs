using System;

enum Level : byte
{
    Low = 1,
    High = 4,
}

[Flags]
enum Access
{
    None = 0,
    Read = 1,
    Write = 2,
}

struct Point
{
    public int X, Y;

    public Point(int x, int y)
    {
        X = x;
        Y = y;
    }

    public int Sum => X + Y;

    public void Move(int distance)
    {
        X += distance;
    }

    public override string ToString()
    {
        return X + "," + Y;
    }
}

class Program
{
    static int[] data = { 1, 2, 3 };

    static ref int Slot(int index) => ref data[index];

    static void Swap(ref int left, ref int right)
    {
        int saved = left;
        left = right;
        right = saved;
    }

    static bool TryHalf(int value, out int half)
    {
        half = value / 2;
        return value % 2 == 0;
    }

    static int Read(in Point point)
    {
        return point.X + point.Y;
    }

    static void Grow(ref Point point)
    {
        point.X *= 2;
        point = new Point(point.X, 9);
    }

    static void Main()
    {
        int a = 1, b = 2;
        Swap(ref a, ref b);
        Console.WriteLine(a + " " + b);
        ref int alias = ref data[1];
        alias = 20;
        alias += 5;
        Console.WriteLine(data[1]);
        Slot(2) = 30;
        Console.WriteLine(data[2] + Slot(0));
        ref int first = ref Slot(0);
        first++;
        Console.WriteLine(data[0]);

        Point p = new Point(1, 2);
        Point q = p;
        q.Move(5);
        Console.WriteLine(p.ToString() + " " + q.ToString());
        Grow(ref p);
        Console.WriteLine(p.ToString() + " " + Read(p) + " " + p.Sum);
        Point[] points = new Point[2];
        points[0].X = 4;
        points[1] = q;
        points[1].Move(1);
        Console.WriteLine(points[0].X + points[1].X);
        if (TryHalf(8, out int half)) Console.WriteLine(half);
        Point zero = default;
        Console.WriteLine(zero.Sum);
        object boxed = q;
        Point back = (Point)boxed;
        back.X = 0;
        Console.WriteLine(((Point)boxed).X + " " + back.X);

        Level level = Level.High;
        Console.WriteLine((int)level + (byte)Level.Low);
        Console.WriteLine(level == Level.High);
        Console.WriteLine(level > Level.Low);
        Access access = Access.Read | Access.Write;
        Console.WriteLine((access & Access.Write) != 0);
        access &= ~Access.Write;
        Console.WriteLine((int)access);
        switch (level)
        {
            case Level.Low:
                Console.WriteLine("low");
                break;
            case Level.High:
                Console.WriteLine("high");
                break;
        }
    }
}
