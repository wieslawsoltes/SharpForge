public static class HeaderCorpus
{
    public static void Empty() { }
    public static int Literal() => 42;
    static int Sum(int a, int b, int c, int d, int e, int f, int g, int h, int i, int j) => a + b + c + d + e + f + g + h + i + j;
    public static int DeepCall() => Sum(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    public static int Loop()
    {
        int total = 0;
        for (int index = 0; index < 12; index++) total += index;
        return total;
    }
    public static int Filtered()
    {
        int value = 1;
        try { throw new System.Exception(); }
        catch (System.Exception) when (value == 1) { value = 7; }
        finally { value += 2; }
        return value;
    }
    public static unsafe int Allocated()
    {
        int* values = stackalloc int[2];
        values[0] = 20;
        values[1] = 22;
        return values[0] + values[1];
    }
    sealed class Box { public int Value { get; set; } }
    public static int Patterns()
    {
        var box = new Box { Value = 42 };
        return (box is { Value: 42 } ? 1 : 0) + (box is { Value: > 0 } ? 2 : 0) + (box is { Value: < 100 } ? 4 : 0);
    }
    static int Echo(int value) => value;
    public static unsafe int Indirect()
    {
        delegate*<int, int> function = &Echo;
        return function(42);
    }
}
