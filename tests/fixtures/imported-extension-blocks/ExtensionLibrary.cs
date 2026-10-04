namespace ExtensionImport;

public sealed class Box
{
    public int Value;
    public Box(int value) => Value = value;
}

public sealed class Box<T>
{
    public T Value;
    public Box(T value) => Value = value;
}

public struct Counter
{
    public int Value;
}

public static class Extensions
{
    extension(Box box)
    {
        public int Twice => box.Value * 2;
        public int Writable { get => box.Value; set => box.Value = value; }
        public int Add(int offset = 3) => box.Value + offset;
        public static Box New(int value) => new Box(value);
        public static Box New(string text) => new Box(text.Length);
        public static int Zero => 0;
        public static Box operator +(Box left, Box right) => new Box(left.Value + right.Value);
    }

    extension<T>(Box<T> box)
    {
        public T Item { get => box.Value; set => box.Value = value; }
        public U Map<U>(System.Func<T, U> projection) => projection(box.Value);
        public U SameType<U>(U value) where U : T => value;
        public static Box<T> Create(T value) => new Box<T>(value);
        public static T Identity(T value) => value;
    }

    extension<T>(Box<T> box) where T : class
    {
        public T ReferenceValue => box.Value;
    }

    extension<T>(Box<T> box) where T : struct
    {
        public T StructValue => box.Value;
    }

    extension<T>(Box<T> box) where T : unmanaged
    {
        public static bool IsUnmanaged => true;
    }

    extension<T>(T[] items)
    {
        public T First => items[0];
    }

    extension(ref Counter counter)
    {
        public int Current { get => counter.Value; set => counter.Value = value; }
    }
}
